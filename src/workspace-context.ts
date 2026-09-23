/**
 * Which workspace a piece of work belongs to.
 *
 * Every account owns a workspace: its own crew, plan, calls, settings and
 * usage. Rather than thread an id through every function that touches disk,
 * the id is held for the duration of a request, a round, or a sheet refresh,
 * and the store asks for it when it builds a path.
 *
 * Account level records, the users and their sessions, live outside any
 * workspace, because a session is what decides which workspace you are in.
 *
 *   data/
 *     users.json            everyone, across all workspaces
 *     sessions.json
 *     workspaces/
 *       <id>/settings.json  one workspace
 *       <id>/workspace.json
 *       <id>/checkins/...
 *       <id>/calls/...
 */

import { AsyncLocalStorage } from "async_hooks";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = process.env.MUSTER_DATA_DIR || path.join(process.cwd(), "data");
/** Used by the command line tools and by a server with nobody signed in. */
export const DEFAULT_WORKSPACE = "main";

const current = new AsyncLocalStorage<string>();

export function globalDir(): string {
  return DATA_DIR;
}

export function currentWorkspaceId(): string {
  return current.getStore() ?? DEFAULT_WORKSPACE;
}

/** An id is part of a path, so it may not wander out of the data directory. */
export function safeWorkspaceId(id: unknown): string {
  const clean = String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  return clean || DEFAULT_WORKSPACE;
}

export function workspaceDir(id = currentWorkspaceId()): string {
  return path.join(DATA_DIR, "workspaces", safeWorkspaceId(id));
}

/** Runs the work inside a workspace. Everything it touches lands in that one. */
export function withWorkspace<T>(id: string, work: () => T): T {
  return current.run(safeWorkspaceId(id), work);
}

/** Every workspace that has been written to, oldest first is not promised. */
export function listWorkspaces(): string[] {
  try {
    return fs
      .readdirSync(path.join(DATA_DIR, "workspaces"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Moves a single workspace installation into the new shape.
 *
 * Muster kept one workspace at the top of the data directory before accounts
 * had their own. Those files are moved under workspaces/main once, so an
 * existing deployment keeps its crew, plan and call history.
 */
export function migrateSingleWorkspace(dataDir = DATA_DIR): { moved: string[] } {
  const moved: string[] = [];
  const target = path.join(dataDir, "workspaces", DEFAULT_WORKSPACE);
  const loose = ["settings.json", "workspace.json", "handled.json", "schedule-state.json", "usage-dials.json", "sheet-snapshot.json", "notifications-seen.json", "checkins", "calls"];

  for (const name of loose) {
    const from = path.join(dataDir, name);
    const to = path.join(target, name);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.mkdirSync(target, { recursive: true });
    fs.renameSync(from, to);
    moved.push(name);
  }
  return { moved };
}
