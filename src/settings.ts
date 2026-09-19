/**
 * The superintendent's preferences: which sheet, when to call, and the limits
 * that keep calls polite. Stored on disk and validated on every save.
 */

import * as fs from "fs";
import * as path from "path";
import { normalizeClock } from "./domain/time";
import { parseSheetId } from "./sheets/google";
import { DEFAULT_PROFILE, validateProfile, type AgentProfile } from "./agent/profile";
import { scheduleSave } from "./snapshot";

const DATA_DIR = process.env.MUSTER_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "settings.json");

export interface Settings {
  project: {
    name: string;
    superintendent: string;
    timezone: string;
    vocabulary: string[];
  };
  /** Where crew and bookings come from: entered in the app, or a Google Sheet. */
  source: "app" | "sheet";
  agent: AgentProfile;
  sheet: { url: string };
  schedule: {
    enabled: boolean;
    /** Local time of the first round, "HH:MM". */
    time: string;
    /** Days to run, 0 is Sunday. */
    days: number[];
    /** No call is placed outside these local hours. */
    callingHours: { start: string; end: string };
    retryAfterMinutes: number;
    maxAttempts: number;
  };
  /** How calls are placed: which number they come from, and how long they may run. */
  phone: {
    /** Call from the superintendent's own number instead of the Muster number in .env. */
    useOwnNumber: boolean;
    /** E.164, and owned or verified in the Twilio account. */
    number: string;
    /** Leave a message when an answering machine picks up. Needs a paid Twilio account. */
    voicemail: boolean;
    voicemailMessage: string;
    /** Seconds to ring before giving up. */
    ringSeconds: number;
    /** Longest one check-in may run. */
    maxCallSeconds: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  project: {
    name: "",
    superintendent: "",
    timezone: "America/New_York",
    vocabulary: [],
  },
  source: "app",
  agent: DEFAULT_PROFILE,
  sheet: { url: "" },
  schedule: {
    enabled: false,
    time: "17:00",
    days: [0, 1, 2, 3, 4],
    callingHours: { start: "07:00", end: "20:00" },
    retryAfterMinutes: 20,
    maxAttempts: 2,
  },
  phone: {
    useOwnNumber: false,
    number: "",
    voicemail: false,
    voicemailMessage: "Hello, this is Muster calling about tomorrow's work. Please check your phone when you get a chance.",
    ringSeconds: 25,
    maxCallSeconds: 190,
  },
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return validateSettings(saved).settings;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(input: unknown): { settings: Settings; errors: string[] } {
  const result = validateSettings(input);
  if (result.errors.length === 0) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(result.settings, null, 2));
    fs.renameSync(tmp, FILE);
    scheduleSave();
  }
  return result;
}

export function sheetIdFrom(settings: Settings): string | null {
  return settings.source === "sheet" && settings.sheet.url ? parseSheetId(settings.sheet.url) : null;
}

/** What still has to be filled in before Muster may call anyone. */
export function setupGaps(settings: Settings): string[] {
  const gaps: string[] = [];
  if (!settings.project.name) gaps.push("project name");
  if (!settings.project.superintendent) gaps.push("superintendent name");
  if (settings.source === "sheet" && !parseSheetId(settings.sheet.url)) gaps.push("Google Sheet link");
  return gaps;
}

export function validateSettings(input: any): { settings: Settings; errors: string[] } {
  const d = DEFAULT_SETTINGS;
  const errors: string[] = [];
  const s: Settings = structuredClone(d);

  const p = input?.project ?? {};
  s.project.name = str(p.name).slice(0, 120);
  s.project.superintendent = str(p.superintendent).slice(0, 120);
  s.project.timezone = str(p.timezone) || d.project.timezone;
  if (!validTimezone(s.project.timezone)) errors.push(`Unknown time zone "${s.project.timezone}"`);
  s.project.vocabulary = Array.isArray(p.vocabulary)
    ? p.vocabulary.map(str).filter(Boolean).slice(0, 80)
    : typeof p.vocabulary === "string"
      ? p.vocabulary.split(/[,\n]/).map(str).filter(Boolean).slice(0, 80)
      : [];

  const agent = validateProfile(input?.agent);
  s.agent = agent.profile;
  errors.push(...agent.errors);

  s.source = input?.source === "sheet" ? "sheet" : "app";
  s.sheet.url = str(input?.sheet?.url);
  if (s.sheet.url && !parseSheetId(s.sheet.url)) errors.push("That does not look like a Google Sheets link");
  if (s.source === "sheet" && !s.sheet.url) errors.push("Add the Google Sheet link, or switch to entering crew in the app");
  if (s.schedule && input?.schedule?.enabled === true && (!s.project.name || !s.project.superintendent)) {
    errors.push("Project name and superintendent are needed before calls can be scheduled");
  }

  const sc = input?.schedule ?? {};
  s.schedule.enabled = sc.enabled === true;
  s.schedule.time = normalizeClock(sc.time ?? d.schedule.time) ?? "";
  if (!s.schedule.time) errors.push("Call time must be a time like 17:00");
  s.schedule.days = Array.isArray(sc.days)
    ? [...new Set<number>(sc.days.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    : d.schedule.days;
  if (s.schedule.enabled && s.schedule.days.length === 0) errors.push("Pick at least one day");

  const ch = sc.callingHours ?? {};
  s.schedule.callingHours.start = normalizeClock(ch.start ?? d.schedule.callingHours.start) ?? "";
  s.schedule.callingHours.end = normalizeClock(ch.end ?? d.schedule.callingHours.end) ?? "";
  if (!s.schedule.callingHours.start || !s.schedule.callingHours.end) errors.push("Calling hours must be times");
  else if (s.schedule.callingHours.start >= s.schedule.callingHours.end) errors.push("Calling hours must start before they end");
  else if (s.schedule.time && (s.schedule.time < s.schedule.callingHours.start || s.schedule.time >= s.schedule.callingHours.end)) {
    errors.push("Call time must fall inside calling hours");
  }

  s.schedule.retryAfterMinutes = clampInt(sc.retryAfterMinutes, 5, 240, d.schedule.retryAfterMinutes);
  s.schedule.maxAttempts = clampInt(sc.maxAttempts, 1, 5, d.schedule.maxAttempts);

  const ph = input?.phone ?? {};
  s.phone.useOwnNumber = ph.useOwnNumber === true;
  s.phone.number = normalizePhone(str(ph.number));
  if (s.phone.useOwnNumber && !s.phone.number) errors.push("Add the number to call from, or use the Muster number");
  if (s.phone.number && !/^\+[1-9]\d{6,14}$/.test(s.phone.number)) errors.push("The number to call from must include the country code, like +1 504 555 0187");
  s.phone.voicemail = ph.voicemail === true;
  s.phone.voicemailMessage = str(ph.voicemailMessage ?? d.phone.voicemailMessage).slice(0, 300);
  if (s.phone.voicemail && !s.phone.voicemailMessage) errors.push("Write the voicemail message, or turn voicemail off");
  s.phone.ringSeconds = clampInt(ph.ringSeconds, 5, 60, d.phone.ringSeconds);
  s.phone.maxCallSeconds = clampInt(ph.maxCallSeconds, 60, 600, d.phone.maxCallSeconds);

  return { settings: s, errors };
}

/** Keeps digits and one leading plus, so "+1 (504) 555 0187" stores as +15045550187. */
function normalizePhone(v: string): string {
  const digits = v.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
