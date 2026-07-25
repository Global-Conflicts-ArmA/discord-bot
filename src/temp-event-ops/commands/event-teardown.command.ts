import {
  Command,
  DiscordClientProvider,
  EventParams,
  Handler,
} from '@discord-nestjs/core';
import {
  ChatInputCommandInteraction,
  ClientEvents,
  GuildMember,
} from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { isEventOpsAdmin, MONGO_COLLECTIONS } from '../event-ops.constants';
import { getActiveEvent, getDisplayName } from '../event-ops.helpers';
import { SheetsClientService } from '../sheets-client.service';

// TEMPORARY command — see README.md in temp-event-ops/.

@Command({
  name: 'event-teardown',
  description: "[TEMP] Delete the active event's channels and records.",
})
export class EventTeardownCommand {
  constructor(
    private readonly discordProvider: DiscordClientProvider,
    private readonly sheets: SheetsClientService,
    @InjectDb() private readonly db: mongo.Db,
  ) {}

  @Handler()
  async onCommand(
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
        content: 'There is no active event to tear down.',
      });
      return;
    }

    const missions = await this.db
      .collection(MONGO_COLLECTIONS.missions)
      .find({ eventName: event.eventName })
      .toArray();

    const client = this.discordProvider.getClient();
    const channelIds: string[] = [
      event.eventChatId,
      ...(event.historyChannelId ? [event.historyChannelId] : []),
      ...missions.map((m: any) => m.channelId),
    ];
    const errors: string[] = [];

    for (const channelId of channelIds) {
      try {
        const channel = await client.channels
          .fetch(channelId)
          .catch(() => null);
        if (channel) await channel.delete('Event teardown');
      } catch (err: any) {
        errors.push(`${channelId}: ${err.message}`);
      }
    }

    await this.db
      .collection(MONGO_COLLECTIONS.events)
      .deleteMany({ eventName: event.eventName });
    await this.db
      .collection(MONGO_COLLECTIONS.missions)
      .deleteMany({ eventName: event.eventName });
    await this.db
      .collection(MONGO_COLLECTIONS.sections)
      .deleteMany({ eventName: event.eventName });
    await this.db
      .collection(MONGO_COLLECTIONS.slots)
      .deleteMany({ eventName: event.eventName });

    // Sheet only, not the shared logEventHistory helper — the event-history
    // channel was just deleted above, so there's nothing left to post to.
    const adminName = getDisplayName(member, interaction.user);
    await this.sheets.logHistory(
      event.sheetId,
      adminName,
      `Ran /event-teardown for event "${event.eventDisplayName}"`,
    );

    const summary =
      `Event **${event.eventDisplayName}** torn down (${
        channelIds.length - errors.length
      }/${channelIds.length} channels deleted).` +
      (errors.length ? `\n\n⚠️ Errors:\n${errors.join('\n')}` : '');
    await interaction.editReply({ content: summary });
  }
}
