import { Client } from 'discord.js';
import * as mongo from 'mongodb';
import { MONGO_COLLECTIONS } from './event-ops.constants';
import { refreshSectionMessage } from './event-ops.helpers';
import {
  EventOpsEvent,
  EventOpsMission,
  EventOpsSlot,
} from './event-ops.types';
import { SheetsClientService } from './sheets-client.service';

// TEMPORARY module — see README.md in this directory.
//
// Shared business logic for claiming/freeing a slot, used by both the
// /event-signup /event-deslot slash commands AND the button+select-menu UI
// on the roster messages — one atomic-claim implementation, not two.

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Writes an audit-trail entry to both places: the sheet's "History" tab
// (always — that's the durable record) and the event's #event-history
// channel (best-effort — events created before that channel existed won't
// have historyChannelId, and the channel may already be gone during
// teardown, so a missing/broken channel is not an error here).
export async function logEventHistory(
  discordClient: Client,
  sheets: SheetsClientService,
  event: EventOpsEvent,
  actor: string,
  action: string,
): Promise<void> {
  await sheets.logHistory(event.sheetId, actor, action);

  if (!event.historyChannelId) return;
  try {
    const channel = await discordClient.channels
      .fetch(event.historyChannelId)
      .catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel.send(`**${actor}** — ${action}`);
    }
  } catch (err: any) {
    console.error(
      `[temp-event-ops] Failed to post history log to Discord: ${err.message}`,
    );
  }
}

export async function performSignup(
  db: mongo.Db,
  sheets: SheetsClientService,
  discordClient: Client,
  event: EventOpsEvent,
  mission: EventOpsMission,
  slotId: string,
  discordUserId: string,
  displayName: string,
): Promise<ActionResult> {
  const slots = db.collection(MONGO_COLLECTIONS.slots);

  // A mission can have multiple "sides" (e.g. "Mission 1 - US" and
  // "Mission 1 - USSR" both share missionNumber "Mission 1") — a user may
  // only hold a slot on one side of a given mission, though they can join
  // as many *different* missions as they like.
  const siblingMissions = (await db
    .collection(MONGO_COLLECTIONS.missions)
    .find({ eventName: event.eventName, missionNumber: mission.missionNumber })
    .toArray()) as unknown as EventOpsMission[];
  const siblingChannelIds = siblingMissions.map((m) => m.channelId);

  const existing = (await slots.findOne({
    eventName: event.eventName,
    channelId: { $in: siblingChannelIds },
    discordUserId,
  })) as unknown as EventOpsSlot | null;

  if (existing) {
    if (
      existing.channelId === mission.channelId &&
      existing.slotId === slotId
    ) {
      return {
        ok: false,
        message: `You're already registered in slot #${slotId}.`,
      };
    }
    const sideNote =
      existing.channelId === mission.channelId
        ? ''
        : ' on the other side of this mission';
    return {
      ok: false,
      message: `You're already registered as **${existing.role}** in **${existing.section}** (slot #${existing.slotId})${sideNote}. Free that slot first (Leave My Slot button, or /event-deslot for staff) if you want to switch.`,
    };
  }

  const claim = await slots.findOneAndUpdate(
    {
      eventName: event.eventName,
      channelId: mission.channelId,
      slotId,
      player: '',
    },
    { $set: { player: displayName, discordUserId } },
    { returnDocument: 'after' },
  );

  if (!claim.value) {
    // Someone else grabbed it between the check above and this claim (rare), or it's blocked/missing.
    const slot = (await slots.findOne({
      eventName: event.eventName,
      channelId: mission.channelId,
      slotId,
    })) as unknown as EventOpsSlot | null;

    if (!slot) return { ok: false, message: `Slot #${slotId} not found.` };
    if (slot.player.toLowerCase().includes('blocked')) {
      return {
        ok: false,
        message: `Slot #${slotId} is blocked. See the sheet description for this slot or choose another.`,
      };
    }
    return {
      ok: false,
      message: `Slot #${slotId} is taken by **${slot.player}**.`,
    };
  }

  const slot = claim.value as unknown as EventOpsSlot;

  try {
    await sheets.setSlotOccupant(
      event.sheetId,
      slot.sheetName,
      slot.rowIndex,
      displayName,
      discordUserId,
    );
  } catch (err: any) {
    console.error(
      `[temp-event-ops] Failed to push signup to sheet for slot #${slotId}:`,
      err.message,
    );
  }

  await logEventHistory(
    discordClient,
    sheets,
    event,
    displayName,
    `Signed up as ${slot.role} in ${slot.section} (slot #${slotId})`,
  );
  await refreshSectionMessage(db, discordClient, event, mission, slot.section);

  return {
    ok: true,
    message: `Registered as **${slot.role}** in **${slot.section}** (slot #${slotId})!`,
  };
}

// No slot ID needed — a user can only hold one slot per mission channel, so
// this just finds whichever slot their Discord ID is registered in for this
// channel and clears it.
export async function performDeslot(
  db: mongo.Db,
  sheets: SheetsClientService,
  discordClient: Client,
  event: EventOpsEvent,
  mission: EventOpsMission,
  discordUserId: string,
  displayName: string,
): Promise<ActionResult> {
  const slots = db.collection(MONGO_COLLECTIONS.slots);

  const claim = await slots.findOneAndUpdate(
    { eventName: event.eventName, channelId: mission.channelId, discordUserId },
    { $set: { player: '', discordUserId: '' } },
    { returnDocument: 'after' },
  );

  if (!claim.value) {
    return { ok: false, message: "You're not registered in this mission." };
  }

  const slot = claim.value as unknown as EventOpsSlot;

  try {
    await sheets.clearSlotOccupant(
      event.sheetId,
      slot.sheetName,
      slot.rowIndex,
    );
  } catch (err: any) {
    console.error(
      `[temp-event-ops] Failed to push deslot to sheet for slot #${slot.slotId}:`,
      err.message,
    );
  }

  await logEventHistory(
    discordClient,
    sheets,
    event,
    displayName,
    `Deslotted from ${slot.role} (slot #${slot.slotId})`,
  );
  await refreshSectionMessage(db, discordClient, event, mission, slot.section);

  return {
    ok: true,
    message: `Removed from **${slot.role}** (slot #${slot.slotId}).`,
  };
}
