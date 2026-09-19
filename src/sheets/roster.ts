/**
 * The superintendent's sheet, read as a plan and written back as results.
 *
 * Two tabs. "Crew" lists who can be called. "Tomorrow" lists the bookings, and
 * Muster fills in the result columns beside each booking as the calls happen.
 * Columns are found by header name, so the superintendent can reorder them or
 * add their own without breaking anything.
 */

import type { Activity, CheckIn, Contact, Project } from "../domain/types";
import { normalizeClock } from "../domain/time";

export const CREW_TAB = "Crew";
export const PLAN_TAB = "Tomorrow";

export const CREW_HEADERS = ["Company", "Trade", "Foreman", "Phone", "Language"];
export const PLAN_INPUT_HEADERS = [
  "Company",
  "Work",
  "Area",
  "Start",
  "End",
  "Crew needed",
  "Needs area to itself",
  "Prerequisites",
  "Materials",
];
export const PLAN_RESULT_HEADERS = [
  "Status",
  "Crew confirmed",
  "Arrival",
  "Prerequisite check",
  "Deliveries",
  "Blockers",
  "Call back",
  "Summary",
  "Attempts",
  "Last updated",
  "Call log",
  // Added after the first release; kept last so existing sheets stay aligned.
  "Answers",
];

export interface RosterMeta {
  name: string;
  superintendent: string;
  timezone: string;
  planDate: string;
  vocabulary: string[];
}

export interface RowProblem {
  tab: string;
  row: number;
  message: string;
}

export interface ParsedRoster {
  project: Project;
  /** Sheet row number (1 based) for each activity id, for writing results back. */
  rows: Record<string, number>;
  problems: RowProblem[];
}

export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

function headerIndex(header: string[]): (name: string) => number {
  const lower = header.map((h) => h.trim().toLowerCase());
  return (name) => lower.indexOf(name.toLowerCase());
}

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function parseLanguage(raw: string): Contact["language"] {
  return /^(es|spa|spanish|espa)/i.test(raw.trim()) ? "es" : "en";
}

function parseYes(raw: string): boolean {
  return /^(y|yes|true|x|1|si|sí)$/i.test(raw.trim());
}

