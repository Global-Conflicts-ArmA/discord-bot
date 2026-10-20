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

// Role IDs - Update these with your actual role IDs
const GUEST_ROLE_ID = '1387180331085336616';
const NEW_GUY_ROLE_ID = '745753270055862332';
const MEMBER_ROLE_ID = '746545788930359358';

@Command({
  name: 'guestreset',
  description:
    'Scans users with guest role and reassigns them based on member status.',
  defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
  dmPermission: false,
})
export class GuestResetCommand {
  @Handler()
  async onGuestResetCommand(
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

    // Defer the reply as this operation may take time
    await interaction.deferReply();

    try {
      // Fetch all members with the guest role
      const guestRole = await guild.roles.fetch(GUEST_ROLE_ID);
      if (!guestRole) {
        await interaction.editReply({
          content: 'Guest role not found. Please check the role ID.',
        });
        return;
      }

      const memberRole = await guild.roles.fetch(MEMBER_ROLE_ID);
      const newGuyRole = await guild.roles.fetch(NEW_GUY_ROLE_ID);

      if (!newGuyRole) {
        await interaction.editReply({
          content: 'New Guy role not found. Please check the role ID.',
        });
        return;
      }

      // Fetch all members
      const allMembers = await guild.members.fetch();
      const guestMembers = allMembers.filter((m) =>
        m.roles.cache.has(GUEST_ROLE_ID),
      );

      let processedCount = 0;
      let skippedCount = 0;
      const errors = [];

      // Process each guest member
      for (const [, guestMember] of guestMembers) {
        try {
          const isMember =
            memberRole && guestMember.roles.cache.has(MEMBER_ROLE_ID);

          if (isMember) {
            // Just remove guest role if they have member role
            await guestMember.roles.remove(guestRole);
          } else {
            // Remove guest and assign new guy if they don't have member role
            await guestMember.roles.remove(guestRole);
            await guestMember.roles.add(newGuyRole);
          }

          processedCount++;
        } catch (error) {
          errors.push(
            `Failed to process ${guestMember.user.username}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          skippedCount++;
        }
      }

      // Build response message
      let responseMessage = `**Guest Reset Complete**\n`;
      responseMessage += `**Processed:** ${processedCount} users\n`;
      responseMessage += `**Skipped:** ${skippedCount} users\n`;
      responseMessage += `**Timestamp:** <t:${Math.floor(
        Date.now() / 1000,
      )}:F>\n`;

      if (errors.length > 0) {
        responseMessage += `\n**Errors:**\n${errors.join('\n')}`;
      }

      await interaction.editReply({
        content: responseMessage,
      });
    } catch (error) {
      console.error('Error in guest reset command:', error);
      await interaction.editReply({
        content: `An error occurred while processing guests: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
}
