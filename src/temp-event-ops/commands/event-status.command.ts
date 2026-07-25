import { Command, EventParams, Handler } from '@discord-nestjs/core';
import { ChatInputCommandInteraction, ClientEvents } from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { getUserStatusMessage } from '../event-ops.helpers';

// TEMPORARY command — see README.md in temp-event-ops/.
// Works in any channel — lists every slot the caller holds across the whole
// active event, not just the current channel's mission. Same logic backs the
// "My Status" button on the roster message (getUserStatusMessage).

@Command({
  name: 'event-status',
  description: '[TEMP] Show every slot you hold in the active event.',
})
export class EventStatusCommand {
  constructor(@InjectDb() private readonly db: mongo.Db) {}

  @Handler()
  async onCommand(
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;

    const message = await getUserStatusMessage(this.db, interaction.user.id);
    await interaction.reply({ content: message, ephemeral: true });
  }
}
