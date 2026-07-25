import { Command, EventParams, Handler } from '@discord-nestjs/core';
import { ChatInputCommandInteraction, ClientEvents } from 'discord.js';

// TEMPORARY command — see README.md in temp-event-ops/.

const HELP_TEXT =
  '📋 **Event Commands:**\n\n' +
  'To sign up, leave a slot, or check your status, use the **Show Open Slots** / **Leave My Slot** / **My Status** buttons on the ' +
  'pinned message in each mission channel — regular chat (and typing slash commands) is disabled in those channels, so the buttons ' +
  'are how you interact there.\n\n' +
  '`/event-status` - Show every slot you hold across the whole event (works in any channel)\n' +
  '`/event-help` - Show this message\n\n' +
  'Note: you can only hold one slot per **mission** — signing up for one side of a mission blocks the other side until you leave it. ' +
  'You can still join as many different missions as you like.\n\n' +
  '**Admin Commands:**\n' +
  '`/event-config category_id:<id>` - Set the category event channels are created under\n' +
  '`/event-setup name:<string> sheet_url:<string> [reset_before_setup:true]` - Set up a new event ' +
  '(reset_before_setup clears leftover data if reusing the same sheet)\n' +
  '`/event-sync` - Pull sheet edits into open slots (block a slot, change a role, register a walk-in — just edit the sheet, then run this)\n' +
  '`/event-teardown` - Remove the active event and its channels\n' +
  '`/admin-help` - Post the full admin reference in this channel';

@Command({
  name: 'event-help',
  description: '[TEMP] Show event command help.',
})
export class EventHelpCommand {
  @Handler()
  async onCommand(
    @EventParams() args: ClientEvents['interactionCreate'],
  ): Promise<void> {
    const interaction = args[0] as ChatInputCommandInteraction;
    await interaction.reply({ content: HELP_TEXT, ephemeral: true });
  }
}
