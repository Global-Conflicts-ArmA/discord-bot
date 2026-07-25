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
  ChatInputCommandInteraction,
  ClientEvents,
  GuildMember,
} from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { performSignup } from '../event-ops.actions';
import {
  getActiveEvent,
  getDisplayName,
  getMissionForChannel,
} from '../event-ops.helpers';
import { SheetsClientService } from '../sheets-client.service';

// TEMPORARY command — see README.md in temp-event-ops/.
//
// Mongo is the source of truth: the claim itself is a single conditional
// update (only succeeds if the slot is currently unoccupied), so two
// concurrent signups on the same slot can't both win. The sheet write and
// Discord message refresh happen after, best-effort, purely for display.
// Actual claim logic lives in event-ops.actions.ts, shared with the
// button+select-menu UI on the roster messages.

class EventSignupParams {
  @Param({
    description: 'Slot number',
    required: true,
    type: ParamType.INTEGER,
    autocomplete: true,
  })
  slot: number;
}

@Command({
  name: 'event-signup',
  description: '[TEMP] Sign up for a slot in this mission channel.',
})
export class EventSignupCommand {
  constructor(
    private readonly discordProvider: DiscordClientProvider,
    private readonly sheets: SheetsClientService,
    @InjectDb() private readonly db: mongo.Db,
  ) {}

  @Handler()
  async onCommand(
    @InteractionEvent(SlashCommandPipe) options: EventSignupParams,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;
    const member = interaction.member as GuildMember | null;
    const slotId = String(options.slot);

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
    const result = await performSignup(
      this.db,
      this.sheets,
      this.discordProvider.getClient(),
      event,
      mission,
      slotId,
      interaction.user.id,
      displayName,
    );

    await interaction.editReply({ content: result.message });
  }
}
