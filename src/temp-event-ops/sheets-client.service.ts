import { Injectable, Logger } from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';
import { SlotRow } from './event-ops.types';

// TEMPORARY module — see README.md in this directory.

const EVENT_OVERVIEW_TAB = 'Event Overview';

export interface EventOverviewRow {
  missionNumber: string;
  description: string;
  slotLists: string[];
}

function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

@Injectable()
export class SheetsClientService {
  private readonly logger = new Logger('temp-event-ops:sheets');
  private readonly sheets: sheets_v4.Sheets;

  constructor() {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    if (!email || !rawKey) {
      this.logger.warn(
        'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are not set — event ops Sheets access will fail.',
      );
    }
    const privateKey = (rawKey || '').replace(/\\n/g, '\n');
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  static extractSheetId(sheetUrl: string): string | null {
    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  private async getTabValues(
    sheetId: string,
    tabName: string,
  ): Promise<string[][]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A:Z`,
    });
    return (res.data.values as string[][]) || [];
  }

  async getEventOverview(sheetId: string): Promise<EventOverviewRow[]> {
    const values = await this.getTabValues(sheetId, EVENT_OVERVIEW_TAB);
    if (values.length < 2) return [];
    const headers = values[0].map((h) => (h || '').trim());
    const missionIdx = headers.indexOf('Mission Number');
    const descIdx = headers.indexOf('Description');
    const slotListsIdx = headers.indexOf('Slot lists');

    if (missionIdx === -1 || slotListsIdx === -1) {
      throw new Error(
        `"${EVENT_OVERVIEW_TAB}" tab must have "Mission Number" and "Slot lists" columns.`,
      );
    }

    const rows: EventOverviewRow[] = [];
    for (const row of values.slice(1)) {
      const missionNumber = (row[missionIdx] || '').trim();
      const slotListsRaw = (row[slotListsIdx] || '').trim();
      if (!missionNumber || !slotListsRaw) continue;
      rows.push({
        missionNumber,
        description: descIdx !== -1 ? (row[descIdx] || '').trim() : '',
        slotLists: slotListsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
    }
    return rows;
  }

  async getSlotRows(sheetId: string, tabName: string): Promise<SlotRow[]> {
    const values = await this.getTabValues(sheetId, tabName);
    if (values.length < 2) return [];
    const headers = values[0].map((h) => (h || '').trim());
    const col = (name: string) => headers.indexOf(name);

    const idx = {
      SlotID: col('SlotID'),
      Section: col('Section'),
      Role: col('Role'),
      Player: col('Player'),
      Description: col('Description'),
      DiscordUserId: col('Discord User ID'),
    };

    if (idx.SlotID === -1) {
      throw new Error(`Tab "${tabName}" must have a "SlotID" column.`);
    }

    return (
      values
        .slice(1)
        .map((row, i) => ({
          rowIndex: i,
          SlotID: row[idx.SlotID] || '',
          Section: idx.Section !== -1 ? row[idx.Section] || '' : '',
          Role: idx.Role !== -1 ? row[idx.Role] || '' : '',
          Player: idx.Player !== -1 ? row[idx.Player] || '' : '',
          Description: idx.Description !== -1 ? row[idx.Description] || '' : '',
          'Discord User ID':
            idx.DiscordUserId !== -1 ? row[idx.DiscordUserId] || '' : '',
        }))
        // Sheets use blank rows as visual spacers between sections — those
        // aren't real slots, so skip anything with no SlotID.
        .filter((row) => row.SlotID !== '')
    );
  }

  async setSlotOccupant(
    sheetId: string,
    tabName: string,
    rowIndex: number,
    player: string,
    discordUserId: string,
  ): Promise<void> {
    await this.writeSlotFields(sheetId, tabName, rowIndex, {
      Player: player,
      'Discord User ID': discordUserId,
    });
  }

  // Appends a row to the sheet's "History" tab: Timestamp | User | Action.
  // Best-effort and silent on failure — this is a nice-to-have audit trail,
  // not something that should ever block a command.
  async logHistory(
    sheetId: string,
    actor: string,
    action: string,
  ): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `'History'!A:C`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[new Date().toISOString(), actor, action]] },
      });
    } catch (err: any) {
      this.logger.error(`Failed to append history row: ${err.message}`);
    }
  }

  // Clears Player + Discord User ID for every row in the tab (used by
  // /event-setup's reset_before_setup flag, since the same sheet gets reused
  // across events rather than a fresh one being made each time).
  async clearAllOccupants(sheetId: string, tabName: string): Promise<void> {
    const values = await this.getTabValues(sheetId, tabName);
    if (values.length < 2) return;
    const headers = values[0].map((h) => (h || '').trim());
    const numDataRows = values.length - 1;

    const data: sheets_v4.Schema$ValueRange[] = [];
    for (const fieldName of ['Player', 'Discord User ID']) {
      const colIdx = headers.indexOf(fieldName);
      if (colIdx === -1) continue;
      const col = columnLetter(colIdx);
      data.push({
        range: `'${tabName}'!${col}2:${col}${1 + numDataRows}`,
        values: Array.from({ length: numDataRows }, () => ['']),
      });
    }
    if (data.length === 0) return;

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
  }

  async clearSlotOccupant(
    sheetId: string,
    tabName: string,
    rowIndex: number,
  ): Promise<void> {
    await this.writeSlotFields(sheetId, tabName, rowIndex, {
      Player: '',
      'Discord User ID': '',
    });
  }

  private async writeSlotFields(
    sheetId: string,
    tabName: string,
    rowIndex: number,
    fields: Record<string, string>,
  ): Promise<void> {
    const values = await this.getTabValues(sheetId, tabName);
    if (values.length < 1) throw new Error(`Tab "${tabName}" is empty.`);
    const headers = values[0].map((h) => (h || '').trim());
    const sheetRow = rowIndex + 2; // +1 for header row, +1 for 1-indexing

    const data: sheets_v4.Schema$ValueRange[] = [];
    for (const [fieldName, value] of Object.entries(fields)) {
      const colIdx = headers.indexOf(fieldName);
      if (colIdx === -1) continue;
      data.push({
        range: `'${tabName}'!${columnLetter(colIdx)}${sheetRow}`,
        values: [[value]],
      });
    }
    if (data.length === 0) return;

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
  }
}
