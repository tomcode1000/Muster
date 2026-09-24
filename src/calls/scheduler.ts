/**
 * Runs the evening round at the superintendent's chosen time, then retries
 * anyone not reached, within calling hours.
 *
 * The scheduler checks the clock every 30 seconds rather than setting one long
 * timer, so a laptop that sleeps through the call time still runs the round
 * when it wakes, as long as calling hours have not ended.
 *
 * One timer serves every workspace on the server. Each is considered on its own
 * clock, with its own call time, its own days and its own round in progress, so
 * one account's evening does not hold up another's.
 */

import { loadSettings, setupGaps, sheetIdFrom } from "../settings";
import { currentProject, refreshFromSheet } from "../source";
import { readState, writeState } from "../store";
import { localMoment, withinHours } from "../domain/zoned";
import { runRound } from "./dialer";
import { currentWorkspaceId, listWorkspaces, withWorkspace } from "../workspace-context";

interface ScheduleState {
  lastRunDate: string | null;
  retryAt: string | null;
  lastRound: { startedAt: string; finishedAt: string | null; summary: string } | null;
  log: { at: string; line: string }[];
}

const STATE = "schedule-state";
const TICK_MS = 30_000;

/** A round in progress, and a request to stop it, per workspace. */
const running = new Set<string>();
const stopRequests = new Set<string>();

const isRunning = () => running.has(currentWorkspaceId());

export function scheduleState(): ScheduleState & { running: boolean; nextRun: string | null } {
  const state = load();
  return { ...state, running: isRunning(), nextRun: describeNextRun(state) };
}

export function startScheduler() {
  const sweep = () => {
    // A workspace with nothing in it has no directory yet, and nothing to call.
    for (const id of listWorkspaces()) {
      withWorkspace(id, () => tick().catch((e) => note(`Scheduler error: ${e.message}`)));
    }
  };
  setInterval(sweep, TICK_MS);
  sweep();
}

export function stopRound() {
  if (isRunning()) stopRequests.add(currentWorkspaceId());
}

async function tick() {
  const settings = loadSettings();
  if (!settings.schedule.enabled || isRunning()) return;

  const state = load();
  const now = localMoment(new Date(), settings.project.timezone);
  const inHours = withinHours(now.time, settings.schedule.callingHours.start, settings.schedule.callingHours.end);

  const firstRunDue =
    settings.schedule.days.includes(now.weekday) &&
    now.time >= settings.schedule.time &&
    state.lastRunDate !== now.date &&
    inHours;

  if (firstRunDue) {
    state.lastRunDate = now.date;
    state.retryAt = null;
    save(state);
    await startRound({ refresh: true, reason: "Scheduled round" });
    return;
  }

  if (state.retryAt && new Date(state.retryAt) <= new Date() && inHours) {
    state.retryAt = null;
    save(state);
    await startRound({ refresh: false, reason: "Retry round" });
  }
}

/** Runs a round now. Used by the schedule and by the Run now button. */
export async function startRound(opts: { refresh: boolean; reason: string; onlyActivityId?: string; date?: string }) {
  const workspace = currentWorkspaceId();
  if (running.has(workspace)) throw new Error("A round is already running");
  running.add(workspace);
  stopRequests.delete(workspace);
  const settings = loadSettings();
  const state = load();
  state.lastRound = { startedAt: new Date().toISOString(), finishedAt: null, summary: opts.reason };
  save(state);
  note(`${opts.reason} started`);

  try {
    const gaps = setupGaps(settings);
    if (gaps.length) throw new Error(`Settings need ${gaps.join(", ")} before Muster can call`);
    if (opts.refresh && sheetIdFrom(settings)) {
      const snap = await refreshFromSheet();
      note(`Read the sheet: ${snap.project.activities.length} bookings for ${snap.project.planDate}`);
      for (const p of snap.problems) note(`Sheet ${p.tab} row ${p.row}: ${p.message}`);
    }
    const project = currentProject(opts.date);
    const result = await runRound({
      project,
      schedule: settings.schedule,
      phone: settings.phone,
      onlyActivityId: opts.onlyActivityId,
      log: note,
      shouldStop: () => stopRequests.has(workspace),
    });

    const summary = `${result.called} called, ${result.reached} checked in, ${result.remaining} still open${result.stoppedReason ? `, stopped: ${result.stoppedReason}` : ""}`;
    note(`${opts.reason} finished: ${summary}`);

    const after = load();
    after.lastRound = { startedAt: state.lastRound.startedAt, finishedAt: new Date().toISOString(), summary };
    if (!opts.onlyActivityId && result.remaining > 0 && settings.schedule.enabled && !stopRequests.has(workspace) && !result.limitReached) {
      after.retryAt = new Date(Date.now() + settings.schedule.retryAfterMinutes * 60_000).toISOString();
    }
    save(after);
  } catch (e: any) {
    note(`${opts.reason} failed: ${e.message}`);
    if (!opts.onlyActivityId && settings.schedule.enabled) {
      const retry = load();
      retry.retryAt = new Date(Date.now() + settings.schedule.retryAfterMinutes * 60_000).toISOString();
      retry.lastRound = { startedAt: state.lastRound.startedAt, finishedAt: new Date().toISOString(), summary: `failed: ${e.message}` };
      save(retry);
      note(`Trying again in ${settings.schedule.retryAfterMinutes} minutes`);
    }
    throw e;
  } finally {
    running.delete(workspace);
    stopRequests.delete(workspace);
  }
}

function describeNextRun(state: ScheduleState): string | null {
  const settings = loadSettings();
  if (!settings.schedule.enabled) return null;
  if (state.retryAt) return state.retryAt;
  return `${settings.schedule.time} ${settings.project.timezone}`;
}

function load(): ScheduleState {
  return readState<ScheduleState>(STATE) ?? { lastRunDate: null, retryAt: null, lastRound: null, log: [] };
}

function save(state: ScheduleState) {
  writeState(STATE, state);
}

export function logRound(line: string) {
  note(line);
}

function note(line: string) {
  console.log(`[round] ${line}`);
  const state = load();
  state.log = [...state.log, { at: new Date().toISOString(), line }].slice(-200);
  save(state);
}
