import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { EventOpsSlot } from './event-ops.types';

// TEMPORARY module — see README.md in this directory.

const COLOR_USSR = 0xe74c3c; // red
const COLOR_US = 0x3498db; // blue
const COLOR_DEFAULT = 0x95a5a6; // neutral grey

// Mission channels deny @everyone Send Messages (see README "Mission channels
// are read-only for chat"), and it turns out Discord requires Send Messages
// AND Use Application Commands to invoke a slash command in a channel — so
// regular players can never actually type /event-signup or /event-deslot in
// a mission channel, only staff. Buttons/select-menus are exempt from that
// requirement (they're component interactions, not message sends), so these
// two buttons are the real signup path for players; the slash commands stay
// as a staff-usable fallback.
export const EVENT_OPS_CUSTOM_IDS = {
  openSlots: 'event-ops:open-slots',
  leaveSlot: 'event-ops:leave-slot',
  selectSlot: 'event-ops:select-slot',
  myStatus: 'event-ops:my-status',
};

export function buildSignupButtonsRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>({
    components: [
      new ButtonBuilder()
        .setCustomId(EVENT_OPS_CUSTOM_IDS.openSlots)
        .setLabel('Show Open Slots')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(EVENT_OPS_CUSTOM_IDS.leaveSlot)
        .setLabel('Leave My Slot')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(EVENT_OPS_CUSTOM_IDS.myStatus)
        .setLabel('My Status')
        .setStyle(ButtonStyle.Success),
    ],
  });
}

export type Faction = 'ussr' | 'us' | 'other';

// Order matters: "USSR" contains "US" as a substring, so it must be checked first.
export function factionOf(missionName: string): Faction {
  const upper = missionName.toUpperCase();
  if (upper.includes('USSR')) return 'ussr';
  if (upper.includes('US')) return 'us';
  return 'other';
}

function colorForMission(missionName: string): number {
  const faction = factionOf(missionName);
  if (faction === 'ussr') return COLOR_USSR;
  if (faction === 'us') return COLOR_US;
  return COLOR_DEFAULT;
}

// Discord channel topics cap at 1024 characters. Sheet link + instructions
// are fixed-length and take priority; the free-text description gets
// truncated if there isn't room for all of it.
export function buildMissionChannelTopic(
  description: string,
  sheetLink: string,
): string {
  const instructions =
    `\n\nThis channel is sign-up only.\n` +
    `Sheet: ${sheetLink}\n` +
    `Use the buttons on the pinned message below to sign up, leave a slot, or check your status.`;
  const body = description || 'No description provided.';
  const maxBodyLen = Math.max(0, 1024 - instructions.length);
  const truncatedBody =
    body.length > maxBodyLen
      ? `${body.slice(0, Math.max(0, maxBodyLen - 1))}…`
      : body;
  return `${truncatedBody}${instructions}`.slice(0, 1024);
}

export function formatSectionMessage(
  section: string,
  slots: EventOpsSlot[],
  missionName: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(section)
    .setColor(colorForMission(missionName));

  const fields = slots.slice(0, 25).map((s) => {
    const blocked = (s.player || '').toLowerCase().includes('blocked');
    const value = blocked ? 'Blocked' : s.player ? s.player : 'Open';
    return {
      name: `#${s.slotId} ${s.role || 'Unknown'}`.slice(0, 256),
      value: value.slice(0, 1024) || 'Open',
      inline: true,
    };
  });
  embed.addFields(fields);

  if (slots.some((s) => (s.player || '').toLowerCase().includes('blocked'))) {
    embed.setFooter({
      text: 'Some slots in this section are blocked — see the sheet for details.',
    });
  }

  return embed;
}

export const SIGNUP_HELP_MESSAGE =
  '**How to sign up:**\n' +
  '**Show Open Slots** — pick a slot from the dropdown to join it.\n' +
  '**Leave My Slot** — frees whatever slot you hold here.\n' +
  '**My Status** — shows every slot you hold across the whole event.\n\n' +
  "*This channel is sign-up only — regular messages aren't allowed here.*";

export function groupBySection(
  slots: EventOpsSlot[],
): Map<string, EventOpsSlot[]> {
  const sections = new Map<string, EventOpsSlot[]>();
  for (const slot of slots) {
    const section = slot.section || 'Unknown';
    const existing = sections.get(section);
    if (existing) {
      existing.push(slot);
    } else {
      sections.set(section, [slot]);
    }
  }
  return sections;
}
