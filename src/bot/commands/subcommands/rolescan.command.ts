import { SlashCommandPipe } from '@discord-nestjs/common';
import {
  Command,
  EventParams,
  Handler,
  InteractionEvent,
} from '@discord-nestjs/core';
import {
  ChatInputCommandInteraction,
  ClientEvents,
  PermissionFlagsBits,
} from 'discord.js';

@Command({
  name: 'rolescan',
  description:
    'Scans all members with the Member role and removes the New Guy role from those who have both.',
  defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
  dmPermission: false,
})
export class RoleScanCommand {
  @Handler()
  async onRoleScanCommand(
    @InteractionEvent(SlashCommandPipe) options: any,
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const memberRoleId = process.env.DISCORD_MEMBER_ROLE_ID;
    const newGuyRoleId = process.env.DISCORD_NEW_GUY_ROLE_ID;
    if (!memberRoleId || !newGuyRoleId) {
      await interaction.reply({
        content:
          'Role configuration is missing. Set DISCORD_MEMBER_ROLE_ID and DISCORD_NEW_GUY_ROLE_ID.',
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
        if (guildMember.roles.cache.has(memberRoleId)) {
          scannedCount++;

          // Check if member also has the New Guy role
          if (guildMember.roles.cache.has(newGuyRoleId)) {
            try {
              await guildMember.roles.remove(newGuyRoleId);
              removedCount++;
              removedUsers.push(`${guildMember.user.tag}`);
            } catch (error) {
              console.error(
                `Failed to remove role from ${guildMember.user.tag}:`,
                error,
              );
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
        content: `An error occurred while scanning roles: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
}
