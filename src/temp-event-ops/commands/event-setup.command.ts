import { SlashCommandPipe } from '@discord-nestjs/common';
import {
  Command,
  DiscordClientProvider,
  EventParams,
  Handler,
  InteractionEvent,
  Param,
  ParamType,
} from '@discord-nestjs/core';
import {
  ChannelType,
  ChatInputCommandInteraction,
  ClientEvents,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { logEventHistory } from '../event-ops.actions';
import { isEventOpsAdmin, MONGO_COLLECTIONS } from '../event-ops.constants';
import {
  getActiveEvent,
  getDisplayName,
  getSettings,
} from '../event-ops.helpers';
import {
  EventOpsEvent,
  EventOpsMission,
  EventOpsSection,
  EventOpsSlot,
} from '../event-ops.types';
import {
  buildMissionChannelTopic,
  buildSignupButtonsRow,
  formatSectionMessage,
  groupBySection,
  SIGNUP_HELP_MESSAGE,
} from '../message-formatter';
import { SheetsClientService } from '../sheets-client.service';

// TEMPORARY command — see README.md in temp-event-ops/.

class EventSetupParams {
  @Param({
    description: 'Event name (used to name/identify this event)',
    required: true,
  })
  name: string;

  @Param({ description: 'Google Sheet URL for this event', required: true })
  sheet_url: string;

  @Param({
    description:
      'Clear leftover Player/Discord ID data from the sheet before setup (use when reusing the same sheet)',
    required: false,
    type: ParamType.BOOLEAN,
  })
  reset_before_setup?: boolean;
}

@Command({
  name: 'event-setup',
  description: '[TEMP] Create channels for a new event from a Google Sheet.',
})
export class EventSetupCommand {
  constructor(
    private readonly discordProvider: DiscordClientProvider,
    private readonly sheets: SheetsClientService,
    @InjectDb() private readonly db: mongo.Db,
  ) {}

  @Handler()
  async onCommand(
    @InteractionEvent(SlashCommandPipe) options: EventSetupParams,
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

    const existing = await getActiveEvent(this.db);
    if (existing) {
      await interaction.editReply({
        content: `There is already an active event: **${existing.eventDisplayName}**. Run /event-teardown first.`,
      });
      return;
    }

    const settings = await getSettings(this.db);
    if (!settings?.categoryId) {
      await interaction.editReply({
        content: 'No category configured. Run /event-config first.',
      });
      return;
    }

    const sheetId = SheetsClientService.extractSheetId(options.sheet_url);
    if (!sheetId) {
      await interaction.editReply({
        content: 'That does not look like a valid Google Sheets URL.',
      });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({
        content: 'Could not resolve the server this command was run in.',
      });
      return;
    }

    const category = guild.channels.cache.get(settings.categoryId as string);
    if (!category || category.type !== ChannelType.GuildCategory) {
      await interaction.editReply({
        content:
          'The configured category no longer exists. Run /event-config again.',
      });
      return;
    }

    let overview;
    try {
      overview = await this.sheets.getEventOverview(sheetId);
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to read the sheet: ${err.message}`,
      });
      return;
    }

    if (overview.length === 0) {
      await interaction.editReply({
        content: 'No missions found in the "Event Overview" tab.',
      });
      return;
    }

    const eventDisplayName = options.name.trim();
    const eventName = eventDisplayName.toLowerCase().replace(/\s+/g, '-');

    // Once a channel gets ANY custom permission overwrites of its own, don't
    // rely on the parent category's overwrites still applying for roles the
    // channel doesn't mention — in practice that fell through inconsistently
    // (bot lost Manage Channels on the very channels it just created, and
    // @everyone lost permissions the category granted). So the channel's own
    // overwrite array is made fully self-contained here: every role/member
    // that needs a permission gets it restated explicitly. @everyone's
    // guild-wide base permissions turned out to be just View Channel —
    // nothing else — so Read Message History and Use Application Commands
    // also have to be granted here, or players can see a channel exists but
    // not its messages, and slash commands fail there too.
    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    const botMember = guild.members.me;
    const EVERYONE_BASE_ALLOW = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.UseApplicationCommands,
    ];
    const botOverwrite = botMember
      ? [
          {
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ]
      : [];

    // Mission channels (and event-history, below) are roster/log-only — deny
    // regular chat for everyone (staff can still post). NOTE: this DOES block
    // slash commands for anyone without Send Messages — Discord requires both
    // Send Messages and Use Application Commands to invoke a slash command in
    // a channel, regardless of them being distinct permission bits (confirmed
    // via live testing; see README's "Mission channels are read-only"
    // section). That's why the roster message's buttons/select-menu
    // (buildSignupButtonsRow), not /event-signup or /event-deslot, are the
    // real signup path for regular players here — component interactions
    // aren't subject to that restriction. Staff (who get Send Messages via
    // adminRoleId below) can still use the slash commands directly.
    const missionChannelOverwrites = [
      {
        id: guild.roles.everyone.id,
        allow: EVERYONE_BASE_ALLOW,
        deny: [PermissionFlagsBits.SendMessages],
      },
      ...(adminRoleId
        ? [
            {
              id: adminRoleId,
              allow: [...EVERYONE_BASE_ALLOW, PermissionFlagsBits.SendMessages],
            },
          ]
        : []),
      ...botOverwrite,
    ];

    let eventChatId: string;
    try {
      const eventChatChannel = await guild.channels.create({
        name: 'event-chat',
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [...EVERYONE_BASE_ALLOW, PermissionFlagsBits.SendMessages],
          },
          ...botOverwrite,
        ],
      });
      eventChatId = eventChatChannel.id;
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to create the event-chat channel: ${err.message}`,
      });
      return;
    }

    let historyChannelId: string;
    try {
      const historyChannel = await guild.channels.create({
        name: 'event-history',
        type: ChannelType.GuildText,
        parent: category.id,
        topic:
          "Read-only log of every signup, deslot, and admin action for this event — mirrors the sheet's History tab.",
        permissionOverwrites: missionChannelOverwrites,
      });
      historyChannelId = historyChannel.id;
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to create the event-history channel: ${err.message}`,
      });
      return;
    }

    const missionDocs: EventOpsMission[] = [];
    const sectionDocs: EventOpsSection[] = [];
    const slotDocs: EventOpsSlot[] = [];
    const errors: string[] = [];
    const resetBeforeSetup = options.reset_before_setup ?? false;
    let leftoverOccupiedCount = 0;

    for (const mission of overview) {
      for (const slotListName of mission.slotLists) {
        try {
          const sheetLink = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
          const topic = buildMissionChannelTopic(
            mission.description,
            sheetLink,
          );
          const missionChannel = await guild.channels.create({
            name: slotListName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic,
            permissionOverwrites: missionChannelOverwrites,
          });

          if (resetBeforeSetup) {
            await this.sheets.clearAllOccupants(sheetId, slotListName);
          }

          const rows = await this.sheets.getSlotRows(sheetId, slotListName);
          const missionSlots: EventOpsSlot[] = rows.map((row) => ({
            eventName,
            channelId: missionChannel.id,
            sheetName: slotListName,
            rowIndex: row.rowIndex,
            slotId: row.SlotID,
            section: row.Section || 'Unknown',
            role: row.Role || 'Unknown',
            description: row.Description || '',
            player: resetBeforeSetup ? '' : row.Player || '',
            discordUserId: resetBeforeSetup ? '' : row['Discord User ID'] || '',
          }));
          if (!resetBeforeSetup) {
            leftoverOccupiedCount += missionSlots.filter(
              (s) => s.player !== '',
            ).length;
          }
          slotDocs.push(...missionSlots);

          const sections = groupBySection(missionSlots);
          for (const [sectionName, sectionSlots] of sections) {
            const embed = formatSectionMessage(
              sectionName,
              sectionSlots,
              slotListName,
            );
            const sentMsg = await missionChannel.send({ embeds: [embed] });
            sectionDocs.push({
              eventName,
              channelId: missionChannel.id,
              section: sectionName,
              messageId: sentMsg.id,
            });
          }
          await missionChannel.send({
            content: SIGNUP_HELP_MESSAGE,
            components: [buildSignupButtonsRow()],
          });

          missionDocs.push({
            eventName,
            missionNumber: mission.missionNumber,
            missionDescription: mission.description,
            sheetName: slotListName,
            channelId: missionChannel.id,
          });
        } catch (err: any) {
          errors.push(`${slotListName}: ${err.message}`);
        }
      }
    }

    const eventDoc: EventOpsEvent = {
      eventName,
      eventDisplayName,
      sheetId,
      eventChatId,
      historyChannelId,
      categoryId: category.id,
      guildId: guild.id,
      createdAt: new Date(),
    };
    await this.db
      .collection(MONGO_COLLECTIONS.events)
      .insertOne(eventDoc as any);
    if (missionDocs.length)
      await this.db
        .collection(MONGO_COLLECTIONS.missions)
        .insertMany(missionDocs as any[]);
    if (sectionDocs.length)
      await this.db
        .collection(MONGO_COLLECTIONS.sections)
        .insertMany(sectionDocs as any[]);
    if (slotDocs.length)
      await this.db
        .collection(MONGO_COLLECTIONS.slots)
        .insertMany(slotDocs as any[]);

    const adminName = getDisplayName(member, interaction.user);
    await logEventHistory(
      this.discordProvider.getClient(),
      this.sheets,
      eventDoc,
      adminName,
      `Ran /event-setup for event "${eventDisplayName}"${
        resetBeforeSetup ? ' (reset_before_setup)' : ''
      } — ${missionDocs.length} mission channel(s)`,
    );

    let summary = `Event **${eventDisplayName}** set up with ${missionDocs.length} mission channel(s).`;
    if (leftoverOccupiedCount > 0) {
      summary += `\n\n⚠️ ${leftoverOccupiedCount} slot(s) already had a Player filled in from a previous use of this sheet — they've been seeded as already registered. Re-run with reset_before_setup:true if this event should start empty.`;
    }
    if (errors.length) {
      summary += `\n\n❌ Errors:\n${errors.join('\n')}`;
    }
    await interaction.editReply({ content: summary });
  }
}
