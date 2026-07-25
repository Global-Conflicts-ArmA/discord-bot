import { SlashCommandPipe } from '@discord-nestjs/common';
import {
  Command,
  DiscordClientProvider,
  EventParams,
  Handler,
  InteractionEvent,
  Param,
} from '@discord-nestjs/core';
import {
  ChatInputCommandInteraction,
  ClientEvents,
  GuildMember,
} from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { logEventHistory } from '../event-ops.actions';
import { isEventOpsAdmin, MONGO_COLLECTIONS } from '../event-ops.constants';
import {
  getActiveEvent,
  getDisplayName,
  getSlotsForChannel,
} from '../event-ops.helpers';
import { EventOpsMission } from '../event-ops.types';
import { formatSectionMessage, groupBySection } from '../message-formatter';
import { SheetsClientService } from '../sheets-client.service';

// TEMPORARY command — see README.md in temp-event-ops/.
//
// Pulls the sheet's current state into Mongo, but ONLY for slots Mongo
// currently shows as unoccupied — this is how staff block a slot, tweak a
// role/section, or manually register a walk-in (type Player + Discord User
// ID straight into the sheet), all without touching Discord. Any slot
// Mongo shows as occupied is left untouched; a mismatched sheet row for it
// is reported back instead of applied.
//
// "Blocked" counts as syncable, not occupied — it's a placeholder, not a
// real registration (no discordUserId), so un-blocking a slot by clearing
// the Player cell in the sheet must still be picked up by a later sync.

function isSyncable(player: string): boolean {
  return player === '' || player.toLowerCase().includes('blocked');
}

class EventSyncParams {
  @Param({
    description: 'Only sync this slot-list tab (omit to sync every tab)',
    required: false,
    autocomplete: true,
  })
  sheet_name?: string;
}

@Command({
  name: 'event-sync',
  description:
    '[TEMP] Pull sheet edits into open slots (occupied slots are never overwritten).',
})
export class EventSyncCommand {
  constructor(
    private readonly discordProvider: DiscordClientProvider,
    private readonly sheets: SheetsClientService,
    @InjectDb() private readonly db: mongo.Db,
  ) {}

