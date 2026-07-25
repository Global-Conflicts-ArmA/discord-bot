# TEMPORARY — Quick Event Ops

This module is a stopgap event signup system that does **not** touch the website. It exists because the real fix (rebuilding the website's event system) is a bigger project for later. Built to replace an old n8n workflow (regex-parsed text commands + n8n data tables + OAuth2 user-consent Google auth) that was unreliable and had non-working slash commands.

**When the website's event system is rebuilt, delete this whole thing:**

1. Delete the `src/temp-event-ops/` directory.
2. Remove the `TempEventOpsModule` import + the `Event*Command` provider block from `src/bot/bot.module.ts` (grep `temp-event-ops` in that file).
3. Drop the Mongo collections: `tempEventOps_settings`, `tempEventOps_events`, `tempEventOps_missions`, `tempEventOps_sections`, `tempEventOps_slots`.
4. Remove `googleapis` from `package.json` if nothing else uses it.
5. Remove `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` from `.env` if nothing else uses them.

## What it does

Supports exactly one active event at a time, backed by a Google Sheet (same shape as the old n8n flow expected):

- An **"Event Overview"** tab: columns `Mission Number`, `Description`, `Slot lists` (comma-separated list of other tab names — each becomes its own Discord channel).
- One tab **per slot list**: columns `SlotID`, `Section`, `Role`, `Player`, `Description`, `Discord User ID`.

## Data flow — Mongo is the source of truth

Live slot state (who's in what slot) lives in Mongo (`tempEventOps_slots`), not the sheet. This is a deliberate choice, made after starting out sheet-first and reconsidering:

- **`/event-signup` / `/event-deslot`** do a single atomic Mongo `findOneAndUpdate` (claim only if currently unoccupied) — instant, and immune to the double-booking race the old n8n flow had (it read-checked-wrote across 3 separate Sheets API calls with no locking). `performDeslot` takes no slot ID at all — a user can only hold one slot per mission channel, so it just finds whichever slot their Discord ID is registered in for that channel and clears it.
- **One slot per mission, either side**: `performSignup` looks up every `EventOpsMission` doc sharing the same `missionNumber` as the current channel (i.e. every "side" of that mission — e.g. "Mission 1 - US" and "Mission 1 - USSR"), and blocks the claim if the user already holds a slot in *any* of those channels. A user can still join as many different missions as they like, one side each. This check runs before the atomic claim, so there's a narrow (accepted, not engineered around — see "quick" scope) race if two concurrent requests both pass it before either commits.
- **Mongo → Sheet**: after every signup/deslot, the new state is pushed to the sheet (best-effort — a failed push doesn't fail the command, since Mongo is authoritative and the sheet is just a display/backup).
- **Sheet → Mongo**: `/event-sync [sheet_name:<tab>]` (admin-only) re-reads the sheet and merges it into Mongo, but **only for slots Mongo currently shows as syncable — empty, or `Blocked`** (see `isSyncable()` in `event-sync.command.ts`; "Blocked" is a placeholder, not a real registration, so it must stay syncable or un-blocking a slot by clearing the Player cell would never take effect). `sheet_name` (autocompleted from the active event's mission tabs) narrows the sync to a single slot-list tab instead of walking every mission — useful when you only edited one tab and don't want to wait on (or risk erroring on) the others. Omit it to sync everything, same as before. This is how staff:
  - **Block a slot** — type `Blocked` (or anything) into the Player cell of an open slot, then run `/event-sync`.
  - **Un-block a slot** — clear that cell back out, then run `/event-sync` again.
  - **Change a role/section/description** on an open (or blocked) slot — edit the cell, run `/event-sync`.
  - **Register a walk-in without Discord** — type a name (and optionally a Discord User ID) into an open slot's Player cell, run `/event-sync`. It becomes a real registration and shows up in the Discord roster message.
  - **Add or remove slot rows** — freely, as long as the row isn't currently occupied by a real registration in Mongo.

  Any sheet row for a slot Mongo shows as **truly occupied** (a real player, not just "Blocked") is left completely alone by `/event-sync` — the sync summary reports it as skipped instead of silently overwriting someone's signup. `/event-sync` is manual-only (no background polling), matching the "quick" scope.

## Roster display: embeds, not code blocks

Each section's roster is a Discord embed (`formatSectionMessage` in `message-formatter.ts`), not a monospace table — one inline field per slot (`#12 Machine Gunner` → `Open`/`Blocked`/player name), title = section name, and a footer note if any slot in that section is blocked. Color is picked from the mission/tab name: contains `USSR` → red, contains `US` (checked *after* `USSR`, since `"USSR".includes("US")` is true) → blue, otherwise neutral grey — see `colorForMission()`.

The mission description no longer gets its own message — it lives in the **channel topic** instead (`buildMissionChannelTopic`, set via `topic:` at channel creation). Topics cap at 1024 characters: the sheet link + sign-up instructions are fixed-length and take priority, the free-text description gets truncated with `…` if there isn't room for all of it. This also means there's no separate spacer message needed anymore — the first thing posted in the channel is the first section's roster embed.

## Buttons for players, slash commands for staff

Went through several iterations of button/modal/select-menu UI on the roster messages early on (all documented in git history if it's ever worth revisiting), landed back on pure slash commands for a while — but that turned out to be broken for regular players (see "Mission channels are read-only for chat" below: Discord requires **both** `Send Messages` and `Use Application Commands` to invoke a slash command in a channel, and mission channels deny `Send Messages` for everyone but staff). So buttons are back, scoped down to just three:

- **Show Open Slots** button (posted on the roster help message, `buildSignupButtonsRow` in `message-formatter.ts`) — ephemeral reply with select menu(s) of that channel's open slots. A single select menu caps out at 25 options (a hard Discord limit), so `showOpenSlots` in `event-ops-interactions.handler.ts` splits open slots across up to 5 dropdowns (125 total), each labeled with the slot range it covers — this was hit in practice on a mission with >25 open slots, where the old single-dropdown version silently truncated and told players to "ask staff." Beyond 125 open slots in one channel (not seen in practice), the remainder is still reported as not shown. Picking a slot from any of the dropdowns claims it through the same `performSignup` used by the slash command — all menus share the `event-ops:select-slot` customId prefix (suffixed `:0`-`:4`) so one handler covers all of them.
- **Leave My Slot** button — immediately frees whatever slot the clicker holds in that channel, via `performDeslot`. No confirmation step, same behavior as `/event-deslot`.
- **My Status** button — ephemeral reply listing every slot the clicker holds across the whole active event, via the shared `getUserStatusMessage` helper (`event-ops.helpers.ts`) — same logic `/event-status` uses.
- All three are handled in `EventOpsInteractionsHandler` (`events/event-ops-interactions.handler.ts`) by `customId`, using the shared constants in `EVENT_OPS_CUSTOM_IDS` (`message-formatter.ts`).

The slash commands still exist and still work — for **staff**, who get `Send Messages` in mission channels via `DISCORD_ADMIN_ROLE_ID`:

- `/event-signup slot:` has `autocomplete: true` (`EventOpsInteractionsHandler.autocompleteSignup`). Focusing the field shows a live dropdown, searchable by slot #, role, or section, listing that channel's **open** slots.
- `/event-deslot` takes **no parameter at all** — finds whichever slot the caller's Discord ID is registered in for that channel and clears it.
- `/event-status` works in **any** channel (not gated by `Send Messages` there) and lists every slot the caller holds across the whole event.

Roster embeds (`formatSectionMessage`), the channel topic (`buildMissionChannelTopic`), and the pinned help message (`SIGNUP_HELP_MESSAGE`) point regular players at the two buttons; `/event-status` is mentioned everywhere since it works outside mission channels too.

## Mission channels are read-only for chat — and that blocks slash commands too, for anyone without Send Messages

Every mission channel gets a permission overwrite at creation (`event-setup.command.ts`, `missionChannelOverwrites`): `@everyone` is denied `Send Messages` (with `View Channel` explicitly re-allowed — see gotcha below), with an explicit `allow` for `DISCORD_ADMIN_ROLE_ID` if that env var is set, so staff can still post if needed. No message-delete listener needed, no reactive cleanup — the channel just never accepts a chat message in the first place.

**This does block slash commands for regular players**, despite `Send Messages` and `Use Application Commands` being distinct permission bits. Confirmed by live testing (non-admin test account could not run `/event-signup` etc. in a mission channel while an admin/super-user account could) and by Discord's own stated design ([discord-api-docs discussion #5097](https://github.com/discord/discord-api-docs/discussions/5097), [issue #2696](https://github.com/discord/discord-api-docs/issues/2696)): Discord intentionally requires both permissions to invoke a slash command in a channel — "it didn't make sense to grant users with no ability to create messages in a channel the ability to create them via a bot." So the original assumption behind this design (that the two permissions are independent in practice) was wrong.

**Fix**: regular players don't use the slash commands in mission channels at all — they use the **Show Open Slots** / **Leave My Slot** buttons instead (see "Buttons for players, slash commands for staff" below). Button/select-menu interactions are not subject to this restriction, since they're component interactions rather than message sends. Staff, who are granted `Send Messages` via `DISCORD_ADMIN_ROLE_ID`, can still use the slash commands directly as a fallback.

### Permission overwrite saga — what we tried, what we ruled out, where it stands

This took five rounds to get right (each round only surfaced once the previous fix was live-tested), so it's written up in full to save whoever picks this up next from repeating the same detours.

**What we tried, in order:**

1. **v1** — `missionChannelOverwrites = [{ id: everyone, deny: [SendMessages] }, { id: adminRoleId, allow: [SendMessages] }]`. Goal: stop players from chatting in mission channels without affecting slash commands. Result: `/event-setup` reported `❌ Errors: ... Missing Permissions` for every mission, `0 mission channel(s)` created.
2. **v2** — added an explicit bot allow: `{ id: guild.members.me.id, allow: [SendMessages, EmbedLinks, ViewChannel] }`. Reasoning: the bot isn't `Administrator`, so denying `@everyone` was silently denying the bot too (Administrator is the only thing that bypasses channel overwrites entirely). Result: roster posting worked, but `/event-teardown` then failed with `Missing Permissions` deleting those same channels, and separately `@everyone` couldn't see the channels at all — despite the parent category explicitly granting the bot's role `Manage Channels` and granting `@everyone` `View Channel`.
3. **v3** — added `ManageChannels` to the bot's explicit allow, and `ViewChannel` to `@everyone`'s explicit allow, reasoning that the category's grants weren't reliably passing through to a channel that has *any* overwrite of its own. Result: teardown fixed. But `@everyone` could now see a channel exists (topic included) yet still couldn't see any of the **messages** already posted in it, and slash commands still didn't work there.
4. **v4** — queried `@everyone`'s guild-wide base permissions directly via the Discord REST API rather than guessing again: turned out to be `View Channel` and *nothing else*. Added `ReadMessageHistory` and `UseApplicationCommands` to `@everyone`'s (and the admin role's) explicit allow list — `EVERYONE_BASE_ALLOW` in `event-setup.command.ts`. This is what shipped and got live-tested against a real non-admin account.
5. **v5 (current)** — the v4 test confirmed the permission overwrites, base role permissions, and command-level permissions were all exactly as designed (re-verified via the REST API), yet the non-admin account still couldn't run the slash commands in a mission channel. That ruled out overwrites entirely and pointed at the design's other assumption: that `Send Messages` and `Use Application Commands` are independent. They aren't (see the section above) — so `/event-signup` and `/event-deslot` were replaced with roster buttons as the player-facing path, keeping the slash commands as a staff-only fallback. The permission overwrites themselves (`EVERYONE_BASE_ALLOW`, the `Send Messages` deny) are unchanged from v4.

**What we ruled out:**

- Relying on the parent category's permission overwrites cascading down to a channel that has its own custom overwrite for that same role — this does **not** reliably happen once the channel defines any entry of its own; confirmed by the bot losing `Manage Channels` and `@everyone` losing `View Channel` in round 2, despite both being explicitly granted at the category level.
- Assuming `@everyone`'s guild-wide base role includes the usual "member" permissions (chat, read history, use commands) — checked directly via the REST API in round 3/4; the base is `View Channel` only, everything else must be granted per-channel.
- A message-delete listener or reactive cleanup for the "no chat in mission channels" requirement — permission overwrites solve that specific problem natively with no bot-side interaction code at all (see the section above). This is still true; it's a separate concern from the Send-Messages/slash-command coupling that round 5 fixed.
- Assuming `Send Messages` and `Use Application Commands` are independent permissions in practice, just because they're separate bits — disproven in round 5 by live testing plus Discord's own confirmation that this is intentional platform behavior, not a bug.

**Where it currently stands:** `event-setup.command.ts` now builds every mission channel's (and `event-chat`'s) permission overwrites as a fully self-contained array — nothing assumed to be inherited from the category or from role defaults:
- `@everyone`: `EVERYONE_BASE_ALLOW` (`View Channel`, `Read Message History`, `Use Application Commands`) + `Send Messages` allowed on `event-chat` / denied on mission channels.
- Admin role (`DISCORD_ADMIN_ROLE_ID`): same base + `Send Messages` allowed.
- Bot (`guild.members.me.id`): `View Channel`, `Send Messages`, `Embed Links`, `Read Message History`, `Manage Channels`.

**v4 was live-verified** using the exact method described above (querying `GET /guilds/{id}/roles`, `GET /guilds/{id}/members/{id}`, `GET /channels/{id}`, and `GET /applications/{id}/guilds/{id}/commands/permissions` directly, rather than reasoning about overwrite/inheritance rules in the abstract). Result: the permission overwrites, base role permissions, and application-command permissions were all exactly as designed — `View Channel` + `Read Message History` + `Use Application Commands` allowed for `@everyone`, only `Send Messages` denied, no stray role overwrites, no command-level restrictions. And yet the non-admin test account genuinely could not use the slash commands there. That ruled out every permission-overwrite explanation and pointed at the one thing this round hadn't questioned: whether `Send Messages` and `Use Application Commands` really are independent in practice. They aren't — hence v5.

## Commands

- `/event-config category_id:<id>` — admin-only. Sets which existing Discord category new event channels get created under (pass the category's ID — right-click it with Developer Mode on → Copy Channel ID).
- `/event-setup name:<string> sheet_url:<string> [reset_before_setup:true]` — admin-only. Reads the sheet, creates an event-chat channel, an event-history channel, and one channel per slot-list tab, seeds Mongo, posts the live roster tables. Since the same sheet gets reused across events rather than a fresh one made each time, `reset_before_setup` clears every slot's Player/Discord User ID cell first (both in the sheet and in Mongo) so the new event starts genuinely empty. Without it, any leftover registrations from the sheet's last use get seeded as already-occupied, and the setup reply warns you how many.
- `/event-sync [sheet_name:<tab>]` — admin-only. See above.
- `/event-teardown` — admin-only. Deletes everything the active event created (channels + all `tempEventOps_*` records for it).
- **Show Open Slots** / **Leave My Slot** / **My Status** buttons — posted on the roster help message in every mission channel. The normal player path: mission channels deny regular members `Send Messages`, which also blocks slash commands there (see above), so these buttons (component interactions, not affected by that) are what players actually use to join/leave a slot or check what they're signed up for.
- `/event-signup slot:<number>` — run inside a mission channel. Claims a slot if open (blocked if you're already on the other side of the same mission). Works for staff (who have `Send Messages` there); regular players should use the button instead.
- `/event-deslot` — run inside a mission channel. Frees whatever slot you hold there — no slot number needed. Same staff-only caveat as above.
- `/event-status` — works in **any** channel (not gated by the `Send Messages` restriction). Lists every slot you hold across the whole event, with a `<#channel>` link for each.
- `/event-help` — lists the above (player-facing).
- `/admin-help` — admin-only. Posts a detailed reference of admin commands directly in the channel it's run in (non-ephemeral, meant to be pinned).

"Admin-only" = `DISCORD_ADMIN_ROLE_ID` role holders, plus a hardcoded super-user allowlist (currently just one Discord user ID) in `event-ops.constants.ts` — intentional for this temporary system, not meant to be a long-term pattern.

## Action log: sheet "History" tab AND an #event-history Discord channel

Every signup, deslot, and admin action (`/event-setup`, `/event-sync`, `/event-teardown`) is logged in two places via the shared `logEventHistory` helper (`event-ops.actions.ts`):

- The sheet's **History** tab (`Timestamp | User | Action`), via `SheetsClientService.logHistory` — the durable record, unaffected by anything happening to the event's Discord channels.
- The event's **#event-history** channel — created alongside event-chat in `/event-setup` with the same read-only permission overwrites as mission channels (`missionChannelOverwrites`; deny `Send Messages` for `@everyone`, allow for staff), so it's a plain scrolling log players can read but not post in. Each entry is posted as `**actor** — action`.

Both writes are best-effort — a failure in either is caught and logged server-side, never blocks the actual command. `/event-teardown` deletes the event-history channel along with everything else, so its own final "Ran /event-teardown" log line goes to the sheet only (there's no channel left to post it to by that point) — see the comment in `event-teardown.command.ts`.

Events created before this feature existed won't have a `historyChannelId` in their Mongo doc (`EventOpsEvent.historyChannelId` is optional for exactly this reason) — `logEventHistory` just skips the Discord post and still writes to the sheet in that case.

## Display names: prefer the server nickname, then Discord's global display name

`getDisplayName(member, user)` in `event-ops.helpers.ts` is what every roster entry, sheet write, and history log actually shows for a user — not their raw username. It prefers, in order: their per-server nickname (`GuildMember#displayName`), then their Discord-wide "display name" (`User#displayName`, i.e. `globalName ?? username` — the name shown by default now that Discord has mostly retired unique-with-discriminator usernames), then falls back to `username` if somehow neither is set.

This needed **discord.js 14.12.0+** — `14.11.0` (installed at the time) never parsed the API's `global_name` field at all, so `User#displayName`/`#globalName` didn't exist and the old code (`member?.nickname || interaction.user.username`) silently skipped straight to the raw username for anyone without a per-server nickname. Bumped to `14.27.0` to fix this; verified no other breakage across the whole bot (`tsc --noEmit` + `nest build` clean) except one real hit unrelated to event ops — `PonyBot.listener.ts` needed a `message.channel.isSendable()` guard because that discord.js version added `PartialGroupDMChannel` to the channel union type.

## Design notes

- Google Sheets access uses a **service account** (`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`), not OAuth2 user consent — no token refresh/expiry to manage. The target sheet must be shared with the service account's email as Editor.
- The category channels get created under is a fixed, admin-configured category (`/event-config`), not a fresh category per event — this matches how the old flow actually behaved in practice (it had dynamic per-event category creation but the node was disabled, so everything landed in one hardcoded category).
- Sheets return blank rows as `[]` and omit empty trailing cells — `getSlotRows` filters out any row with no `SlotID` (blank spacer rows between sections in the sheet), otherwise they'd show up as phantom "Unknown" slots.
