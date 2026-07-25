import { Injectable } from '@nestjs/common';
import { DiscordClientProvider, On } from '@discord-nestjs/core';
import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonInteraction,
  GuildMember,
  Interaction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as mongo from 'mongodb';
import { InjectDb } from 'nest-mongodb';
import { performDeslot, performSignup } from '../event-ops.actions';
import {
  getActiveEvent,
  getDisplayName,
  getMissionForChannel,
  getUserStatusMessage,
  searchMissionSheetNames,
  searchOpenSlots,
} from '../event-ops.helpers';
import { EventOpsSlot } from '../event-ops.types';
import { EVENT_OPS_CUSTOM_IDS } from '../message-formatter';
import { SheetsClientService } from '../sheets-client.service';

// TEMPORARY listener — see README.md in temp-event-ops/.
// Backs the /event-signup autocomplete dropdown AND the two roster buttons
// (Show Open Slots / Leave My Slot) — buttons/select-menus are the real
// signup path for regular players since Discord requires Send Messages (which
// mission channels deny for @everyone) to invoke a slash command at all.

@Injectable()
export class EventOpsInteractionsHandler {
  constructor(
    @InjectDb() private readonly db: mongo.Db,
    private readonly sheets: SheetsClientService,
    private readonly discordProvider: DiscordClientProvider,
  ) {}

