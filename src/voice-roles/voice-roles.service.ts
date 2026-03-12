import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client, Events } from 'discord.js';
import { DiscordClientProvider } from '@discord-nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule'; // For cron job

interface RoleMap {
  [channelId: string]: string; // VoiceChannelId: RoleId
}

interface ChannelMap {
  [voiceChannelId: string]: string; // VoiceChannelId: TextChannelId
}

@Injectable()
export class VoiceRolesService implements OnModuleInit {
  private readonly logger = new Logger(VoiceRolesService.name);

  private readonly ROLE_MAP: RoleMap = {
    '1345427443485507595': '1383397735574667395', // Voice channel ID: Role ID
    '1345427608145498122': '1383378111940399184',
    '1345427903101538345': '1383397786627604491',
    '1383360885057261628': '1383397817871106119',
    '1345399702450999306': '1345400300261085258', //Test ID
  };

  // Map voice channels to their corresponding text channels for announcements
  private readonly CHANNEL_MAP: ChannelMap = {
    '1345427443485507595': '1383397063147913306', // Voice channel: Text channel for announcements
    '1345427608145498122': '1383376631992684574',
    '1345427903101538345': '1383397102469775390',
    '1383360885057261628': '1383397137525768222',
    '1345399702450999306': '1345421047054336042', //Test ID
  };

  // List of text channel IDs for message cleanup
  private readonly CLEANUP_CHANNEL_IDS: string[] = [
    '1383397063147913306', // Text channel IDs
    '1383376631992684574',
    '1383397102469775390',
    '1383397137525768222',
    '1345421047054336042', //Test ID
  ];

  constructor(private readonly discordProvider: DiscordClientProvider) {}

  onModuleInit() {
    const client = this.discordProvider.getClient();
    this.setupVoiceRoles(client);
  }

  private setupVoiceRoles(client: Client) {
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      const member = newState.member;
      if (!member || !member.guild) return;

      this.logger.log(`Voice state update: ${member.user.tag} - Before: ${oldState.channel?.id}, After: ${newState.channel?.id}`);

      if (!newState.channel && oldState.channel) {
        const roleId = this.ROLE_MAP[oldState.channel.id];
        if (roleId && member.roles.cache.has(roleId)) {
          try {
            await member.roles.remove(roleId);
            this.logger.log(`Removed role ${roleId} from ${member.user.tag}`);
          } catch (e) {
            this.logger.error(`Error removing role ${roleId} from ${member.user.tag}: ${e}`);
          }
        }
      }

      if (newState.channel && newState.channel.id !== oldState.channel?.id) {
        const roleId = this.ROLE_MAP[newState.channel.id];
        if (roleId && !member.roles.cache.has(roleId)) {
          try {
            await member.roles.add(roleId);
            this.logger.log(`Assigned role ${roleId} to ${member.user.tag}`);

            // Post announcement message to the corresponding text channel
            const textChannelId = this.CHANNEL_MAP[newState.channel.id];
            if (textChannelId) {
              const textChannel = member.guild.channels.cache.get(textChannelId);
              if (textChannel && textChannel.isTextBased()) {
                try {
                  await textChannel.send(`${member.user} joined ${newState.channel.name}!`);
                  this.logger.log(`Posted announcement for ${member.user.tag} joining ${newState.channel.name}`);
                } catch (messageError) {
                  this.logger.error(`Error posting announcement message: ${messageError}`);
                }
              }
            }
          } catch (e) {
            this.logger.error(`Error adding role ${roleId} to ${member.user.tag}: ${e}`);
          }
        }
      }

      if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        const oldRoleId = this.ROLE_MAP[oldState.channel.id];
        if (oldRoleId && member.roles.cache.has(oldRoleId)) {
          try {
            await member.roles.remove(oldRoleId);
            this.logger.log(`Removed old role ${oldRoleId} from ${member.user.tag}`);
          } catch (e) {
            this.logger.error(`Error removing old role ${oldRoleId} from ${member.user.tag}: ${e}`);
          }
        }
      }
    });
  }

  @Cron(CronExpression.EVERY_HOUR) // Runs every hour
//  @Cron('*/10 * * * * *') // Runs every 10 seconds test
  async handleMessageCleanup(): Promise<void> {
    this.logger.log('Cron job triggered'); // Log
    const client = this.discordProvider.getClient();
    const guild = client.guilds.cache.get(process.env.DISCORD_SERVER_ID);
    if (!guild) {
      this.logger.error('Guild not found');
      return;
    }

    for (const channelId of this.CLEANUP_CHANNEL_IDS) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        this.logger.error(`Channel ${channelId} not found or not text-based`);
        continue;
      }

      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        //const oneDayAgo = now - 1 * 1 * 10 * 1000; // 10 seconds test

        const messagesToDelete = messages.filter((msg) => msg.createdTimestamp < oneDayAgo);

        if (messagesToDelete.size > 0) {
          await channel.bulkDelete(messagesToDelete);
          this.logger.log(`Deleted ${messagesToDelete.size} messages older than 24 hours in channel ${channelId}`);
        } else {
          this.logger.log(`No messages to delete in channel ${channelId}`);
        }
      } catch (error) {
        this.logger.error(`Failed to clean up messages in channel ${channelId}`, error.stack);
      }
    }
  }
}