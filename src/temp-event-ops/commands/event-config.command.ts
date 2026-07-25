import { SlashCommandPipe } from '@discord-nestjs/common';
import {
  Command,
  EventParams,
  Handler,
  InteractionEvent,
  Param,
} from '@discord-nestjs/core';
import {
  ChannelType,
  ChatInputCommandInteraction,
  ClientEvents,
  GuildMember,
} from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { isEventOpsAdmin, MONGO_COLLECTIONS } from '../event-ops.constants';

// TEMPORARY command — see README.md in temp-event-ops/.

class EventConfigParams {
  @Param({
    description:
      'Category ID all event channels get created under (Copy Channel ID, Developer Mode required)',
    required: true,
  })
  category_id: string;
}

@Command({
  name: 'event-config',
  description: '[TEMP] Set the category new event channels are created under.',
})
export class EventConfigCommand {
  constructor(@InjectDb() private readonly db: mongo.Db) {}

  @Handler()
  async onCommand(
    @InteractionEvent(SlashCommandPipe) options: EventConfigParams,
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

    const channel = interaction.guild?.channels.cache.get(
      options.category_id.trim(),
    );
    if (!channel || channel.type !== ChannelType.GuildCategory) {
      await interaction.reply({
        content: 'That ID does not match a category channel in this server.',
        ephemeral: true,
      });
      return;
    }

    await this.db
      .collection(MONGO_COLLECTIONS.settings)
      .updateOne({}, { $set: { categoryId: channel.id } }, { upsert: true });

    await interaction.reply({
      content: `Event channels will now be created under **${channel.name}**.`,
      ephemeral: true,
    });
  }
}
