/**
 * Accounts and sessions.
 *
 * Passwords are hashed with scrypt and a per-user salt. A session is a random
 * token held in an HttpOnly cookie; only its SHA-256 hash is stored, so a copy
 * of the data folder cannot be replayed as a login.
 *
 * Every account shares the one workspace. The first sign up creates the owner
 * and closes sign up, unless MUSTER_OPEN_SIGNUP is true.
 */

import * as crypto from "crypto";
import { readState, writeState } from "./store";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "owner" | "member";
  createdAt: string;
  /** False until the address is confirmed. True from the start when this server cannot send email. */
  emailVerified: boolean;
  /** When the person finished setup, so they are only walked through it once. */
  onboardedAt: string | null;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: User["role"];
  emailVerified: boolean;
  onboarded: boolean;
}

interface Session {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface ResetToken {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

/** A link sent to an address to prove the person reads it. */
interface VerifyToken {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const SESSION_COOKIE = "muster_session";
export const MIN_PASSWORD = 8;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_MS = 12 * 60 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const VERIFY_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Accounts made before verification existed are treated as already confirmed. */
const users = (): User[] =>
  (readState<User[]>("users") ?? []).map((u) => ({ ...u, emailVerified: u.emailVerified !== false, onboardedAt: u.onboardedAt ?? null }));
const sessions = () => readState<Session[]>("sessions") ?? [];
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const normalizeEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

export const toPublic = (u: User): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  emailVerified: u.emailVerified,
  onboarded: Boolean(u.onboardedAt),
});

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** A hash to compare against when the email is unknown, so timing does not reveal which emails exist. */
const DECOY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));

export function hasAccounts(): boolean {
  return users().length > 0;
}

/** Reads a setting a person typed by hand, so True, YES and 1 all mean yes. */
export function isOn(value: string | undefined): boolean {
  return ["true", "yes", "on", "1"].includes(String(value ?? "").trim().toLowerCase());
}

export function signupOpen(): boolean {
  return !hasAccounts() || isOn(process.env.MUSTER_OPEN_SIGNUP);
}

function checkPassword(password: unknown): string {
  const p = typeof password === "string" ? password : "";
  if (p.length < MIN_PASSWORD) throw new AuthError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  if (p.length > 200) throw new AuthError("Use a password of at most 200 characters.");
  return p;
}

export function createUser(input: { name?: unknown; email?: unknown; password?: unknown }, options: { requireVerification?: boolean } = {}): User {
  const name = String(input.name ?? "").trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new AuthError("Enter your full name.");
  if (name.length > 80) throw new AuthError("Use a name of at most 80 characters.");
  if (!EMAIL.test(email) || email.length > 254) throw new AuthError("Enter a valid email address.");
  const password = checkPassword(input.password);
  if (!signupOpen()) throw new AuthError("This workspace already has an owner. Ask them to sign you in.", 403);

  const all = users();
  if (all.some((u) => u.email === email)) throw new AuthError("An account with this email already exists. Sign in instead.", 409);
  const user: User = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    role: all.length ? "member" : "owner",
    createdAt: new Date().toISOString(),
    // Without a mail provider there is no way to confirm an address, so the
    // account starts confirmed rather than stranding the person on a dead screen.
    emailVerified: options.requireVerification !== true,
    onboardedAt: null,
  };
  writeState("users", [...all, user]);
  return user;
}

/** Records that this person has been through setup, so they are not sent again. */
export function markOnboarded(userId: string): User | null {
  const all = users();
  const user = all.find((u) => u.id === userId);
  if (!user || user.onboardedAt) return user ?? null;
  user.onboardedAt = new Date().toISOString();
  writeState("users", all);
  return user;
}

/** A link that proves the address exists, valid for a day. */
export function createVerifyToken(userId: string, now = Date.now()): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const pending = (readState<VerifyToken[]>("email-verifications") ?? []).filter((v) => Date.parse(v.expiresAt) > now && v.userId !== userId);
  pending.push({ tokenHash: sha256(token), userId, expiresAt: new Date(now + VERIFY_MS).toISOString() });
  writeState("email-verifications", pending);
  return token;
}

export function verifyEmail(token: unknown, now = Date.now()): User {
  const hash = sha256(String(token ?? ""));
  const pending = readState<VerifyToken[]>("email-verifications") ?? [];
  const entry = pending.find((v) => v.tokenHash === hash && Date.parse(v.expiresAt) > now);
  if (!entry) throw new AuthError("This confirmation link has expired or was already used. Ask for a new one.", 400);

  const all = users();
  const user = all.find((u) => u.id === entry.userId);
  if (!user) throw new AuthError("This account no longer exists.", 404);
  user.emailVerified = true;
  writeState("users", all);
  writeState("email-verifications", pending.filter((v) => v !== entry));
  return user;
}

