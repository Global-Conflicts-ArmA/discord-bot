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
import { performDeslot } from '../event-ops.actions';
import {
  getActiveEvent,
  getDisplayName,
  getMissionForChannel,
} from '../event-ops.helpers';
import { SheetsClientService } from '../sheets-client.service';

// TEMPORARY command — see README.md in temp-event-ops/.
//
// No slot parameter — a user can only hold one slot per mission channel, so
// this just frees whichever slot the caller is actually registered in here.

@Command({
  name: 'event-deslot',
  description: '[TEMP] Free your slot in this mission channel.',
})
export class EventDeslotCommand {
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

    const event = await getActiveEvent(this.db);
    if (!event) {
      await interaction.reply({
        content: 'There is no active event.',
        ephemeral: true,
      });
      return;
    }

    const mission = await getMissionForChannel(this.db, interaction.channelId);
    if (!mission) {
      await interaction.reply({
        content: 'This is not an event slot channel.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const displayName = getDisplayName(member, interaction.user);
    const result = await performDeslot(
      this.db,
      this.sheets,
      this.discordProvider.getClient(),
      event,
      mission,
      interaction.user.id,
      displayName,
    );

    await interaction.editReply({ content: result.message });
  }
}
