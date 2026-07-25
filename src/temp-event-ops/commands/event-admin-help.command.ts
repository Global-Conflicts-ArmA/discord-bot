import { Command, EventParams, Handler } from '@discord-nestjs/core';
import {
  ChatInputCommandInteraction,
  ClientEvents,
  GuildMember,
} from 'discord.js';
import { isEventOpsAdmin } from '../event-ops.constants';

// TEMPORARY command — see README.md in temp-event-ops/.

const ADMIN_HELP_TEXT =
  '📋 **Event Ops — Admin Reference**\n\n' +
  '`/event-config category_id:<id>` — one-time setup. Sets which existing category new event channels get created under. ' +
  'Right-click the category with Developer Mode on → Copy Channel ID.\n\n' +
  '`/event-setup name:<string> sheet_url:<string> [reset_before_setup:true]` — creates the event-chat channel, an event-history ' +
  'channel, and one channel per slot-list tab from the sheet\'s "Event Overview" tab, and posts the live roster tables. Since the ' +
  'same sheet gets reused across events, pass `reset_before_setup:true` to wipe leftover Player/Discord ID data first — otherwise ' +
  "leftover registrations from the sheet's last use get seeded as already-occupied (you'll get a warning if so).\n\n" +
  '`/event-sync [sheet_name:<tab>]` — pulls sheet edits into Mongo, but **only for slots with no real player registered** (an empty ' +
  'cell or `Blocked` both count as syncable — Blocked is a placeholder, not a real registration). Pass `sheet_name` (autocompleted) ' +
  'to sync just one slot-list tab instead of every tab in the event. This is how you:\n' +
  "  • **Block / un-block a slot** — type `Blocked` into an open slot's Player cell (or clear it back out), then run this.\n" +
  '  • **Change a role/section/description** on an open or blocked slot — edit the cell, then run this.\n' +
  "  • **Register a walk-in** (no Discord signup) — type a name (+ optionally a Discord User ID) into an open slot's Player cell, " +
  'then run this — it becomes a real registration and shows up in the Discord roster message.\n' +
  "  • **Add/remove slot rows** — freely, as long as the row isn't currently occupied.\n" +
  '  Occupied slots are never touched — a conflicting sheet edit is reported back instead of applied.\n\n' +
  "`/event-teardown` — deletes the active event's channels (including event-history) and clears its records. Run this before the " +
  'next `/event-setup`.\n\n' +
  'All of the above require the admin role or the hardcoded super-user allowlist (see `event-ops.constants.ts`).\n\n' +
  "Every signup, deslot, and admin action here gets logged to both the sheet's **History** tab (Timestamp / User / Action) and the " +
  "event's **#event-history** channel, so you can see what happened — including sync results — without leaving Discord.\n\n" +
  '**Regular players sign up/leave/check status via the Show Open Slots / Leave My Slot / My Status buttons** on the pinned message ' +
  'in each mission channel, ' +
  'not slash commands — Discord requires Send Messages (which mission channels deny for everyone but staff) to invoke a slash command ' +
  'at all, so `/event-signup`/`/event-deslot` only actually work there for staff. `/event-signup` has a live autocomplete dropdown on ' +
  '`slot:` (start typing for a list of open slots, searchable by number, role, or section). `/event-deslot` takes no parameter at all ' +
  '— it just frees whatever slot the caller holds in that channel. `/event-status` and `/event-help` work in **any** channel, not ' +
  'gated by that restriction; `/event-status` lists every slot the caller holds across the whole event, not just the current one.\n\n' +
  '**One slot per mission, either side**: a user can hold at most one slot across all "sides" of the same numbered mission (e.g. ' +
  '"Mission 1 - US" and "Mission 1 - USSR" share missionNumber "Mission 1") — signing up for one side is blocked while registered on ' +
  'the other. They can still join as many *different* missions as they like, one side each.';

@Command({
  name: 'admin-help',
  description:
    '[TEMP] Post the admin reference for event commands in this channel.',
})
export class EventAdminHelpCommand {
  @Handler()
  async onCommand(
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

    await interaction.reply({ content: ADMIN_HELP_TEXT });
  }
}
