import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_PROFILE, renderTemplate, unknownPlaceholders, validateProfile } from "../src/agent/profile";
import { buildSession, greeting, systemPrompt } from "../src/agent/checkin";
import { applyTool, emptyCheckIn } from "../src/agent/tools";
import { resultRow } from "../src/sheets/roster";
import type { Project } from "../src/domain/types";

const project: Project = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "project.json"), "utf8"));
const pour = project.activities[0];
const luis = project.contacts.find((c) => c.id === pour.contactId)!;
const dana = project.contacts.find((c) => c.language === "en")!;
const electrical = project.activities.find((a) => a.contactId === dana.id)!;
const ev = { quote: "sí, necesitamos el hoist", callId: "call_q", at: "2026-09-14T21:00:00.000Z" };

const profile = validateProfile({
  name: "Harbor Check",
  greetingEn: "Hey {first_name}, {agent} here about {work} at {start}.",
  greetingEs: "Hola {first_name}, soy {agent}.",
  instructions: "Remind crews that gate 2 needs a badge.",
  questions: [
    { text: "Do you need the hoist tomorrow?", answerType: "yes_no" },
    { text: "How many deliveries are coming?", answerType: "number" },
    { text: "Any hot work planned?", answerType: "text" },
  ],
}).profile;

test("default profile validates cleanly", () => {
  assert.deepEqual(validateProfile(DEFAULT_PROFILE).errors, []);
  assert.deepEqual(validateProfile(undefined).profile, DEFAULT_PROFILE);
});

test("greetings fill in known placeholders and reject unknown ones", () => {
  assert.equal(greeting(project, electrical, dana, profile), "Hey Dana, Harbor Check here about Electrical rough-in at 7am.");
  assert.equal(greeting(project, pour, luis, profile), "Hola Luis, soy Harbor Check.");
  assert.deepEqual(unknownPlaceholders("Hi {name} at {start}"), ["name"]);
  const { errors } = validateProfile({ greetingEn: "Hi {name}" });
  assert.match(errors[0], /unknown fill-in \{name\}/);
  assert.equal(renderTemplate("{nope}", { agent: "", foreman: "", first_name: "", company: "", work: "", area: "", start: "", superintendent: "", project: "" }), "{nope}");
});

test("question ids are stable across rewording and unique", () => {
  const ids = profile.questions.map((q) => q.id);
  assert.equal(new Set(ids).size, 3);
  const reworded = validateProfile({ questions: [{ id: ids[0], text: "Will you need the hoist?", answerType: "yes_no" }] });
  assert.equal(reworded.profile.questions[0].id, ids[0]);
  const dupes = validateProfile({ questions: [{ text: "Hoist?" }, { text: "Hoist?" }] }).profile.questions;
  assert.notEqual(dupes[0].id, dupes[1].id);
});

test("limits are enforced", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ text: `Question ${i}` }));
  assert.ok(validateProfile({ questions: many }).errors.some((e) => /At most 10/.test(e)));
  assert.ok(validateProfile({ instructions: "x".repeat(2001) }).errors.some((e) => /2000/.test(e)));
});

test("the prompt carries questions and instructions after the fixed rules", () => {
  const prompt = systemPrompt(project, pour, luis, profile);
  assert.match(prompt, /^You are Harbor Check/);
  const rules = prompt.indexOf("Record facts only when the foreman has actually said them");
  const site = prompt.indexOf("Remind crews that gate 2 needs a badge.");
  assert.ok(rules > 0 && site > rules, "instructions come after the rules");
  assert.match(prompt, /rules win/);
  for (const q of profile.questions) assert.ok(prompt.includes(`question_id: ${q.id}`));
});

test("record_answer is offered only when there are questions", () => {
  const names = (p: typeof profile) => buildSession(project, pour, luis, "audio/pcm", p).tools.map((t: any) => t.name);
  assert.ok(names(profile).includes("record_answer"));
  assert.ok(!names(DEFAULT_PROFILE).includes("record_answer"));
  assert.equal(names(profile).at(-1), "finish_check_in");
});

test("answers are checked against the question's type and the latest one wins", () => {
  const [hoist, deliveries, hotWork] = profile.questions;
  let c = emptyCheckIn(project.id, project.planDate, pour, ev.at);
  const run = (id: string, answer: string) => applyTool(pour, c, "record_answer", { question_id: id, answer }, ev, profile.questions);

  assert.equal(run(hoist.id, "maybe").isError, true);
  assert.equal(run(deliveries.id, "a few").isError, true);
  assert.equal(run("made_up", "yes").isError, true);

  c = run(hoist.id, "Sí, we need it").checkIn;
  c = run(deliveries.id, "3 trucks").checkIn;
  c = run(hotWork.id, "Welding on the east stair").checkIn;
  c = run(hoist.id, "no, not anymore").checkIn;

  assert.deepEqual(c.answers!.map((a) => [a.questionId, a.value]), [
    [deliveries.id, "3"],
    [hotWork.id, "Welding on the east stair"],
    [hoist.id, "no"],
  ]);
  assert.equal(c.answers![2].evidence.quote, ev.quote);

  const row = resultRow(pour, c, { timezone: "America/New_York", callLogUrl: () => null });
  assert.equal(row.at(-1), "How many deliveries are coming?: 3; Any hot work planned?: Welding on the east stair; Do you need the hoist tomorrow?: no");
});
