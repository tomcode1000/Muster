import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, callSeconds, measure } from "../src/usage";

const now = new Date("2026-09-16T15:00:00Z"); // 4pm in Lagos
const tz = "Africa/Lagos";
const call = (start: string, minutes: number | null, channel: "phone" | "browser" = "phone") => ({
  startedAt: start,
  endedAt: minutes === null ? null : new Date(new Date(start).getTime() + minutes * 60_000).toISOString(),
  channel,
});

test("talk time counts finished calls and live ones up to now", () => {
  assert.equal(callSeconds(call("2026-09-16T14:00:00Z", 2), now), 120);
  assert.equal(callSeconds(call("2026-09-16T14:58:00Z", null), now), 120);
});

test("only this month's calls count, in the project's own time zone", () => {
  const u = measure({
    plan: PLANS.free,
    calls: [
      call("2026-09-02T10:00:00Z", 10),
      call("2026-09-16T14:00:00Z", 5),
      // 23:30 UTC on 31 Aug is already 00:30 on 1 Sep in Lagos, so it counts.
      call("2026-08-31T23:30:00Z", 4),
      call("2026-08-20T10:00:00Z", 30),
    ],
    dials: [],
    crewCount: 2,
    timezone: tz,
    now,
  });
  assert.equal(u.period.month, "2026-09");
  assert.equal(u.minutes.used, 19);
  assert.equal(u.minutes.remainingSeconds, (30 - 19) * 60);
  assert.equal(u.period.resetsOn, "2026-10-01");
  assert.equal(u.blocked, null);
});

test("using up the monthly minutes blocks further calls", () => {
  const u = measure({ plan: PLANS.free, calls: [call("2026-09-10T10:00:00Z", 30)], dials: [], crewCount: 0, timezone: tz, now });
  assert.equal(u.minutes.remainingSeconds, 0);
  assert.match(u.blocked!, /30 call minutes are used up/);
});

test("the daily limit counts phone dials and browser check-ins together", () => {
  const plan = { ...PLANS.free, callsPerDay: 3 };
  const dials = ["2026-09-16T09:00:00Z", "2026-09-16T10:00:00Z", "2026-09-15T10:00:00Z"];
  const calls = [call("2026-09-16T11:00:00Z", 1, "browser"), call("2026-09-16T12:00:00Z", 1, "phone")];
  const u = measure({ plan, calls, dials, crewCount: 0, timezone: tz, now });
  assert.equal(u.calls.today, 3);
  assert.match(u.blocked!, /limit of 3 calls/);
});

test("December rolls over to January", () => {
  const u = measure({ plan: PLANS.pro, calls: [], dials: [], crewCount: 0, timezone: tz, now: new Date("2026-12-20T12:00:00Z") });
  assert.equal(u.period.resetsOn, "2027-01-01");
});
