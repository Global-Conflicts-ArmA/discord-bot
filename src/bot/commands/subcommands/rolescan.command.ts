import { SlashCommandPipe } from "@discord-nestjs/common";
import { Command, DiscordClientProvider, EventParams, Handler, InteractionEvent } from "@discord-nestjs/core";
import { ChatInputCommandInteraction, ClientEvents, TextChannel, GuildMemberRoleManager } from "discord.js";

// Authorized roles that can run this command
const AUTHORIZED_ROLES = [
  '635885925003690006', // Admin
  '824719678475599882', // Moderator
];

// Role IDs for role scanning
const MEMBER_ROLE_ID = '1387180331085336616';
const NEW_GUY_ROLE_ID = '745753270055862332';

@Command({ 
  name: 'rolescan', 
  description: 'Scans all members with the Member role and removes the New Guy role from those who have both.',
})
export class RoleScanCommand {
  constructor(private readonly discordProvider: DiscordClientProvider) {}

  @Handler()
  async onRoleScanCommand(
    @InteractionEvent(SlashCommandPipe) options: any,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;
    const member = interaction.member;
    const channel = interaction.channel as TextChannel;
    const guild = interaction.guild;

    // Validate member exists
    if (!member) {
      await interaction.reply({
        content: 'Unable to determine member. Please try again.',
        ephemeral: true,
      });
      return;
    }

    // Permission check
    const hasPermission = AUTHORIZED_ROLES.some(roleId => (member.roles as GuildMemberRoleManager).cache.has(roleId));

    if (!hasPermission) {
      await interaction.reply({
        content: 'You do not have permission to run this command.',
        ephemeral: true,
      });
      return;
    }

    // Defer the reply as this operation may take time
    await interaction.deferReply();

    try {
      // Fetch all members
      const members = await guild.members.fetch();
      
      let scannedCount = 0;
      let removedCount = 0;
      const removedUsers: string[] = [];

      // Iterate through all members
      for (const [, guildMember] of members) {
        // Check if member has the Member role
        if (guildMember.roles.cache.has(MEMBER_ROLE_ID)) {
          scannedCount++;

          // Check if member also has the New Guy role
          if (guildMember.roles.cache.has(NEW_GUY_ROLE_ID)) {
            try {
              await guildMember.roles.remove(NEW_GUY_ROLE_ID);
              removedCount++;
              removedUsers.push(`${guildMember.user.tag}`);
            } catch (error) {
              console.error(`Failed to remove role from ${guildMember.user.tag}:`, error);
            }
          }
        }
      }

      // Send summary
      let summary = `**Role Scan Complete**\n`;
      summary += `Members with Member role: ${scannedCount}\n`;
      summary += `New Guy roles removed: ${removedCount}\n`;

      if (removedCount > 0) {
        summary += `\n**Users who had the New Guy role removed:**\n`;
        summary += removedUsers.join('\n');
      }

      await interaction.editReply({
        content: summary,
      });
    } catch (error) {
      console.error('Error in rolescan command:', error);
      await interaction.editReply({
        content: `An error occurred while scanning roles: ${error.message}`,
      });
    }
  }
}
