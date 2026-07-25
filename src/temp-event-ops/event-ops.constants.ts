import { GuildMember } from 'discord.js';

// TEMPORARY module — see README.md in this directory.

// Hardcoded on top of the DISCORD_ADMIN_ROLE_ID role check, intentionally,
// for this temporary system only.
const SUPER_USER_IDS = ['96942284502757376'];

export const MONGO_COLLECTIONS = {
  settings: 'tempEventOps_settings',
  events: 'tempEventOps_events',
  missions: 'tempEventOps_missions',
  sections: 'tempEventOps_sections',
  slots: 'tempEventOps_slots',
};

export function isEventOpsAdmin(
  member: GuildMember | null | undefined,
): boolean {
  if (!member) return false;
  if (SUPER_USER_IDS.includes(member.id)) return true;
  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
  return !!adminRoleId && member.roles.cache.has(adminRoleId);
}
