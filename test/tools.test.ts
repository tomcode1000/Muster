import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTool, emptyCheckIn, toolDefinitions } from "../src/agent/tools";
import { normalizeClock } from "../src/domain/time";
import { keyterms } from "../src/agent/checkin";
import type { Activity, Evidence, Project } from "../src/domain/types";

const activity: Activity = {
  id: "pour",
  contactId: "c1",
  description: "Slab pour",
  area: "Level 1",
  start: "06:30",
  end: "13:00",
  crewNeeded: 8,
  exclusiveArea: true,
  requirements: [{ id: "pump-truck", label: "Pump truck booked" }],
  materials: ["concrete"],
};
const evidence: Evidence = { quote: "q", callId: "call_x", at: "2026-09-14T21:00:00.000Z" };
const fresh = () => emptyCheckIn("p", "2026-09-15", activity, evidence.at);

test("clock times from speech normalise to HH:MM", () => {
  assert.equal(normalizeClock("7"), "07:00");
  assert.equal(normalizeClock("7:30"), "07:30");
  assert.equal(normalizeClock("07:30"), "07:30");
  assert.equal(normalizeClock("6:30 a.m."), "06:30");
  assert.equal(normalizeClock("3pm"), "15:00");
  assert.equal(normalizeClock("12am"), "00:00");
  assert.equal(normalizeClock("seven"), null);
  assert.equal(normalizeClock("25:00"), null);
  assert.equal(normalizeClock("13pm"), null);
});

test("invalid arguments are rejected and leave the record untouched", () => {
  const c = fresh();
  const out = applyTool(activity, c, "confirm_attendance", { coming: true, crew_size: 2.5 }, evidence);
  assert.equal(out.isError, true);
  assert.equal(out.checkIn, c);
  assert.equal(c.attendance, null);
});

test("an unreadable time is an error the agent must resolve by asking", () => {
  const out = applyTool(activity, fresh(), "confirm_attendance", { coming: true, arrival_time: "early" }, evidence);
  assert.equal(out.isError, true);
  assert.match(String(out.result.error), /ask the foreman/);
});

test("attendance reports what is still missing", () => {
  const out = applyTool(activity, fresh(), "confirm_attendance", { coming: true, crew_size: 8 }, evidence);
  assert.deepEqual(out.result.still_needed, ["arrival time"]);
});

test("a partial correction keeps the earlier field", () => {
  let c = applyTool(activity, fresh(), "confirm_attendance", { coming: true, crew_size: 8, arrival_time: "06:30" }, evidence).checkIn;
  c = applyTool(activity, c, "confirm_attendance", { coming: true, arrival_time: "07:00" }, evidence).checkIn;
  assert.equal(c.attendance!.crewSize, 8);
  assert.equal(c.attendance!.arrival, "07:00");
});

test("a requirement outside the booking is rejected", () => {
  const out = applyTool(activity, fresh(), "confirm_requirement", { requirement_id: "crane", status: "confirmed" }, evidence);
  assert.equal(out.isError, true);
});

test("finishing without attendance is refused", () => {
  const out = applyTool(activity, fresh(), "finish_check_in", { summary: "x" }, evidence);
  assert.equal(out.isError, true);
});

test("finishing marks the check-in complete", () => {
  let c = applyTool(activity, fresh(), "confirm_attendance", { coming: false }, evidence).checkIn;
  const out = applyTool(activity, c, "finish_check_in", { summary: "Not coming" }, evidence);
  assert.equal(out.finished, true);
  assert.equal(out.checkIn.status, "complete");
});

test("confirm_requirement is only offered when the booking has prerequisites", () => {
  const names = (a: Activity) => toolDefinitions(a).map((t: any) => t.name);
  assert.ok(names(activity).includes("confirm_requirement"));
  assert.ok(!names({ ...activity, requirements: [] }).includes("confirm_requirement"));
});

test("keyterms are unique and capped at 100", () => {
  const project = {
    name: "P",
    superintendent: "Sam",
    vocabulary: [...Array.from({ length: 150 }, (_, i) => `term ${i}`), "Level 1"],
  } as unknown as Project;
  const terms = keyterms(project, activity, { id: "c1", company: "Co", trade: "t", foreman: "F", phone: "", language: "en" });
  assert.equal(terms.length, 100);
  assert.equal(new Set(terms.map((t) => t.toLowerCase())).size, 100);
});