function splitList(raw: string): string[] {
  return raw.split(/[;\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function parseRoster(crewRows: string[][], planRows: string[][], meta: RosterMeta): ParsedRoster {
  const problems: RowProblem[] = [];
  const contacts: Contact[] = [];
  const byCompany = new Map<string, Contact>();

  const [crewHeader = [], ...crewBody] = crewRows;
  const crewCol = headerIndex(crewHeader);
  for (const h of CREW_HEADERS) {
    if (crewCol(h) < 0) problems.push({ tab: CREW_TAB, row: 1, message: `Missing column "${h}"` });
  }

  crewBody.forEach((r, i) => {
    const row = i + 2;
    const cell = (h: string) => (crewCol(h) >= 0 ? (r[crewCol(h)] ?? "").trim() : "");
    const company = cell("Company");
    if (!company) return;
    const phone = normalizePhone(cell("Phone"));
    if (!phone) {
      problems.push({ tab: CREW_TAB, row, message: `${company}: phone "${cell("Phone")}" is not a full number with country code` });
      return;
    }
    const foreman = cell("Foreman");
    if (!foreman) {
      problems.push({ tab: CREW_TAB, row, message: `${company}: foreman name is empty` });
      return;
    }
    const contact: Contact = {
      id: slug(company),
      company,
      trade: cell("Trade") || "Subcontractor",
      foreman,
      phone,
      language: parseLanguage(cell("Language")),
    };
    if (byCompany.has(contact.id)) {
      problems.push({ tab: CREW_TAB, row, message: `${company} is listed twice; using the first row` });
      return;
    }
    byCompany.set(contact.id, contact);
    contacts.push(contact);
  });

  const [planHeader = [], ...planBody] = planRows;
  const planCol = headerIndex(planHeader);
  for (const h of PLAN_INPUT_HEADERS.slice(0, 4)) {
    if (planCol(h) < 0) problems.push({ tab: PLAN_TAB, row: 1, message: `Missing column "${h}"` });
  }

  const activities: Activity[] = [];
  const rows: Record<string, number> = {};
  const usedIds = new Set<string>();

  planBody.forEach((r, i) => {
    const row = i + 2;
    const cell = (h: string) => (planCol(h) >= 0 ? (r[planCol(h)] ?? "").trim() : "");
    const company = cell("Company");
    if (!company) return;
    const contact = byCompany.get(slug(company));
    if (!contact) {
      problems.push({ tab: PLAN_TAB, row, message: `${company} is not on the Crew tab` });
      return;
    }
    const start = normalizeClock(cell("Start"));
    if (!start) {
      problems.push({ tab: PLAN_TAB, row, message: `${company}: start time "${cell("Start")}" is not a time` });
      return;
    }
    const end = normalizeClock(cell("End")) ?? "17:00";
    const crewNeeded = Number.parseInt(cell("Crew needed"), 10);
    const area = cell("Area") || "Site";

    let id = `${contact.id}-${slug(area)}-${start.replace(":", "")}`;
    for (let n = 2; usedIds.has(id); n++) id = `${contact.id}-${slug(area)}-${start.replace(":", "")}-${n}`;
    usedIds.add(id);

    activities.push({
      id,
      contactId: contact.id,
      description: cell("Work") || contact.trade,
      area,
      start,
      end,
      crewNeeded: Number.isFinite(crewNeeded) && crewNeeded > 0 ? crewNeeded : 1,
      exclusiveArea: parseYes(cell("Needs area to itself")),
      requirements: splitList(cell("Prerequisites")).map((label) => ({ id: slug(label), label })),
      materials: splitList(cell("Materials")),
    });
    rows[id] = row;
  });

  return {
    project: {
      id: slug(meta.name) || "project",
      name: meta.name,
      superintendent: meta.superintendent,
      timezone: meta.timezone,
      planDate: meta.planDate,
      vocabulary: meta.vocabulary,
      contacts,
      activities,
    },
    rows,
    problems,
  };
}

const STATUS_LABEL: Record<CheckIn["status"], string> = {
  pending: "Waiting",
  in_progress: "On call",
  complete: "Checked in",
  unreachable: "No answer",
};

export function resultRow(
  activity: Activity,
  checkIn: CheckIn,
  opts: { timezone: string; callLogUrl: (callId: string) => string | null },
): string[] {
  const att = checkIn.attendance;
  let status = STATUS_LABEL[checkIn.status];
  if (checkIn.status === "complete" && att) status = att.coming ? "Confirmed" : "Not coming";

  const latestReq = new Map<string, string>();
  for (const r of checkIn.requirements) latestReq.set(r.requirementId, r.status.replace("_", " "));
  const prereqs = activity.requirements
    .map((r) => `${r.label}: ${latestReq.get(r.id) ?? "not asked"}`)
    .join("; ");

  const lastCall = checkIn.callIds.at(-1);
  const url = lastCall ? opts.callLogUrl(lastCall) : null;

  return [
    status,
    att?.crewSize != null ? String(att.crewSize) : "",
    att?.arrival ?? "",
    prereqs,
    checkIn.deliveries.map((d) => `${d.material} ${d.windowStart}${d.windowEnd ? ` to ${d.windowEnd}` : ""}`).join("; "),
    checkIn.blockers.map((b) => `${b.category}: ${b.description}`).join("; "),
    checkIn.callback?.reason ?? "",
    checkIn.summary ?? "",
    String(checkIn.attempts),
    formatLocal(checkIn.updatedAt, opts.timezone),
    url ? `=HYPERLINK("${url}","Open")` : "",
    (checkIn.answers ?? []).map((a) => `${a.question}: ${a.value}`).join("; "),
  ];
}

function formatLocal(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Spreadsheet column letter for a zero based index. */
export function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
