/**
 * A link a foreman can tap to check in, with no account and no phone call.
 *
 * The superintendent sends it on WhatsApp or by text. It opens a page that
 * speaks to the same agent a phone call would reach, which makes the check-in
 * possible wherever a phone line is awkward: a Twilio trial that cannot open
 * media streams, a foreman abroad, or a site with no signal but working wifi.
 *
 * The link is a random token, not a booking id, so nothing can be guessed by
 * counting upwards. It names one booking on one day, expires, and can be
 * withdrawn. It carries no session: holding the link is the permission, which
 * is the same bargain as a phone call to a known number.
 */

import * as crypto from "crypto";
import { readState, writeState } from "./store";
import { currentWorkspaceId } from "./workspace-context";

const FILE = "foreman-links";
const DEFAULT_HOURS = 48;

export interface ForemanLink {
  token: string;
  workspaceId: string;
  activityId: string;
  date: string;
  createdAt: string;
  expiresAt: string;
  /** When the foreman first opened it, so the superintendent can see it landed. */
  openedAt: string | null;
  usedAt: string | null;
  /** Check-ins run through this link, so a forwarded link cannot run up a bill. */
  uses: number;
}

/** Enough for a foreman to try again after a bad line, and no more. */
export const MAX_USES = 5;

const all = (): ForemanLink[] => readState<ForemanLink[]>(FILE) ?? [];
const save = (links: ForemanLink[]) => writeState(FILE, links);

/** Drops links that expired more than a day ago, so the file cannot grow forever. */
function tidy(links: ForemanLink[], now: number): ForemanLink[] {
  return links.filter((l) => Date.parse(l.expiresAt) > now - 86_400_000);
}

export function createLink(activityId: string, date: string, hours = DEFAULT_HOURS, now = Date.now()): ForemanLink {
  const links = tidy(all(), now);
  // One live link per booking: sending a second should replace the first.
  const kept = links.filter((l) => !(l.activityId === activityId && l.date === date));
  const link: ForemanLink = {
    token: crypto.randomBytes(24).toString("base64url"),
    workspaceId: currentWorkspaceId(),
    activityId,
    date,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + hours * 3_600_000).toISOString(),
    openedAt: null,
    usedAt: null,
    uses: 0,
  };
  save([...kept, link]);
  return link;
}

export function findLink(token: unknown, now = Date.now()): ForemanLink | null {
  const value = String(token ?? "");
  if (value.length < 20) return null;
  const link = all().find((l) => l.token === value);
  if (!link || Date.parse(link.expiresAt) <= now) return null;
  return link;
}

/** Records that the link was opened. */
export function markLink(token: string, field: "openedAt" | "usedAt", now = Date.now()) {
  const links = all();
  const link = links.find((l) => l.token === token);
  if (!link) return;
  link[field] = new Date(now).toISOString();
  save(links);
}

/**
 * Claims one check-in against the link.
 *
 * Returns false once the allowance is spent. A link that reached the wrong
 * person, or was forwarded around a site, then costs nothing further.
 */
export function useLink(token: string, now = Date.now()): boolean {
  const links = all();
  const link = links.find((l) => l.token === token);
  if (!link) return false;
  const used = link.uses ?? 0;
  if (used >= MAX_USES) return false;
  link.uses = used + 1;
  link.usedAt = new Date(now).toISOString();
  save(links);
  return true;
}

export function revokeLink(activityId: string, date: string) {
  save(all().filter((l) => !(l.activityId === activityId && l.date === date)));
}

export function linkFor(activityId: string, date: string, now = Date.now()): ForemanLink | null {
  return all().find((l) => l.activityId === activityId && l.date === date && Date.parse(l.expiresAt) > now) ?? null;
}
