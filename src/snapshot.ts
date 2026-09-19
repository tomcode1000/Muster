/**
 * Keeping the data directory through a wipe.
 *
 * Muster stores everything as JSON files, read and written synchronously all
 * over the app. Free hosting has no disk: the filesystem is reset on every
 * deploy, restart and sleep, which would take accounts, crew, bookings and
 * transcripts with it.
 *
 * Rather than making every read asynchronous to talk to a database, the files
 * stay the working copy and are mirrored to a key value store. The server
 * restores from that mirror at boot, and writes a new mirror shortly after any
 * change. Writes are debounced, so a busy minute costs one upload, not fifty.
 *
 * What this trades away: a crash within the debounce window loses the last
 * couple of seconds of changes. For a check-in that has just been saved this
 * means it is re-read from the last mirror, not lost mid-call, because the call
 * record is written again when the call ends.
 *
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to turn this on. With
 * neither, nothing happens and the files behave as they always have.
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = process.env.MUSTER_DATA_DIR || path.join(process.cwd(), "data");
const KEY = process.env.MUSTER_SNAPSHOT_KEY || "muster:data";
/** Files larger than this are a sign something is wrong, and would cost a slow upload. */
const MAX_BYTES = 8 * 1024 * 1024;
const DEBOUNCE_MS = Number(process.env.MUSTER_SNAPSHOT_DEBOUNCE_MS || 1500);

export interface Snapshot {
  savedAt: string;
  files: Record<string, string>;
}

export function snapshotConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** Every file under the data directory, keyed by its path relative to it. */
export function pack(dir = DATA_DIR): Snapshot {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Half written temporary files are never part of a snapshot.
      if (entry.name.endsWith(".tmp")) continue;
      files[path.relative(dir, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { savedAt: new Date().toISOString(), files };
}

/** Writes a snapshot back to disk. Existing files with the same name are replaced. */
export function unpack(snapshot: Snapshot, dir = DATA_DIR): number {
  let written = 0;
  for (const [relative, contents] of Object.entries(snapshot.files ?? {})) {
    // A key from the store must not escape the data directory.
    const target = path.resolve(dir, relative);
    if (!target.startsWith(path.resolve(dir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    written++;
  }
  return written;
}

async function redis(command: unknown[]): Promise<any> {
  const url = process.env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, "");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const body = (await res.json()) as { result?: unknown };
  return body.result;
}

/** Reads the mirror and writes it to disk. Local files already present win, so a real disk is never overwritten. */
export async function restore(): Promise<{ restored: boolean; files: number; reason?: string }> {
  if (!snapshotConfigured()) return { restored: false, files: 0, reason: "no key value store configured" };
  const local = pack();
  if (Object.keys(local.files).length > 0) {
    return { restored: false, files: 0, reason: "the data directory already has files" };
  }
  try {
    const raw = await redis(["GET", KEY]);
    if (!raw) return { restored: false, files: 0, reason: "nothing saved yet" };
    const snapshot = JSON.parse(raw) as Snapshot;
    const files = unpack(snapshot);
    return { restored: true, files };
  } catch (e: any) {
    console.error(`[snapshot] restore failed: ${e.message}`);
    return { restored: false, files: 0, reason: e.message };
  }
}

export async function save(): Promise<{ saved: boolean; bytes: number; reason?: string }> {
  if (!snapshotConfigured()) return { saved: false, bytes: 0, reason: "no key value store configured" };
  const snapshot = pack();
  const body = JSON.stringify(snapshot);
  if (body.length > MAX_BYTES) {
    console.error(`[snapshot] not saved: ${Math.round(body.length / 1024)}kB is over the limit`);
    return { saved: false, bytes: body.length, reason: "snapshot too large" };
  }
  try {
    await redis(["SET", KEY, body]);
    return { saved: true, bytes: body.length };
  } catch (e: any) {
    console.error(`[snapshot] save failed: ${e.message}`);
    return { saved: false, bytes: body.length, reason: e.message };
  }
}

let timer: NodeJS.Timeout | null = null;
let pending = false;

/**
 * Asks for a save shortly. Called after every write, so it has to be cheap and
 * never throw into the caller.
 */
export function scheduleSave() {
  if (!snapshotConfigured()) return;
  pending = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!pending) return;
    pending = false;
    void save();
  }, DEBOUNCE_MS);
  // A pending save must not hold the process open at shutdown.
  timer.unref?.();
}

/** Writes any pending change immediately, for shutdown. */
export async function flush(): Promise<void> {
  if (!snapshotConfigured() || !pending) return;
  pending = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await save();
}
