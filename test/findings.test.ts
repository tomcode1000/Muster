import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { evaluateDay } from "../src/domain/findings";
import { applyTool, emptyCheckIn } from "../src/agent/tools";
import type { CheckIn, Evidence, Project } from "../src/domain/types";

const project: Project = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "project.json"), "utf8"),
);

let clock = 0;
const ev = (quote: string): Evidence => ({
  quote,
  callId: "call_test",
  at: new Date(Date.UTC(2026, 8, 14, 21, 0, clock++)).toISOString(),
});

function checkIn(activityId: string, calls: [string, Record<string, unknown>, string][]): CheckIn {
  const activity = project.activities.find((a) => a.id === activityId)!;
  let c = emptyCheckIn(project.id, project.planDate, activity, ev("").at);
  for (const [name, args, quote] of calls) {
    const out = applyTool(activity, c, name, args, ev(quote));
    assert.equal(out.isError, false, `${name} failed: ${JSON.stringify(out.result)}`);
    c = out.checkIn;
  }
  return c;
}

const finish: [string, Record<string, unknown>, string] = ["finish_check_in", { summary: "done" }, "bye"];

function allGood(): CheckIn[] {
  return [
    checkIn("l1-slab-pour", [
      ["confirm_attendance", { coming: true, crew_size: 8, arrival_time: "06:15" }, "ocho, a las seis y cuarto"],
      ["confirm_requirement", { requirement_id: "pump-truck", status: "confirmed" }, "la bomba está confirmada"],
      ["confirm_requirement", { requirement_id: "pre-pour-inspection", status: "confirmed" }, "pasamos la inspección hoy"],
      finish,
    ]),
    checkIn("l3-electrical-rough-in", [["confirm_attendance", { coming: true, crew_size: 4, arrival_time: "7:00" }, "four of us at seven"], finish]),
    checkIn("l3-drywall-hang", [["confirm_attendance", { coming: true, crew_size: 6, arrival_time: "09:00" }, "seis a las nueve"], finish]),
    checkIn("l2-plumbing-top-out", [["confirm_attendance", { coming: true, crew_size: 3, arrival_time: "07:30" }, "three, seven thirty"], finish]),
  ];
}

const codes = (checkIns: CheckIn[]) => evaluateDay(project, checkIns).map((f) => f.code);

test("a fully confirmed day has no findings except the booked area clash", () => {
  // Electrical is non-exclusive but drywall needs the area, and they overlap from 09:00.
  assert.deepEqual(codes(allGood()), ["AREA_CLASH"]);
});

test("nobody checked in yet: every booking is unconfirmed, the pour ranks first", () => {
  const findings = evaluateDay(project, []);
  assert.equal(findings.filter((f) => f.code === "NO_CHECK_IN").length, 4);
  assert.equal(findings[0].activityIds[0], "l1-slab-pour");
  assert.equal(findings[0].severity, "high");
});

test("a crew that cancels is critical and removes its area clash", () => {
  const day = allGood();
  day[2] = checkIn("l3-drywall-hang", [["confirm_attendance", { coming: false }, "mañana no podemos"], finish]);
  const found = codes(day);
  assert.ok(found.includes("NOT_COMING"));
  assert.ok(!found.includes("AREA_CLASH"));
  assert.equal(evaluateDay(project, day)[0].severity, "critical");
});

test("short crew under half is high, otherwise medium", () => {
  const day = allGood();
  day[0] = checkIn("l1-slab-pour", [
    ["confirm_attendance", { coming: true, crew_size: 3, arrival_time: "06:30" }, "solo tres"],
    ["confirm_requirement", { requirement_id: "pump-truck", status: "confirmed" }, "sí"],
    ["confirm_requirement", { requirement_id: "pre-pour-inspection", status: "confirmed" }, "sí"],
    finish,
  ]);
  const short = evaluateDay(project, day).find((f) => f.code === "CREW_SHORT")!;
  assert.equal(short.severity, "high");
  assert.equal(short.title, "Gulf Coast Concrete is bringing 3 of 8");
  assert.equal(short.evidence[0].quote, "solo tres");
});

