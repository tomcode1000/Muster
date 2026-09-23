import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muster-ws-sep-"));
process.env.MUSTER_DATA_DIR = dir;
process.env.MUSTER_OPEN_SIGNUP = "true";

// Imported after the data directory is set, so nothing touches real data.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ctx = require("../src/workspace-context") as typeof import("../src/workspace-context");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auth = require("../src/auth") as typeof import("../src/auth");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ws = require("../src/workspace") as typeof import("../src/workspace");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const settings = require("../src/settings") as typeof import("../src/settings");

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MUSTER_OPEN_SIGNUP;
});

const crew = (company: string) => ({ company, trade: "Concrete", foreman: "Dan Brooks", phone: "+15045550187", language: "en" as const });

test("the first account keeps the original workspace, the next gets its own", () => {
  const owner = auth.createUser({ name: "Tolu", email: "tolu@example.com", password: "longenough" });
  const other = auth.createUser({ name: "Ada", email: "ada@example.com", password: "longenough" });
  assert.equal(owner.workspaceId, "main");
  assert.notEqual(other.workspaceId, "main");
  assert.match(other.workspaceId, /^ws_[a-f0-9]{16}$/);
});

test("crew added in one workspace is invisible in the other", () => {
  const [owner, other] = ["tolu@example.com", "ada@example.com"].map((e) => auth.authenticate(e, "longenough"));

  ctx.withWorkspace(owner.workspaceId, () => ws.addContact(crew("Gulf Coast Concrete")));
  ctx.withWorkspace(other.workspaceId, () => ws.addContact(crew("Riverside Electric")));

  const mine = ctx.withWorkspace(owner.workspaceId, () => ws.listCrew().map((c) => c.company));
  const theirs = ctx.withWorkspace(other.workspaceId, () => ws.listCrew().map((c) => c.company));
  assert.deepEqual(mine, ["Gulf Coast Concrete"]);
  assert.deepEqual(theirs, ["Riverside Electric"]);
});

test("settings are per workspace", () => {
  const [owner, other] = ["tolu@example.com", "ada@example.com"].map((e) => auth.authenticate(e, "longenough"));
  ctx.withWorkspace(owner.workspaceId, () => settings.saveSettings({ ...settings.loadSettings(), project: { name: "Harbor Street Clinic", superintendent: "Tolu", timezone: "Africa/Lagos", vocabulary: [] } }));
  ctx.withWorkspace(other.workspaceId, () => settings.saveSettings({ ...settings.loadSettings(), project: { name: "Riverside Tower", superintendent: "Ada", timezone: "America/New_York", vocabulary: [] } }));

  assert.equal(ctx.withWorkspace(owner.workspaceId, () => settings.loadSettings().project.name), "Harbor Street Clinic");
  assert.equal(ctx.withWorkspace(other.workspaceId, () => settings.loadSettings().project.name), "Riverside Tower");
});

test("accounts and sessions live outside every workspace", () => {
  // One file of accounts, shared, or signing in could not decide where to send you.
  assert.ok(fs.existsSync(path.join(dir, "users.json")));
  const inside = fs.readdirSync(path.join(dir, "workspaces", "main"));
  assert.ok(!inside.includes("users.json"));
  assert.ok(inside.includes("settings.json"));
});

test("an id from outside cannot climb out of the data directory", () => {
  assert.equal(ctx.safeWorkspaceId("../../etc"), "etc");
  assert.equal(ctx.safeWorkspaceId(""), "main");
  assert.equal(ctx.safeWorkspaceId(undefined), "main");
  assert.ok(ctx.workspaceDir("../escape").startsWith(path.join(dir, "workspaces")));
});

test("an installation from before workspaces keeps its data", () => {
  const older = fs.mkdtempSync(path.join(os.tmpdir(), "muster-ws-old-"));
  const before = process.env.MUSTER_DATA_DIR;
  try {
    // A data directory in the old shape, written by an earlier version.
    fs.writeFileSync(path.join(older, "settings.json"), '{"project":{"name":"Old Site"}}');
    fs.mkdirSync(path.join(older, "calls"), { recursive: true });
    fs.writeFileSync(path.join(older, "calls", "call_1.json"), "{}");
    fs.writeFileSync(path.join(older, "users.json"), "[]");

    const { moved } = ctx.migrateSingleWorkspace(older);

    assert.ok(moved.includes("settings.json"));
    assert.ok(moved.includes("calls"));
    assert.ok(fs.existsSync(path.join(older, "workspaces", "main", "settings.json")));
    assert.ok(fs.existsSync(path.join(older, "workspaces", "main", "calls", "call_1.json")));
    // Accounts stay where they were: they belong to the server, not a workspace.
    assert.ok(fs.existsSync(path.join(older, "users.json")));
  } finally {
    process.env.MUSTER_DATA_DIR = before;
    fs.rmSync(older, { recursive: true, force: true });
  }
});
