import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muster-auth-"));
process.env.MUSTER_DATA_DIR = dir;
delete process.env.MUSTER_OPEN_SIGNUP;

// Imported after the data directory is set, so nothing touches real data.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auth = require("../src/auth") as typeof import("../src/auth");

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const owner = { name: "Tolu Adeyemi", email: " Tolu@Example.com ", password: "correct horse" };

test("password hashes verify only the original password", () => {
  const stored = auth.hashPassword("site trailer");
  assert.notEqual(stored, auth.hashPassword("site trailer"));
  assert.ok(auth.verifyPassword("site trailer", stored));
  assert.ok(!auth.verifyPassword("site trailer ", stored));
  assert.ok(!auth.verifyPassword("anything", "not a hash"));
});

test("sign up validates its fields", () => {
  assert.throws(() => auth.createUser({ ...owner, name: " " }), /full name/);
  assert.throws(() => auth.createUser({ ...owner, email: "tolu" }), /valid email/);
  assert.throws(() => auth.createUser({ ...owner, password: "short" }), /at least 8/);
  assert.equal(auth.hasAccounts(), false);
});

test("the first account owns the workspace and closes sign up", () => {
  const user = auth.createUser(owner);
  assert.equal(user.role, "owner");
  assert.equal(user.email, "tolu@example.com");
  assert.ok(!JSON.stringify(auth.toPublic(user)).includes("scrypt"));
  assert.equal(auth.signupOpen(), false);
  assert.throws(() => auth.createUser({ ...owner, email: "second@example.com" }), (e: any) => e.status === 403);
});

test("open sign up adds members and refuses a taken email", () => {
  process.env.MUSTER_OPEN_SIGNUP = "true";
  try {
    assert.throws(() => auth.createUser(owner), (e: any) => e.status === 409);
    assert.equal(auth.createUser({ ...owner, email: "crew@example.com" }).role, "member");
  } finally {
    delete process.env.MUSTER_OPEN_SIGNUP;
  }
});

test("sign in matches email in any case and rejects a wrong password the same way as an unknown email", () => {
  assert.equal(auth.authenticate("TOLU@example.com", owner.password).name, owner.name);
  const wrong = (() => { try { auth.authenticate(owner.email, "nope nope"); } catch (e: any) { return e; } })();
  const unknown = (() => { try { auth.authenticate("nobody@example.com", owner.password); } catch (e: any) { return e; } })();
  assert.equal(wrong.status, 401);
  assert.equal(wrong.message, unknown.message);
});

test("sessions resolve until they expire or end", () => {
  const user = auth.authenticate(owner.email, owner.password);
  const now = Date.now();
  const short = auth.startSession(user.id, false, now);
  assert.equal(short.persistent, false);
  assert.equal(auth.userForToken(short.token, now)?.id, user.id);
  assert.equal(auth.userForToken(short.token, now + short.maxAge + 1), null);
  assert.equal(auth.userForToken("forged", now), null);

  const long = auth.startSession(user.id, true, now);
  auth.endSession(long.token);
  assert.equal(auth.userForToken(long.token, now), null);
  const stored = fs.readFileSync(path.join(dir, "sessions.json"), "utf8");
  assert.ok(!stored.includes(short.token));
});

test("a reset link sets a new password once and signs out every session", () => {
  const user = auth.authenticate(owner.email, owner.password);
  const session = auth.startSession(user.id, true);
  const { token } = auth.createResetToken("tolu@EXAMPLE.com");
  assert.throws(() => auth.resetPassword(token, "short"), /at least 8/);
  auth.resetPassword(token, "new password here");
  assert.equal(auth.userForToken(session.token), null);
  assert.ok(auth.authenticate(owner.email, "new password here"));
  assert.throws(() => auth.resetPassword(token, "another password"), /expired or was already used/);
  assert.throws(() => auth.createResetToken("nobody@example.com"), (e: any) => e.status === 404);
});

test("five failed sign ins lock the key for the window", () => {
  const limiter = new auth.AttemptLimiter(5, 60_000);
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.retryAfter("k", 1000), 0);
    limiter.fail("k", 1000);
  }
  assert.equal(limiter.retryAfter("k", 1000), 60);
  assert.equal(limiter.retryAfter("k", 61_001), 0);
  limiter.fail("k", 61_001);
  limiter.clear("k");
  assert.equal(limiter.retryAfter("k", 61_001), 0);
});

test("cookies are read by exact name", () => {
  assert.equal(auth.readCookie("a=1; muster_session=abc%3D; muster_session_x=2", "muster_session"), "abc=");
  assert.equal(auth.readCookie(undefined, "muster_session"), undefined);
});

test("a new account is confirmed only when the server can send email", () => {
  process.env.MUSTER_OPEN_SIGNUP = "true";
  try {
    const open = auth.createUser({ name: "Mail Off", email: "off@example.com", password: "longenough" });
    assert.equal(open.emailVerified, true);
    assert.equal(open.onboardedAt, null);
  } finally {
    delete process.env.MUSTER_OPEN_SIGNUP;
  }
});

test("a confirmation link confirms once, then is spent", () => {
  process.env.MUSTER_OPEN_SIGNUP = "true";
  try {
    const user = auth.createUser({ name: "Needs Mail", email: "needs@example.com", password: "longenough" }, { requireVerification: true });
    assert.equal(user.emailVerified, false);
    const token = auth.createVerifyToken(user.id);
    assert.equal(auth.verifyEmail(token).emailVerified, true);
    assert.throws(() => auth.verifyEmail(token), /expired or was already used/);
    assert.throws(() => auth.verifyEmail("forged"), (e: any) => e.status === 400);
  } finally {
    delete process.env.MUSTER_OPEN_SIGNUP;
  }
});

test("setup is recorded once", () => {
  const user = auth.authenticate("off@example.com", "longenough");
  const first = auth.markOnboarded(user.id);
  assert.ok(first?.onboardedAt);
  assert.equal(auth.markOnboarded(user.id)?.onboardedAt, first?.onboardedAt);
  assert.equal(auth.toPublic(auth.userById(user.id)!).onboarded, true);
});
