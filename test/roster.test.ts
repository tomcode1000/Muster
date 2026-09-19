import { test } from "node:test";
import assert from "node:assert/strict";
import { columnLetter, normalizePhone, parseRoster, resultRow } from "../src/sheets/roster";
import { validateSettings } from "../src/settings";
import { addDays, localMoment, withinHours } from "../src/domain/zoned";
import { applyTool, emptyCheckIn } from "../src/agent/tools";

const meta = { name: "Harbor Street Clinic", superintendent: "Sam", timezone: "America/New_York", planDate: "2026-09-15", vocabulary: [] };

const crew = [
  ["Company", "Trade", "Foreman", "Phone", "Language"],
  ["Gulf Coast Concrete", "Concrete", "Luis Ortega", "+1 (305) 555-0101", "Spanish"],
  ["Brightline Electric", "Electrical", "Dana Brooks", "305-555-0102", "English"],
  ["No Phone Co", "Paint", "Pat", "", "English"],
];

// Columns deliberately out of the documented order, with an extra column.
const plan = [
  ["Area", "Company", "Start", "Notes", "Work", "Crew needed", "Needs area to itself", "Prerequisites", "Materials", "End"],
  ["Level 1 west wing", "Gulf Coast Concrete", "6:30", "call early", "Slab pour", "8", "yes", "Pump truck booked; Pre-pour inspection passed", "concrete", "13:00"],
  ["Level 3 east wing", "brightline electric", "7am", "", "Rough-in", "4", "", "", "conduit", "3:30pm"],
  ["Level 2", "Unknown Co", "07:00", "", "", "", "", "", "", ""],
  ["Level 2", "Brightline Electric", "whenever", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
];

test("the roster is read by header name, in any column order", () => {
  const { project, rows, problems } = parseRoster(crew, plan, meta);
  assert.equal(project.contacts.length, 2);
  assert.equal(project.activities.length, 2);

  const pour = project.activities[0];
  assert.equal(pour.contactId, "gulf-coast-concrete");
  assert.equal(pour.start, "06:30");
  assert.equal(pour.exclusiveArea, true);
  assert.deepEqual(pour.requirements.map((r) => r.label), ["Pump truck booked", "Pre-pour inspection passed"]);
  assert.equal(rows[pour.id], 2);

  const rough = project.activities[1];
  assert.equal(rough.start, "07:00");
  assert.equal(rough.end, "15:30");
  assert.equal(rough.exclusiveArea, false);
  assert.equal(rows[rough.id], 3);

  assert.equal(project.contacts[0].language, "es");
  assert.equal(project.contacts[0].phone, "+13055550101");

  const messages = problems.map((p) => `${p.tab}:${p.row}`);
  assert.deepEqual(messages.sort(), ["Crew:4", "Tomorrow:4", "Tomorrow:5"]);
});

test("booking ids stay the same when rows move", () => {
  const moved = [plan[0], plan[2], plan[1]];
  const a = parseRoster(crew, plan, meta).project.activities.map((x) => x.id).sort();
  const b = parseRoster(crew, moved, meta);
  assert.deepEqual(b.project.activities.map((x) => x.id).sort(), a);
  assert.equal(b.rows[a.find((id) => id.startsWith("gulf"))!], 3);
});

test("phone numbers need a country code unless they are 10 digit US numbers", () => {
  assert.equal(normalizePhone("+234 708 676 0602"), "+2347086760602");
  assert.equal(normalizePhone("(305) 555-0101"), "+13055550101");
  assert.equal(normalizePhone("0708 676 0602"), null);
  assert.equal(normalizePhone(""), null);
});

test("result row reflects the check-in in sheet form", () => {
  const { project } = parseRoster(crew, plan, meta);
  const pour = project.activities[0];
  const at = "2026-09-14T21:05:00.000Z";
  const ev = { quote: "q", callId: "call_abc", at };
  let c = emptyCheckIn(project.id, project.planDate, pour, at);
  c = applyTool(pour, c, "confirm_attendance", { coming: true, crew_size: 7, arrival_time: "06:15" }, ev).checkIn;
  c = applyTool(pour, c, "confirm_requirement", { requirement_id: "pump-truck-booked", status: "not_confirmed" }, ev).checkIn;
  c = applyTool(pour, c, "finish_check_in", { summary: "Seven at 6:15, pump truck unconfirmed" }, ev).checkIn;
  c.callIds = ["call_abc"];
  c.attempts = 1;

  const row = resultRow(pour, c, { timezone: "America/New_York", callLogUrl: (id) => `https://x.test/calls.html?id=${id}` });
  assert.equal(row[0], "Confirmed");
  assert.equal(row[1], "7");
  assert.equal(row[2], "06:15");
  assert.equal(row[3], "Pump truck booked: not confirmed; Pre-pour inspection passed: not asked");
  assert.equal(row[9], "Sep 14, 5:05 PM");
  assert.equal(row[10], '=HYPERLINK("https://x.test/calls.html?id=call_abc","Open")');
});

test("column letters", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(9), "J");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
});

test("settings reject a call time outside calling hours", () => {
  const { errors } = validateSettings({ schedule: { time: "21:00", callingHours: { start: "07:00", end: "20:00" } } });
  assert.ok(errors.some((e) => /inside calling hours/.test(e)));
});

test("settings accept friendly times and clamp limits", () => {
  const { settings, errors } = validateSettings({
    project: { name: "Harbor Street Clinic", superintendent: "Sam Reyes", timezone: "Africa/Lagos" },
    sheet: { url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0" },
    schedule: { enabled: true, time: "5pm", days: [1, 1, 9, 3], retryAfterMinutes: 1, maxAttempts: 99 },
  });
  assert.deepEqual(errors, []);
  assert.equal(settings.schedule.time, "17:00");
  assert.deepEqual(settings.schedule.days, [1, 3]);
  assert.equal(settings.schedule.retryAfterMinutes, 5);
  assert.equal(settings.schedule.maxAttempts, 5);
});

test("settings reject an unknown time zone and a bad sheet link", () => {
  const { errors } = validateSettings({ project: { timezone: "Mars/Olympus" }, sheet: { url: "https://example.com" } });
  assert.equal(errors.length, 2);
});

test("local time in the project's zone, across a date line", () => {
  // 03:30 UTC on the 15th is still the 14th in New York.
  const m = localMoment(new Date("2026-09-15T03:30:00Z"), "America/New_York");
  assert.deepEqual(m, { date: "2026-09-14", time: "23:30", weekday: 1 });
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(withinHours("20:00", "07:00", "20:00"), false);
  assert.equal(withinHours("07:00", "07:00", "20:00"), true);
});