export function userById(id: string): User | null {
  return users().find((u) => u.id === id) ?? null;
}

/**
 * Whether this account may use the app.
 *
 * A server that cannot send a confirmation link has no business demanding one:
 * the person would wait for a message that can never arrive. So when sending is
 * off, every account counts as confirmed, including one that signed up while
 * sending was on and never got its link.
 */
export function isConfirmed(user: User, canSendMail: boolean): boolean {
  return user.emailVerified || !canSendMail;
}

export function authenticate(emailInput: unknown, password: unknown): User {
  const email = normalizeEmail(emailInput);
  const user = users().find((u) => u.email === email);
  const ok = verifyPassword(typeof password === "string" ? password : "", user?.passwordHash ?? DECOY_HASH);
  if (!user || !ok) throw new AuthError("That email and password do not match an account.", 401);
  return user;
}

/** Starts a session and returns the raw token for the cookie, plus its lifetime. */
export function startSession(userId: string, remember: boolean, now = Date.now()) {
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAge = remember ? REMEMBER_MS : SHORT_MS;
  const live = sessions().filter((s) => Date.parse(s.expiresAt) > now);
  live.push({
    tokenHash: sha256(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAge).toISOString(),
  });
  writeState("sessions", live);
  return { token, maxAge, persistent: remember };
}

export function userForToken(token: string | undefined, now = Date.now()): User | null {
  if (!token) return null;
  const hash = sha256(token);
  const session = sessions().find((s) => s.tokenHash === hash);
  if (!session || Date.parse(session.expiresAt) <= now) return null;
  return users().find((u) => u.id === session.userId) ?? null;
}

export function endSession(token: string | undefined) {
  if (!token) return;
  const hash = sha256(token);
  writeState("sessions", sessions().filter((s) => s.tokenHash !== hash));
}

/** Creates a one-time password reset token for an account, valid for 30 minutes. */
export function createResetToken(emailInput: string, now = Date.now()): { token: string; user: User } {
  const email = normalizeEmail(emailInput);
  const user = users().find((u) => u.email === email);
  if (!user) throw new AuthError(`No account uses ${email}.`, 404);
  const token = crypto.randomBytes(32).toString("base64url");
  const pending = (readState<ResetToken[]>("password-resets") ?? []).filter((r) => Date.parse(r.expiresAt) > now && r.userId !== user.id);
  pending.push({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(now + RESET_MS).toISOString() });
  writeState("password-resets", pending);
  return { token, user };
}

/** Sets a new password from a reset token, and signs the account out everywhere. */
export function resetPassword(token: unknown, password: unknown, now = Date.now()): User {
  const hash = sha256(String(token ?? ""));
  const pending = readState<ResetToken[]>("password-resets") ?? [];
  const entry = pending.find((r) => r.tokenHash === hash && Date.parse(r.expiresAt) > now);
  if (!entry) throw new AuthError("This reset link has expired or was already used. Ask for a new one.", 400);
  const next = checkPassword(password);

  const all = users();
  const user = all.find((u) => u.id === entry.userId);
  if (!user) throw new AuthError("This account no longer exists.", 404);
  user.passwordHash = hashPassword(next);
  writeState("users", all);
  writeState("password-resets", pending.filter((r) => r !== entry));
  writeState("sessions", sessions().filter((s) => s.userId !== user.id));
  return user;
}

/** Counts failed sign ins per email and address; five in 15 minutes locks further tries. */
export class AttemptLimiter {
  private failures = new Map<string, number[]>();
  constructor(private readonly max = 5, private readonly windowMs = 15 * 60 * 1000) {}

  private recent(key: string, now: number) {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  /** Seconds until another try is allowed, or 0. */
  retryAfter(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    return list.length < this.max ? 0 : Math.ceil((list[0] + this.windowMs - now) / 1000);
  }

  fail(key: string, now = Date.now()) {
    this.recent(key, now).push(now);
  }

  clear(key: string) {
    this.failures.delete(key);
  }

  /** Clears every key that starts with the prefix, such as all addresses for one email. */
  clearPrefix(prefix: string) {
    for (const key of [...this.failures.keys()]) if (key.startsWith(prefix)) this.failures.delete(key);
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