  @Handler()
  async onCommand(
    @InteractionEvent(SlashCommandPipe) options: EventSyncParams,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;
    const member = interaction.member as GuildMember | null;

    if (!isEventOpsAdmin(member)) {
      await interaction.reply({
        content: 'You do not have permission to run this command.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const event = await getActiveEvent(this.db);
    if (!event) {
      await interaction.editReply({
        content: 'There is no active event to sync.',
      });
      return;
    }

    const allMissions = (await this.db
      .collection(MONGO_COLLECTIONS.missions)
      .find({ eventName: event.eventName })
      .toArray()) as unknown as EventOpsMission[];

    const sheetName = options.sheet_name?.trim();
    const missions = sheetName
      ? allMissions.filter((m) => m.sheetName === sheetName)
      : allMissions;

    if (sheetName && missions.length === 0) {
      const known = [...new Set(allMissions.map((m) => m.sheetName))].join(
        ', ',
      );
      await interaction.editReply({
        content: `No mission channel with sheet tab "${sheetName}" in the active event. Known tabs: ${
          known || '(none)'
        }`,
      });
      return;
    }

    const slotsCol = this.db.collection(MONGO_COLLECTIONS.slots);
    const sectionsCol = this.db.collection(MONGO_COLLECTIONS.sections);
    const client = this.discordProvider.getClient();

    let added = 0;
    let updated = 0;
    let removed = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const mission of missions) {
      try {
        const sheetRows = await this.sheets.getSlotRows(
          event.sheetId,
          mission.sheetName,
        );
        const existingSlots = await getSlotsForChannel(
          this.db,
          event.eventName,
          mission.channelId,
        );
        const existingBySlotId = new Map(
          existingSlots.map((s) => [s.slotId, s]),
        );
        const seenSlotIds = new Set<string>();

        for (const row of sheetRows) {
          seenSlotIds.add(row.SlotID);
          const existing = existingBySlotId.get(row.SlotID);

          if (!existing) {
            await slotsCol.insertOne({
              eventName: event.eventName,
              channelId: mission.channelId,
              sheetName: mission.sheetName,
              rowIndex: row.rowIndex,
              slotId: row.SlotID,
              section: row.Section || 'Unknown',
              role: row.Role || 'Unknown',
              description: row.Description || '',
              player: row.Player || '',
              discordUserId: row['Discord User ID'] || '',
            } as any);
            added++;
            continue;
          }

          if (isSyncable(existing.player)) {
            await slotsCol.updateOne(
              {
                eventName: event.eventName,
                channelId: mission.channelId,
                slotId: row.SlotID,
              },
              {
                $set: {
                  rowIndex: row.rowIndex,
                  section: row.Section || 'Unknown',
                  role: row.Role || 'Unknown',
                  description: row.Description || '',
                  player: row.Player || '',
                  discordUserId: row['Discord User ID'] || '',
                },
              },
            );
            updated++;
          } else {
            const changed =
              existing.section !== (row.Section || 'Unknown') ||
              existing.role !== (row.Role || 'Unknown') ||
              existing.description !== (row.Description || '');
            if (changed) {
              skipped.push(
                `${mission.sheetName} #${row.SlotID} (occupied by ${existing.player})`,
              );
            }
          }
        }

        // Rows that used to exist in Mongo but are no longer in the sheet.
        for (const existing of existingSlots) {
          if (seenSlotIds.has(existing.slotId)) continue;
          if (isSyncable(existing.player)) {
            await slotsCol.deleteOne({
              eventName: event.eventName,
              channelId: mission.channelId,
              slotId: existing.slotId,
            });
            removed++;
          } else {
            skipped.push(
              `${mission.sheetName} #${existing.slotId} (removed from sheet but occupied by ${existing.player})`,
            );
          }
        }

        // Rebuild every section message for this mission from the current Mongo state.
        const currentSlots = await getSlotsForChannel(
          this.db,
          event.eventName,
          mission.channelId,
        );
        const currentSections = groupBySection(currentSlots);
        const existingSectionDocs = await sectionsCol
          .find({ eventName: event.eventName, channelId: mission.channelId })
          .toArray();

        const channel = await client.channels
          .fetch(mission.channelId)
          .catch(() => null);

        for (const sectionDoc of existingSectionDocs) {
          if (currentSections.has(sectionDoc.section)) continue;
          // Section no longer has any slots — clean up its message + record.
          if (channel && channel.isTextBased()) {
            await channel.messages
              .delete(sectionDoc.messageId as string)
              .catch(() => null);
          }
          await sectionsCol.deleteOne({ _id: sectionDoc._id });
        }

        if (channel && channel.isTextBased()) {
          for (const [sectionName, sectionSlots] of currentSections) {
            const embed = formatSectionMessage(
              sectionName,
              sectionSlots,
              mission.sheetName,
            );
            const sectionDoc = existingSectionDocs.find(
              (d) => d.section === sectionName,
            );
            if (sectionDoc) {
              await channel.messages
                .edit(sectionDoc.messageId as string, { embeds: [embed] })
                .catch(() => null);
            } else {
              const sentMsg = await channel.send({ embeds: [embed] });
              await sectionsCol.insertOne({
                eventName: event.eventName,
                channelId: mission.channelId,
                section: sectionName,
                messageId: sentMsg.id,
              } as any);
            }
          }
        }
      } catch (err: any) {
        errors.push(`${mission.sheetName}: ${err.message}`);
      }
    }

    const adminName = getDisplayName(member, interaction.user);
    const scopeNote = sheetName ? ` (tab "${sheetName}" only)` : '';
    await logEventHistory(
      client,
      this.sheets,
      event,
      adminName,
      `Ran /event-sync${scopeNote} — ${added} added, ${updated} updated, ${removed} removed, ${skipped.length} skipped`,
    );

    let summary = `Sync complete${scopeNote} — ${added} added, ${updated} updated, ${removed} removed.`;
    if (skipped.length) {
      summary += `\n\n⚠️ Skipped (occupied, edit your sheet after the player deslots):\n${skipped
        .slice(0, 15)
        .join('\n')}`;
      if (skipped.length > 15)
        summary += `\n...and ${skipped.length - 15} more.`;
    }
    if (errors.length) {
      summary += `\n\n❌ Errors:\n${errors.join('\n')}`;
    }
    await interaction.editReply({ content: summary });
  }
}