  @On('interactionCreate')
  async onInteraction(interaction: Interaction): Promise<void> {
    if (
      interaction.isAutocomplete() &&
      interaction.commandName === 'event-signup'
    ) {
      await this.autocompleteSignup(interaction);
      return;
    }
    if (
      interaction.isAutocomplete() &&
      interaction.commandName === 'event-sync'
    ) {
      await this.autocompleteSyncSheetName(interaction);
      return;
    }
    if (
      interaction.isButton() &&
      interaction.customId === EVENT_OPS_CUSTOM_IDS.openSlots
    ) {
      await this.showOpenSlots(interaction);
      return;
    }
    if (
      interaction.isButton() &&
      interaction.customId === EVENT_OPS_CUSTOM_IDS.leaveSlot
    ) {
      await this.leaveSlot(interaction);
      return;
    }
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith(EVENT_OPS_CUSTOM_IDS.selectSlot)
    ) {
      await this.selectSlot(interaction);
      return;
    }
    if (
      interaction.isButton() &&
      interaction.customId === EVENT_OPS_CUSTOM_IDS.myStatus
    ) {
      await this.myStatus(interaction);
      return;
    }
  }

  private async autocompleteSignup(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    try {
      const event = await getActiveEvent(this.db);
      const mission = event
        ? await getMissionForChannel(this.db, interaction.channelId)
        : null;
      if (!event || !mission) {
        await interaction.respond([]);
        return;
      }

      const term = String(interaction.options.getFocused() ?? '');
      const matches = await searchOpenSlots(
        this.db,
        event.eventName,
        mission.channelId,
        term,
      );

      const choices = matches.slice(0, 25).map((s) => ({
        name: `#${s.slotId} — ${s.role} (${s.section})`.slice(0, 100),
        value: Number(s.slotId),
      }));
      await interaction.respond(choices);
    } catch (err: any) {
      console.error(
        '[temp-event-ops] Signup autocomplete failed:',
        err.message,
      );
      try {
        await interaction.respond([]);
      } catch (_) {
        /* ignore */
      }
    }
  }

  private async autocompleteSyncSheetName(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    try {
      const event = await getActiveEvent(this.db);
      if (!event) {
        await interaction.respond([]);
        return;
      }

      const term = String(interaction.options.getFocused() ?? '');
      const names = await searchMissionSheetNames(
        this.db,
        event.eventName,
        term,
      );
      await interaction.respond(
        names.slice(0, 25).map((n) => ({ name: n.slice(0, 100), value: n })),
      );
    } catch (err: any) {
      console.error(
        '[temp-event-ops] Sync sheet_name autocomplete failed:',
        err.message,
      );
      try {
        await interaction.respond([]);
      } catch (_) {
        /* ignore */
      }
    }
  }

  private async showOpenSlots(interaction: ButtonInteraction): Promise<void> {
    const event = await getActiveEvent(this.db);
    const mission = event
      ? await getMissionForChannel(this.db, interaction.channelId)
      : null;
    if (!event || !mission) {
      await interaction.reply({
        content: 'This is not an active event slot channel.',
        ephemeral: true,
      });
      return;
    }

    const open = await searchOpenSlots(
      this.db,
      event.eventName,
      mission.channelId,
      '',
    );
    if (open.length === 0) {
      await interaction.reply({
        content: 'No open slots in this channel right now.',
        ephemeral: true,
      });
      return;
    }

    // A select menu caps out at 25 options, but Discord allows up to 5 action
    // rows per message — so instead of truncating to the first 25 and
    // punting everyone else to staff, split into up to 5 dropdowns of 25
    // (125 total), each labeled with the slot range it covers.
    const MAX_MENUS = 5;
    const MENU_SIZE = 25;
    const shown = open.slice(0, MAX_MENUS * MENU_SIZE);
    const chunks: EventOpsSlot[][] = [];
    for (let i = 0; i < shown.length; i += MENU_SIZE) {
      chunks.push(shown.slice(i, i + MENU_SIZE));
    }

    const rows = chunks.map((chunk, i) => {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${EVENT_OPS_CUSTOM_IDS.selectSlot}:${i}`)
        .setPlaceholder(
          `Slots #${chunk[0].slotId}-#${
            chunk[chunk.length - 1].slotId
          } — pick one`,
        )
        .addOptions(
          chunk.map((s) => ({
            label: `#${s.slotId} — ${s.role}`.slice(0, 100),
            description: s.section.slice(0, 100),
            value: s.slotId,
          })),
        );
      return new ActionRowBuilder<StringSelectMenuBuilder>({
        components: [menu],
      });
    });

    const note =
      open.length > shown.length
        ? `\n\n(${
            open.length - shown.length
          } more open slot(s) not shown — ask a staff member if the one you want isn't listed.)`
        : '';
    await interaction.reply({
      content: `**Open slots:**${note}`,
      components: rows,
      ephemeral: true,
    });
  }

  private async selectSlot(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const event = await getActiveEvent(this.db);
    const mission = event
      ? await getMissionForChannel(this.db, interaction.channelId)
      : null;
    if (!event || !mission) {
      await interaction.update({
        content: 'This is not an active event slot channel.',
        components: [],
      });
      return;
    }

    await interaction.deferUpdate();

    const member = interaction.member as GuildMember | null;
    const displayName = getDisplayName(member, interaction.user);
    const slotId = interaction.values[0];

    const result = await performSignup(
      this.db,
      this.sheets,
      this.discordProvider.getClient(),
      event,
      mission,
      slotId,
      interaction.user.id,
      displayName,
    );

    await interaction.editReply({ content: result.message, components: [] });
  }

  private async myStatus(interaction: ButtonInteraction): Promise<void> {
    const message = await getUserStatusMessage(this.db, interaction.user.id);
    await interaction.reply({ content: message, ephemeral: true });
  }

  private async leaveSlot(interaction: ButtonInteraction): Promise<void> {
    const event = await getActiveEvent(this.db);
    const mission = event
      ? await getMissionForChannel(this.db, interaction.channelId)
      : null;
    if (!event || !mission) {
      await interaction.reply({
        content: 'This is not an active event slot channel.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member as GuildMember | null;
    const displayName = getDisplayName(member, interaction.user);

    const result = await performDeslot(
      this.db,
      this.sheets,
      this.discordProvider.getClient(),
      event,
      mission,
      interaction.user.id,
      displayName,
    );

    await interaction.editReply({ content: result.message });
  }
}
