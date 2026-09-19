/**
 * What a workspace may spend on calls, and what it has spent.
 *
 * Every minute of conversation costs real money (the voice agent and the phone
 * line are both billed by the minute), so limits are enforced on the server, not
 * just shown. Three limits apply:
 *
 *   minutes per month   total talk time, phone and browser check-ins together
 *   calls per day       phone dials plus browser check-ins, a guard against loops
 *   subcontractors      the size of the crew list
 *
 * The plan comes from the server's environment, never from the page, so a
 * visitor cannot raise their own limits.
 */

import type { CallRecord } from "./store";
import { listCallsSince, readState, writeState } from "./store";
import { localMoment } from "./domain/zoned";

export type PlanId = "free" | "pro" | "business";

export interface PlanLimits {
  id: PlanId;
  name: string;
  /** Monthly price in whole currency units, matching the landing page. */
  price: number;
  minutesPerMonth: number;
  callsPerDay: number;
  /** null means no limit. */
  crewLimit: number | null;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: { id: "free", name: "Free", price: 0, minutesPerMonth: 30, callsPerDay: 20, crewLimit: 5 },
  pro: { id: "pro", name: "Pro", price: 12, minutesPerMonth: 300, callsPerDay: 100, crewLimit: 50 },
  business: { id: "business", name: "Business", price: 29, minutesPerMonth: 1000, callsPerDay: 400, crewLimit: null },
};

export function currentPlan(): PlanLimits {
  const id = (process.env.MUSTER_PLAN || "free").toLowerCase() as PlanId;
  const base = PLANS[id] ?? PLANS.free;
  // Operators can tune a limit without changing the plan table.
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  return {
    ...base,
    minutesPerMonth: num(process.env.MUSTER_MINUTES_PER_MONTH) ?? base.minutesPerMonth,
    callsPerDay: num(process.env.MUSTER_CALLS_PER_DAY) ?? base.callsPerDay,
  };
}

// ----------------------------------------------------------------------------
// Dials that never became a conversation still count toward the daily limit.
// ----------------------------------------------------------------------------

interface DialLog {
  dials: string[];
}

const DIALS = "usage-dials";
const KEEP_DAYS = 45;

export function recordDial(at = new Date()) {
  const log = readState<DialLog>(DIALS) ?? { dials: [] };
  const cutoff = at.getTime() - KEEP_DAYS * 86_400_000;
  log.dials = [...log.dials.filter((d) => new Date(d).getTime() >= cutoff), at.toISOString()];
  writeState(DIALS, log);
}

// ----------------------------------------------------------------------------
// Measuring
// ----------------------------------------------------------------------------

/** Seconds of talk time in a call, counting a live call up to now. */
export function callSeconds(call: Pick<CallRecord, "startedAt" | "endedAt">, now = new Date()): number {
  const start = new Date(call.startedAt).getTime();
  const end = call.endedAt ? new Date(call.endedAt).getTime() : now.getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

export interface UsageSnapshot {
  plan: PlanLimits;
  period: { month: string; resetsOn: string };
  minutes: { used: number; limit: number; remainingSeconds: number };
  calls: { today: number; limit: number; thisMonth: number };
  crew: { count: number; limit: number | null };
  blocked: string | null;
}

/**
 * Pure calculation from the records, so it can be tested without a clock or disk.
 * Periods follow the project's own calendar, not the server's.
 */
export function measure(opts: {
  plan: PlanLimits;
  calls: Pick<CallRecord, "startedAt" | "endedAt" | "channel">[];
  dials: string[];
  crewCount: number;
  timezone: string;
  now?: Date;
}): UsageSnapshot {
  const now = opts.now ?? new Date();
  const local = localMoment(now, opts.timezone);
  const month = local.date.slice(0, 7);
  const inMonth = (iso: string) => localMoment(new Date(iso), opts.timezone).date.slice(0, 7) === month;
  const onDay = (iso: string) => localMoment(new Date(iso), opts.timezone).date === local.date;

  const monthCalls = opts.calls.filter((c) => inMonth(c.startedAt));
  const seconds = monthCalls.reduce((sum, c) => sum + callSeconds(c, now), 0);
  const limitSeconds = opts.plan.minutesPerMonth * 60;

  // A phone call is logged once as a dial; browser check-ins have no dial, so count their records.
  const browserToday = opts.calls.filter((c) => c.channel === "browser" && onDay(c.startedAt)).length;
  const dialsToday = opts.dials.filter(onDay).length;
  const today = dialsToday + browserToday;

  const [y, m] = month.split("-").map(Number);
  const resetsOn = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);

  let blocked: string | null = null;
  if (seconds >= limitSeconds) blocked = `This month's ${opts.plan.minutesPerMonth} call minutes are used up. They reset on ${resetsOn}.`;
  else if (today >= opts.plan.callsPerDay) blocked = `Today's limit of ${opts.plan.callsPerDay} calls is reached. It resets at midnight.`;

  return {
    plan: opts.plan,
    period: { month, resetsOn },
    minutes: {
      used: Math.round((seconds / 60) * 10) / 10,
      limit: opts.plan.minutesPerMonth,
      remainingSeconds: Math.max(0, limitSeconds - seconds),
    },
    calls: { today, limit: opts.plan.callsPerDay, thisMonth: monthCalls.length },
    crew: { count: opts.crewCount, limit: opts.plan.crewLimit },
    blocked,
  };
}

export interface UsageDay {
  date: string;
  minutes: number;
  calls: number;
}

/** Minutes and calls per local day, oldest first, for the last `days` days. */
export function dailyUsage(timezone: string, days = 14, now = new Date()): UsageDay[] {
  const today = localMoment(now, timezone).date;
  const out: UsageDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), minutes: 0, calls: 0 });
  }
  const first = out[0].date;
  const byDate = new Map(out.map((d) => [d.date, d]));
  for (const call of listCallsSince(`${first}T00:00:00.000Z`)) {
    const day = byDate.get(localMoment(new Date(call.startedAt), timezone).date);
    if (!day) continue;
    day.calls += 1;
    day.minutes += callSeconds(call, now) / 60;
  }
  for (const day of out) day.minutes = Math.round(day.minutes * 10) / 10;
  return out;
}

export function usageNow(timezone: string, crewCount: number): UsageSnapshot {
  // Two months back covers the current period in any time zone.
  const since = new Date(Date.now() - 62 * 86_400_000).toISOString();
  return measure({
    plan: currentPlan(),
    calls: listCallsSince(since),
    dials: (readState<DialLog>(DIALS) ?? { dials: [] }).dials,
    crewCount,
    timezone,
  });
}
