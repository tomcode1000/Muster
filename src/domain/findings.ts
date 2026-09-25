/**
 * Turns a day's plan and the check-ins against it into findings.
 *
 * Pure functions only. Every finding's wording is computed from the record in
 * front of it, and carries the evidence it rests on, so an explanation cannot
 * drift from what the foreman actually said.
 */

import type {
  Activity,
  CheckIn,
  Evidence,
  Finding,
  Project,
  Severity,
} from "./types";
import { formatClock, overlaps, toMinutes } from "./time";

/** Minutes of lateness tolerated before an arrival counts as late. */
export const LATE_TOLERANCE_MIN = 15;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * How a blocker reads on the morning board.
 *
 * "reports a other blocker" is the sort of seam that makes a screen look
 * generated. Each category gets the words a superintendent would use, and
 * "other" says plainly that something is in the way without naming a kind.
 */
function blockerPhrase(category: string): string {
  switch (category) {
    case "material": return "a materials problem";
    case "access": return "an access problem";
    case "weather": return "a weather problem";
    case "inspection": return "an inspection problem";
    case "equipment": return "an equipment problem";
    case "safety": return "a safety problem";
    case "labor": return "a labour problem";
    default: return "something in the way";
  }
}

export function evaluateDay(project: Project, checkIns: CheckIn[]): Finding[] {
  const byActivity = new Map(checkIns.map((c) => [c.activityId, c]));
  const findings: Finding[] = [];

  for (const activity of project.activities) {
    findings.push(...evaluateActivity(project, activity, byActivity.get(activity.id)));
  }
  findings.push(...areaClashes(project, byActivity));

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      firstStart(project, a) - firstStart(project, b),
  );
}

export function evaluateActivity(
  project: Project,
  activity: Activity,
  checkIn: CheckIn | undefined,
): Finding[] {
  const who = companyFor(project, activity);
  const label = `${who}, ${activity.description}`;
  const out: Finding[] = [];

  if (!checkIn || checkIn.status === "pending" || checkIn.status === "in_progress") {
    out.push({
      code: "NO_CHECK_IN",
      severity: activity.requirements.length > 0 ? "high" : "medium",
      activityIds: [activity.id],
      title: `${who} has not checked in`,
      detail: `${activity.description} in ${activity.area} at ${formatClock(activity.start)} is unconfirmed.`,
      evidence: [],
    });
    return out;
  }

  if (checkIn.status === "unreachable") {
    out.push({
      code: "UNREACHABLE",
      severity: "high",
      activityIds: [activity.id],
      title: `${who} could not be reached`,
      detail: `${checkIn.attempts} ${checkIn.attempts === 1 ? "attempt" : "attempts"}, no answer. ${activity.description} at ${formatClock(activity.start)} is unconfirmed.`,
      evidence: [],
    });
    return out;
  }

  const att = checkIn.attendance;
  if (att && !att.coming) {
    out.push({
      code: "NOT_COMING",
      severity: "critical",
      activityIds: [activity.id],
      title: `${who} is not coming`,
      detail: `${label} in ${activity.area} will not start at ${formatClock(activity.start)}.`,
      evidence: [att.evidence],
    });
  }

  if (att && att.coming) {
    if (att.crewSize !== null && att.crewSize < activity.crewNeeded) {
      const ratio = att.crewSize / activity.crewNeeded;
      out.push({
        code: "CREW_SHORT",
        severity: ratio < 0.5 ? "high" : "medium",
        activityIds: [activity.id],
        title: `${who} is bringing ${att.crewSize} of ${activity.crewNeeded}`,
        detail: `${activity.description} is planned for a crew of ${activity.crewNeeded}.`,
        evidence: [att.evidence],
      });
    }
    if (att.arrival !== null) {
      const late = toMinutes(att.arrival) - toMinutes(activity.start);
      if (late > LATE_TOLERANCE_MIN) {
        out.push({
          code: "LATE_ARRIVAL",
          severity: late >= 60 ? "high" : "medium",
          activityIds: [activity.id],
          title: `${who} arrives ${late} minutes late`,
          detail: `Planned start ${formatClock(activity.start)}, arriving ${formatClock(att.arrival)}.`,
          evidence: [att.evidence],
        });
      }
    }
  }

  for (const req of activity.requirements) {
    const check = latestFor(checkIn.requirements, (r) => r.requirementId === req.id);
    if (!check || check.status !== "confirmed") {
      out.push({
        code: "REQUIREMENT_UNCONFIRMED",
        severity: "high",
        activityIds: [activity.id],
        title: `${req.label} not confirmed for ${who}`,
        detail: check
          ? `Foreman reported "${check.status.replace("_", " ")}"${check.note ? `: ${check.note}` : ""}.`
          : `The foreman was not able to confirm it on the call.`,
        evidence: check ? [check.evidence] : [],
      });
    }
  }

  for (const material of activity.materials) {
    const delivery = latestFor(checkIn.deliveries, (d) => sameMaterial(d.material, material));
    if (delivery && toMinutes(delivery.windowStart) > toMinutes(activity.start)) {
      out.push({
        code: "DELIVERY_AFTER_START",
        severity: "medium",
        activityIds: [activity.id],
        title: `${material} lands after ${who} starts`,
        detail: `Delivery from ${formatClock(delivery.windowStart)}, work planned from ${formatClock(activity.start)}.`,
        evidence: [delivery.evidence],
      });
    }
  }

  for (const blocker of checkIn.blockers) {
    out.push({
      code: "BLOCKER",
      severity: blocker.category === "safety" ? "critical" : "high",
      activityIds: [activity.id],
      title: `${who} reports ${blockerPhrase(blocker.category)}`,
      detail: blocker.description,
      evidence: [blocker.evidence],
    });
  }

  if (checkIn.callback) {
    out.push({
      code: "CALLBACK_REQUESTED",
      severity: "low",
      activityIds: [activity.id],
      title: `${who} asked for a call back`,
      detail: checkIn.callback.reason,
      evidence: [checkIn.callback.evidence],
    });
  }

  return out;
}

