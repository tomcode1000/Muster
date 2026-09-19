/**
 * Where tomorrow's plan comes from.
 *
 * With a Google Sheet configured, the plan is the last snapshot read from it,
 * kept on disk so a restart does not lose the day. Without one, it is the
 * project file in data/projects. Either way the rest of Muster sees a Project.
 */

import { loadSettings, sheetIdFrom } from "./settings";
import { getCheckIn, onCheckInSaved, readState, writeState } from "./store";
import { listBookings, listCrew } from "./workspace";
import type { Project } from "./domain/types";
import { addDays, localMoment } from "./domain/zoned";
import { addSheet, readRange, sheetTitles, writeRange } from "./sheets/google";
import {
  columnLetter,
  CREW_HEADERS,
  CREW_TAB,
  parseRoster,
  PLAN_INPUT_HEADERS,
  PLAN_RESULT_HEADERS,
  PLAN_TAB,
  resultRow,
  type RowProblem,
} from "./sheets/roster";

interface Snapshot {
  sheetId: string;
  project: Project;
  rows: Record<string, number>;
  /** Zero based column where result columns begin on the plan tab. */
  resultColumn: number;
  problems: RowProblem[];
  readAt: string;
}

const SNAPSHOT = "sheet-snapshot";

/** Check-ins are filed under this id, so renaming the project keeps its history. */
const PROJECT_ID = "main";

export function tomorrow(timezone: string): string {
  return addDays(localMoment(new Date(), timezone).date, 1);
}

/**
 * The plan for a date, tomorrow by default. A sheet only ever describes one
 * day, the one it was last read for.
 */
export function currentProject(date?: string): Project {
  const settings = loadSettings();
  const base = {
    id: PROJECT_ID,
    name: settings.project.name,
    superintendent: settings.project.superintendent,
    timezone: settings.project.timezone,
    vocabulary: settings.project.vocabulary,
  };

  if (settings.source === "sheet") {
    const sheetId = sheetIdFrom(settings);
    const snap = readState<Snapshot>(SNAPSHOT);
    if (!sheetId || !snap || snap.sheetId !== sheetId) {
      throw new Error("The sheet has not been read yet. Press Refresh from sheet in Settings.");
    }
    return { ...snap.project, ...base, planDate: snap.project.planDate };
  }

  const planDate = date ?? tomorrow(settings.project.timezone);
  const bookings = listBookings(planDate);
  const crew = listCrew();
  return {
    ...base,
    planDate,
    contacts: crew,
    activities: bookings.map(({ date: _d, createdAt: _c, updatedAt: _u, ...activity }) => activity),
  };
}

export function lastSnapshot(): Snapshot | null {
  return readState<Snapshot>(SNAPSHOT);
}

/**
 * Reads the sheet into a new snapshot. The plan date is tomorrow in the
 * project's time zone unless one is given.
 */
export async function refreshFromSheet(planDate?: string): Promise<Snapshot> {
  const settings = loadSettings();
  const sheetId = sheetIdFrom(settings);
  if (!sheetId) throw new Error("No Google Sheet is configured");

  const titles = await sheetTitles(sheetId);
  for (const [tab, headers] of [
    [CREW_TAB, CREW_HEADERS],
    [PLAN_TAB, [...PLAN_INPUT_HEADERS, ...PLAN_RESULT_HEADERS]],
  ] as const) {
    if (!titles.includes(tab)) {
      await addSheet(sheetId, tab);
      await writeRange(sheetId, `${tab}!A1`, [[...headers]]);
    }
  }

  const [crewRows, planRows] = await Promise.all([
    readRange(sheetId, `${CREW_TAB}!A1:Z500`),
    readRange(sheetId, `${PLAN_TAB}!A1:AZ500`),
  ]);

  // Result columns go after the last input column, found by header name.
  const header = (planRows[0] ?? []).map((h) => h.trim().toLowerCase());
  let resultColumn = header.indexOf(PLAN_RESULT_HEADERS[0].toLowerCase());
  if (resultColumn < 0) resultColumn = Math.max(header.length, PLAN_INPUT_HEADERS.length);
  // Rewritten every time, so a sheet made before a column was added gains its header.
  await writeRange(sheetId, `${PLAN_TAB}!${columnLetter(resultColumn)}1`, [PLAN_RESULT_HEADERS]);

  const parsed = parseRoster(crewRows, planRows, {
    name: settings.project.name,
    superintendent: settings.project.superintendent,
    timezone: settings.project.timezone,
    planDate: planDate ?? tomorrow(settings.project.timezone),
    vocabulary: settings.project.vocabulary,
  });
  parsed.project.id = PROJECT_ID;

  const snap: Snapshot = {
    sheetId,
    project: parsed.project,
    rows: parsed.rows,
    resultColumn,
    problems: parsed.problems,
    readAt: new Date().toISOString(),
  };
  writeState(SNAPSHOT, snap);
  return snap;
}

// ----------------------------------------------------------------------------
// Writing results back, a moment after each change so a burst of tool calls
// becomes one write and the Sheets quota is respected.
// ----------------------------------------------------------------------------

const pending = new Map<string, NodeJS.Timeout>();
const WRITE_DELAY_MS = 1500;

export function startSheetMirror() {
  onCheckInSaved((project, checkIn) => {
    const key = `${project.id}:${checkIn.activityId}`;
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        writeResult(checkIn.activityId).catch((e) => console.error(`[sheet] write failed: ${e.message}`));
      }, WRITE_DELAY_MS),
    );
  });
}

async function writeResult(activityId: string) {
  const snap = readState<Snapshot>(SNAPSHOT);
  const settings = loadSettings();
  if (!snap || snap.sheetId !== sheetIdFrom(settings)) return;
  const activity = snap.project.activities.find((a) => a.id === activityId);
  if (!activity) return;

  // Rows may have been inserted or sorted since the snapshot, so find the
  // booking's current row rather than trusting the remembered one.
  const [crewRows, planRows] = await Promise.all([
    readRange(snap.sheetId, `${CREW_TAB}!A1:Z500`),
    readRange(snap.sheetId, `${PLAN_TAB}!A1:AZ500`),
  ]);
  const row = parseRoster(crewRows, planRows, snap.project).rows[activityId];
  if (!row) {
    console.error(`[sheet] booking ${activityId} is no longer on the ${PLAN_TAB} tab; result kept locally`);
    return;
  }

  const checkIn = getCheckIn(snap.project, activityId);
  const base = (process.env.HOSTNAME || "").replace(/\/$/, "");
  const values = resultRow(activity, checkIn, {
    timezone: snap.project.timezone,
    callLogUrl: (callId) => (base ? `${base}/calls.html?id=${callId}` : null),
  });

  const range = `${PLAN_TAB}!${columnLetter(snap.resultColumn)}${row}`;
  await writeRange(snap.sheetId, range, [values]);
  console.log(`[sheet] row ${row} updated: ${values[0]}`);
}