test("late arrival counts only beyond the tolerance", () => {
  const onTime = allGood();
  onTime[3] = checkIn("l2-plumbing-top-out", [["confirm_attendance", { coming: true, crew_size: 3, arrival_time: "07:45" }, "quarter to eight"], finish]);
  assert.ok(!codes(onTime).includes("LATE_ARRIVAL"));

  const late = allGood();
  late[3] = checkIn("l2-plumbing-top-out", [["confirm_attendance", { coming: true, crew_size: 3, arrival_time: "8:30am" }, "more like eight thirty"], finish]);
  const f = evaluateDay(project, late).find((x) => x.code === "LATE_ARRIVAL")!;
  assert.equal(f.title, "Tidewater Plumbing arrives 60 minutes late");
  assert.equal(f.severity, "high");
});

test("an unconfirmed prerequisite is a finding even when the crew is coming", () => {
  const day = allGood();
  day[0] = checkIn("l1-slab-pour", [
    ["confirm_attendance", { coming: true, crew_size: 8, arrival_time: "06:15" }, "ocho"],
    ["confirm_requirement", { requirement_id: "pump-truck", status: "not_confirmed", note: "dispatch has not called back" }, "la bomba no la han confirmado"],
    ["confirm_requirement", { requirement_id: "pre-pour-inspection", status: "confirmed" }, "sí"],
    finish,
  ]);
  const f = evaluateDay(project, day).filter((x) => x.code === "REQUIREMENT_UNCONFIRMED");
  assert.equal(f.length, 1);
  assert.equal(f[0].title, "Pump truck booked not confirmed for Gulf Coast Concrete");
  assert.match(f[0].detail, /dispatch has not called back/);
});

test("the latest statement about a prerequisite wins", () => {
  const day = allGood();
  day[0] = checkIn("l1-slab-pour", [
    ["confirm_attendance", { coming: true, crew_size: 8, arrival_time: "06:15" }, "ocho"],
    ["confirm_requirement", { requirement_id: "pump-truck", status: "unknown" }, "no sé"],
    ["confirm_requirement", { requirement_id: "pump-truck", status: "confirmed" }, "ah sí, ya me confirmaron"],
    ["confirm_requirement", { requirement_id: "pre-pour-inspection", status: "confirmed" }, "sí"],
    finish,
  ]);
  assert.ok(!codes(day).includes("REQUIREMENT_UNCONFIRMED"));
});

test("a delivery landing after the start time is flagged against the right material", () => {
  const day = allGood();
  day[2] = checkIn("l3-drywall-hang", [
    ["confirm_attendance", { coming: true, crew_size: 6, arrival_time: "09:00" }, "seis"],
    ["log_delivery", { material: "Drywall board", window_start: "11:00", window_end: "12:00" }, "el board llega a las once"],
    finish,
  ]);
  const f = evaluateDay(project, day).find((x) => x.code === "DELIVERY_AFTER_START")!;
  assert.equal(f.detail, "Delivery from 11am, work planned from 9am.");
});

test("a safety blocker is critical", () => {
  const day = allGood();
  day[1] = checkIn("l3-electrical-rough-in", [
    ["confirm_attendance", { coming: true, crew_size: 4, arrival_time: "07:00" }, "four at seven"],
    ["report_blocker", { category: "safety", description: "Guardrail missing at the east stair opening" }, "the guardrail at the east stair is still down"],
    finish,
  ]);
  const f = evaluateDay(project, day)[0];
  assert.equal(f.code, "BLOCKER");
  assert.equal(f.severity, "critical");
});

test("unreachable after attempts is high and names the attempts", () => {
  const activity = project.activities[3];
  const c = { ...emptyCheckIn(project.id, project.planDate, activity, ev("").at), status: "unreachable" as const, attempts: 2 };
  const day = allGood();
  day[3] = c;
  const f = evaluateDay(project, day).find((x) => x.code === "UNREACHABLE")!;
  assert.match(f.detail, /^2 attempts, no answer/);
});

test("late arrival shifts the effective start used for clashes", () => {
  const day = allGood();
  // Electrical finishes at 15:30, so drywall arriving at 16:00 no longer overlaps it.
  day[2] = checkIn("l3-drywall-hang", [["confirm_attendance", { coming: true, crew_size: 6, arrival_time: "16:00" }, "a las cuatro"], finish]);
  assert.ok(!codes(day).includes("AREA_CLASH"));
});