/**
 * Two trades in one area at the same time, where either needs the area to
 * itself. Only trades that are actually coming count, so a clash disappears
 * when one of them cancels.
 */
export function areaClashes(project: Project, byActivity: Map<string, CheckIn>): Finding[] {
  const out: Finding[] = [];
  const acts = project.activities;

  for (let i = 0; i < acts.length; i++) {
    for (let j = i + 1; j < acts.length; j++) {
      const a = acts[i];
      const b = acts[j];
      if (normalizeArea(a.area) !== normalizeArea(b.area)) continue;
      if (!a.exclusiveArea && !b.exclusiveArea) continue;
      if (!expectedOnSite(byActivity.get(a.id)) || !expectedOnSite(byActivity.get(b.id))) continue;

      const aStart = effectiveStart(a, byActivity.get(a.id));
      const bStart = effectiveStart(b, byActivity.get(b.id));
      if (!overlaps(aStart, a.end, bStart, b.end)) continue;

      out.push({
        code: "AREA_CLASH",
        severity: "high",
        activityIds: [a.id, b.id],
        title: `${companyFor(project, a)} and ${companyFor(project, b)} both in ${a.area}`,
        detail: `${a.description} (${formatClock(aStart)} to ${formatClock(a.end)}) overlaps ${b.description} (${formatClock(bStart)} to ${formatClock(b.end)}).`,
        evidence: [byActivity.get(a.id)?.attendance?.evidence, byActivity.get(b.id)?.attendance?.evidence].filter(
          (e): e is Evidence => Boolean(e),
        ),
      });
    }
  }
  return out;
}

/** Unconfirmed trades are still booked, so they still occupy their area. */
function expectedOnSite(checkIn: CheckIn | undefined): boolean {
  return !(checkIn?.attendance && !checkIn.attendance.coming);
}

function effectiveStart(activity: Activity, checkIn: CheckIn | undefined): string {
  const arrival = checkIn?.attendance?.arrival;
  if (arrival && toMinutes(arrival) > toMinutes(activity.start)) return arrival;
  return activity.start;
}

function companyFor(project: Project, activity: Activity): string {
  return project.contacts.find((c) => c.id === activity.contactId)?.company ?? activity.contactId;
}

function latestFor<T extends { evidence: Evidence }>(items: T[], match: (item: T) => boolean): T | undefined {
  return items.filter(match).sort((a, b) => a.evidence.at.localeCompare(b.evidence.at)).at(-1);
}

function sameMaterial(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.includes(y) || y.includes(x);
}

function normalizeArea(area: string): string {
  return area.toLowerCase().replace(/\s+/g, " ").trim();
}

function firstStart(project: Project, finding: Finding): number {
  const starts = finding.activityIds
    .map((id) => project.activities.find((a) => a.id === id))
    .filter((a): a is Activity => Boolean(a))
    .map((a) => toMinutes(a.start));
  return starts.length ? Math.min(...starts) : Number.MAX_SAFE_INTEGER;
}
