import * as mongo from 'mongodb';
import { Client, GuildMember, User } from 'discord.js';
import { MONGO_COLLECTIONS } from './event-ops.constants';
import {
  EventOpsEvent,
  EventOpsMission,
  EventOpsSettings,
  EventOpsSlot,
} from './event-ops.types';
import { formatSectionMessage } from './message-formatter';

// TEMPORARY module — see README.md in this directory.
// Mongo is the source of truth for slot state — these helpers never touch the Sheets API.

// The name shown for a user in signup rosters, the sheet, and history logs.
// GuildMember#displayName and User#displayName already fall back through
// nickname -> global display name -> username on their own, so this just
// prefers the guild-specific one (a per-server nickname) when set.
export function getDisplayName(member: GuildMember | null, user: User): string {
  return member?.displayName || user.displayName;
}

export async function getActiveEvent(
  db: mongo.Db,
): Promise<EventOpsEvent | null> {
  return db
    .collection(MONGO_COLLECTIONS.events)
    .findOne({}) as unknown as Promise<EventOpsEvent | null>;
}

export async function getSettings(
  db: mongo.Db,
): Promise<EventOpsSettings | null> {
  return db
    .collection(MONGO_COLLECTIONS.settings)
    .findOne({}) as unknown as Promise<EventOpsSettings | null>;
}

export async function getMissionForChannel(
  db: mongo.Db,
  channelId: string,
): Promise<EventOpsMission | null> {
  return db
    .collection(MONGO_COLLECTIONS.missions)
    .findOne({ channelId }) as unknown as Promise<EventOpsMission | null>;
}

export async function getSlotsForChannel(
  db: mongo.Db,
  eventName: string,
  channelId: string,
): Promise<EventOpsSlot[]> {
  return db
    .collection(MONGO_COLLECTIONS.slots)
    .find({ eventName, channelId })
    .toArray() as unknown as Promise<EventOpsSlot[]>;
}

// Shared by autocomplete and the signup-search modal: open slots in a
// channel (optionally narrowed to one section, e.g. when the search was
// triggered from a specific section's button), optionally filtered by slot #
// or role (case-insensitive substring match), sorted numerically by slot ID.
export async function searchOpenSlots(
  db: mongo.Db,
  eventName: string,
  channelId: string,
  term: string,
  section?: string,
): Promise<EventOpsSlot[]> {
  const filter: Record<string, unknown> = { eventName, channelId, player: '' };
  if (section) filter.section = section;

  const openSlots = (await db
    .collection(MONGO_COLLECTIONS.slots)
    .find(filter)
    .toArray()) as unknown as EventOpsSlot[];

  const needle = term.trim().toLowerCase();
  const filtered = needle
    ? openSlots.filter(
        (s) =>
          s.slotId.toLowerCase().includes(needle) ||
          s.role.toLowerCase().includes(needle) ||
          s.section.toLowerCase().includes(needle),
      )
    : openSlots;

  return filtered.sort((a, b) => Number(a.slotId) - Number(b.slotId));
}

// Backs /event-sync's sheet_name autocomplete — distinct mission sheet/tab
// names for the active event, filtered by a case-insensitive substring match.
export async function searchMissionSheetNames(
  db: mongo.Db,
  eventName: string,
  term: string,
): Promise<string[]> {
  const missions = (await db
    .collection(MONGO_COLLECTIONS.missions)
    .find({ eventName })
    .toArray()) as unknown as EventOpsMission[];

  const names = [...new Set(missions.map((m) => m.sheetName))];
  const needle = term.trim().toLowerCase();
  const filtered = needle
    ? names.filter((n) => n.toLowerCase().includes(needle))
    : names;
  return filtered.sort((a, b) => a.localeCompare(b));
}

// Shared by /event-status and the "My Status" button — every slot the given
// user holds across the whole active event, not just the current channel.
export async function getUserStatusMessage(
  db: mongo.Db,
  userId: string,
): Promise<string> {
  const event = await getActiveEvent(db);
  if (!event) return 'There is no active event.';

  const mySlots = (await db
    .collection(MONGO_COLLECTIONS.slots)
    .find({ eventName: event.eventName, discordUserId: userId })
    .toArray()) as unknown as EventOpsSlot[];

  if (mySlots.length === 0)
    return "You're not registered in any slot for this event.";

  const lines = mySlots.map(
    (s) =>
      `• **${s.role}** in **${s.section}** (slot #${s.slotId}) — <#${s.channelId}>`,
  );
  return `You're registered in:\n${lines.join('\n')}`;
}

export async function refreshSectionMessage(
  db: mongo.Db,
  discordClient: Client,
  event: EventOpsEvent,
  mission: EventOpsMission,
  section: string,
): Promise<void> {
  const sectionSlots = (await db
    .collection(MONGO_COLLECTIONS.slots)
    .find({ eventName: event.eventName, channelId: mission.channelId, section })
    .toArray()) as unknown as EventOpsSlot[];
  if (sectionSlots.length === 0) return;

  const sectionDoc = await db.collection(MONGO_COLLECTIONS.sections).findOne({
    eventName: event.eventName,
    channelId: mission.channelId,
    section,
  });
  if (!sectionDoc) return;

  const channel = await discordClient.channels
    .fetch(mission.channelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = formatSectionMessage(section, sectionSlots, mission.sheetName);
  await channel.messages
    .edit(sectionDoc.messageId as string, { embeds: [embed] })
    .catch(() => null);
}
