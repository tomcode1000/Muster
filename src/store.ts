/**
 * File-backed state. Each write goes to a temporary file that is then renamed,
 * so a crash mid-write leaves the previous good copy in place.
 */

import * as fs from "fs";
import * as path from "path";
import type { CheckIn, Project } from "./domain/types";
import { emptyCheckIn } from "./agent/tools";
import { scheduleSave } from "./snapshot";

const DATA_DIR = process.env.MUSTER_DATA_DIR || path.join(process.cwd(), "data");

export interface CallRecord {
  callId: string;
  projectId: string;
  activityId: string;
  /** Who and what the call was about, kept so the log reads the same after the plan changes. */
  planDate: string;
  company: string;
  foreman: string;
  work: string;
  channel: "phone" | "browser";
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  turns: { role: "foreman" | "agent"; text: string; at: string }[];
  toolCalls: { name: string; args: unknown; result: unknown; at: string }[];
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Writes through a temporary file and renames it, so a crash mid-write cannot
 * leave half a file behind.
 *
 * On Windows the rename fails with EPERM or EBUSY while something else holds
 * the file open, which a sync client such as OneDrive does constantly. Those
 * locks clear in milliseconds, so the rename is retried briefly; only if it
 * keeps failing does the write go straight to the file, which gives up the
 * crash safety rather than losing the data.
 */
function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify(value, null, 2);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);

  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      fs.renameSync(tmp, file);
      // Hosts without a disk keep the data in a key value store instead.
      scheduleSave();
      return;
    } catch (e: any) {
      if (e.code !== "EPERM" && e.code !== "EBUSY" && e.code !== "EACCES") throw e;
      sleep(25);
    }
  }

  try {
    fs.writeFileSync(file, body);
    scheduleSave();
    console.error(`[store] ${path.basename(file)} was locked; wrote it directly`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The temporary file is harmless if it cannot be removed.
    }
  }
}

/** Blocks the thread briefly; the file locks this waits on last milliseconds. */
function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function checkInFile(project: Project, activityId: string) {
  return path.join(DATA_DIR, "checkins", project.id, project.planDate, `${activityId}.json`);
}

export function getCheckIn(project: Project, activityId: string): CheckIn {
  const activity = project.activities.find((a) => a.id === activityId);
  if (!activity) throw new Error(`No activity "${activityId}"`);
  return (
    readJson<CheckIn>(checkInFile(project, activityId)) ??
    emptyCheckIn(project.id, project.planDate, activity, new Date().toISOString())
  );
}

type CheckInListener = (project: Project, checkIn: CheckIn) => void;
const checkInListeners: CheckInListener[] = [];

/** Called after every saved change to a check-in, for mirrors such as the sheet. */
export function onCheckInSaved(listener: CheckInListener) {
  checkInListeners.push(listener);
}

export function saveCheckIn(project: Project, checkIn: CheckIn) {
  writeJson(checkInFile(project, checkIn.activityId), checkIn);
  for (const listener of checkInListeners) {
    try {
      listener(project, checkIn);
    } catch (e: any) {
      console.error(`[store] check-in listener failed: ${e.message}`);
    }
  }
}

export function readState<T>(name: string): T | null {
  return readJson<T>(path.join(DATA_DIR, `${name}.json`));
}

export function writeState(name: string, value: unknown) {
  writeJson(path.join(DATA_DIR, `${name}.json`), value);
}

function readAllCalls(): CallRecord[] {
  const dir = path.join(DATA_DIR, "calls");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => readJson<CallRecord>(path.join(dir, f)))
    .filter((c): c is CallRecord => Boolean(c))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function listCalls(limit = 100): CallRecord[] {
  return readAllCalls().slice(0, limit);
}

/** Every call started at or after an instant, for usage metering. */
export function listCallsSince(iso: string): CallRecord[] {
  return readAllCalls().filter((c) => c.startedAt >= iso);
}

export function listCheckIns(project: Project): CheckIn[] {
  return project.activities.map((a) => getCheckIn(project, a.id));
}

export function saveCall(record: CallRecord) {
  writeJson(path.join(DATA_DIR, "calls", `${record.callId}.json`), record);
}

export function getCall(callId: string): CallRecord | null {
  if (!/^[a-z0-9_]+$/i.test(callId)) return null;
  return readJson<CallRecord>(path.join(DATA_DIR, "calls", `${callId}.json`));
}
