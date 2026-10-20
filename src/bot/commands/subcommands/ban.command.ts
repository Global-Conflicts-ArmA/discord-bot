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
  PermissionFlagsBits,
} from 'discord.js';

// Channel ID where ban logs will be posted
const BAN_LOG_CHANNEL_ID = '745429566453186631'; // Replace with your ban log channel ID

class BanCommandParams {
  @Param({ description: 'User to ban', required: true, type: ParamType.USER })
  user: string;

  @Param({ description: 'Reason for the ban', required: true })
  reason: string;
}

@Command({
  name: 'janny',
  description: 'Bans a user and logs the action in the ban log channel.',
  defaultMemberPermissions: PermissionFlagsBits.BanMembers,
  dmPermission: false,
})
export class BanCommand {
  constructor(private readonly discordProvider: DiscordClientProvider) {}

  @Handler()
  async onBanCommand(
    @InteractionEvent(SlashCommandPipe) options: BanCommandParams,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;
    const member = interaction.member;
    const guild = interaction.guild;

    if (!member || !guild) {
      await interaction.reply({
        content: 'This command can only be used by a server member.',
        ephemeral: true,
      });
      return;
    }

    // Defer the reply as this operation may take time
    await interaction.deferReply();

    try {
      const userId = options.user;
      const reason = options.reason;

      // Fetch the user to get their information
      const client = this.discordProvider.getClient();
      let userToBan;
      try {
        userToBan = await client.users.fetch(userId);
      } catch (error) {
        await interaction.editReply({
          content: `Could not find user with ID: ${userId}`,
        });
        return;
      }

      // Ban the user
      const targetMember = await guild.members
        .fetch(userToBan.id)
        .catch(() => null);
      if (targetMember) {
        await targetMember.ban({ reason: reason });
      } else {
        await guild.bans.create(userToBan.id, { reason: reason });
      }

      // Delete user's messages from the last day
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      let deletedMessageCount = 0;

      const channels = await guild.channels.fetch();
      for (const [, channel] of channels) {
        if (!channel || !channel.isTextBased()) continue;

        try {
          const messages = await channel.messages.fetch({ limit: 100 });
          const userMessages = messages.filter(
            (msg) =>
              msg.author.id === userToBan.id &&
              msg.createdTimestamp > oneDayAgo,
          );

          if (userMessages.size > 0) {
            await channel.bulkDelete(userMessages);
            deletedMessageCount += userMessages.size;
          }
        } catch (error) {
          console.error(
            `Error deleting messages in channel ${channel.id}:`,
            error,
          );
        }
      }

      // Post ban log to the designated channel
      let banLogMessageUrl = '';
      const banLogChannel = guild.channels.cache.get(BAN_LOG_CHANNEL_ID);
      if (banLogChannel && banLogChannel.isTextBased()) {
        const logMessage =
          `**User Banned**\n` +
          `**Banned User:** ${userToBan.username} (${userToBan.id})\n` +
          `**Banned By:** ${member.user.username}\n` +
          `**Reason:** ${reason}\n` +
          `**Messages Deleted:** ${deletedMessageCount}\n` +
          `**Timestamp:** <t:${Math.floor(Date.now() / 1000)}:F>`;

        const sentMessage = await banLogChannel.send(logMessage);
        banLogMessageUrl = `https://discord.com/channels/${guild.id}/${banLogChannel.id}/${sentMessage.id}`;
      }

      // Reply to the user who executed the command
      await interaction.editReply({
        content: `${member.user.username} used janny\n[View ban log](${banLogMessageUrl})`,
      });
    } catch (error) {
      console.error('Error in ban command:', error);
      await interaction.editReply({
        content: `An error occurred while banning the user: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
}
