// TEMPORARY module — see README.md in this directory.

export interface EventOpsSettings {
  categoryId: string;
}

export interface EventOpsEvent {
  eventName: string;
  eventDisplayName: string;
  sheetId: string;
  eventChatId: string;
  // Optional: events created before this field existed won't have it —
  // callers should treat a missing historyChannelId as "no Discord log,
  // sheet only" rather than an error.
  historyChannelId?: string;
  categoryId: string;
  guildId: string;
  createdAt: Date;
}

export interface EventOpsMission {
  eventName: string;
  missionNumber: string;
  missionDescription: string;
  sheetName: string;
  channelId: string;
}

export interface EventOpsSection {
  eventName: string;
  channelId: string;
  section: string;
  messageId: string;
}

// Raw shape of a row read straight from a Google Sheet slot-list tab.
export interface SlotRow {
  rowIndex: number; // 0-based index into the tab's data rows (excluding header)
  SlotID: string;
  Section: string;
  Role: string;
  Player: string;
  Description: string;
  'Discord User ID': string;
}

// Mongo is the source of truth for live slot state once an event is set up.
// The sheet is pushed to after every change, and pulled from (via /event-sync)
// only for slots where `player` is empty — see README.md.
export interface EventOpsSlot {
  eventName: string;
  channelId: string; // mission channel this slot belongs to
  sheetName: string; // tab name, needed to push writes back to the right tab
  rowIndex: number; // row position in that tab, for writing back
  slotId: string;
  section: string;
  role: string;
  description: string;
  player: string; // '' = open; non-empty = occupied (a name, or e.g. "Blocked")
  discordUserId: string; // '' if none (walk-in / blocked / not linked)
}
