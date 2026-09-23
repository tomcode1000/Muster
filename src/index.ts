/**
 * Muster server.
 *
 *   POST /twilio/outbound?activity=<id>   TwiML for a check-in call Muster placed
 *   WS   /twilio/stream                   Twilio media stream, bridged to the agent
 *   WS   /browser/stream?activity=<id>    Same check-in, spoken from a browser tab
 *   GET  /api/day                         Plan, check-ins and findings for the day
 *   GET  /api/calls/:callId               Transcript and tool calls for one call
 *   POST /api/auth/signup|signin|signout  Accounts; every app page and API needs a session
 *
 * Phone audio is G.711 mu-law at 8 kHz, which the Voice Agent API accepts as
 * audio/pcmu, so it passes through untouched. Browser audio is PCM16 at 24 kHz.
 */

import "dotenv-flow/config";
import * as path from "path";
import express from "express";
import ExpressWs from "express-ws";
import WebSocket from "ws";
import { CheckInSession, type AudioTransport } from "./agent/session";
import { evaluateDay } from "./domain/findings";
import { getCall, listCalls, listCheckIns } from "./store";
import { currentProject, lastSnapshot, refreshFromSheet, startSheetMirror, tomorrow } from "./source";
import { loadSettings, saveSettings, setupGaps, sheetIdFrom } from "./settings";
import { serviceAccountEmail } from "./sheets/google";
import { publicBase, publicHost } from "./public-url";
import { scheduleState, startRound, startScheduler, stopRound } from "./calls/scheduler";
import {
  addBooking,
  addContact,
  copyBookings,
  listBookings,
  listBookingsFrom,
  listBookingsUntil,
  listCrew,
  removeBooking,
  removeContact,
  updateBooking,
  updateContact,
  ValidationError,
} from "./workspace";
import { localMoment } from "./domain/zoned";
import { validateProfile } from "./agent/profile";
import { buildSession } from "./agent/checkin";
import { currentPlan, dailyUsage, PLANS, recordDial, usageNow } from "./usage";
import Twilio from "twilio";
import { getCheckIn, readState, writeState } from "./store";
import {
  AttemptLimiter,
  AuthError,
  authenticate,
  createUser,
  createVerifyToken,
  endSession,
  hasAccounts,
  isConfirmed,
  markOnboarded,
  readCookie,
  resetPassword,
  SESSION_COOKIE,
  signupOpen,
  startSession,
  toPublic,
  userForToken,
  verifyEmail,
  type User,
} from "./auth";
import { linkMessage, mailConfigured, sendMail } from "./mail";
import { flush, restore, snapshotConfigured } from "./snapshot";
import { startKeepAwake } from "./keep-awake";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const xml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const dateParam = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : undefined);

const { app } = ExpressWs(express());
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true })).use(express.json());

// ----------------------------------------------------------------------------
// Accounts
// ----------------------------------------------------------------------------

/** App screens that need a signed in user. The landing and auth pages stay public. */
const APP_PAGES = new Set([
  "/today.html",
  "/plan.html",
  "/crew.html",
  "/calls.html",
  "/talk.html",
  "/onboarding.html",
  "/settings.html",
  "/settings-project.html",
  "/settings-agent.html",
  "/settings-schedule.html",
  "/settings-source.html",
  "/settings-phone.html",
  "/usage.html",
  "/help.html",
]);
// Confirming happens from a link in an email, often on a phone that is not signed in.
/** Reached by Twilio or by the auth screens themselves, never with a user cookie. */
const PUBLIC_PATHS = [/^\/health$/, /^\/api\/auth\//, /^\/twilio\//];

const sessionUser = (req: express.Request): User | null => userForToken(readCookie(req.headers.cookie, SESSION_COOKIE));

app.use((req, res, next) => {
  if (PUBLIC_PATHS.some((p) => p.test(req.path))) return next();
  // The browser stream checks its own session, since a WebSocket upgrade cannot take a redirect.
  const needsUser = APP_PAGES.has(req.path) || req.path.startsWith("/api/");
  if (!needsUser) return next();
  const user = sessionUser(req);
  if (user) {
    res.locals.user = user;
    // An unconfirmed address may only reach the confirm screen and its own routes.
    if (!isConfirmed(user, mailConfigured()) && req.path !== "/verify.html") {
      if (req.path.startsWith("/api/")) return res.status(403).json({ error: "Confirm your email to continue.", needsVerification: true });
      return res.redirect("/verify.html");
    }
    return next();
  }
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in to continue." });
  const target = hasAccounts() ? "signin.html" : "signup.html";
  res.redirect(`/${target}?next=${encodeURIComponent(req.originalUrl)}`);
});

app.use(express.static(path.join(process.cwd(), "public")));

const signinLimiter = new AttemptLimiter();

function setSessionCookie(req: express.Request, res: express.Response, userId: string, remember: boolean) {
  const { token, maxAge, persistent } = startSession(userId, remember);
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    ...(persistent ? { maxAge } : {}),
  });
}

function authFailure(res: express.Response, e: unknown) {
  if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "Something went wrong. Try again." });
}

app.get("/api/auth/status", (req, res) => {
  const user = sessionUser(req);
  const publicUser = user ? { ...toPublic(user), emailVerified: isConfirmed(user, mailConfigured()) } : null;
  // Whether a new account will be asked to confirm, which the sign up page says
  // out loud and an operator can check without creating an account.
  res.json({ user: publicUser, hasAccounts: hasAccounts(), signupOpen: signupOpen(), emailConfirmation: mailConfigured() });
});

/** Where someone belongs after signing in: confirm, set up, or straight to work. */
function nextPageFor(user: User): string {
  if (!isConfirmed(user, mailConfigured())) return "verify.html";
  if (!user.onboardedAt || setupGaps(loadSettings()).length) return "onboarding.html";
  return "today.html";
}

/** Sends the confirmation link, or reports why it could not be sent. */
async function sendVerification(user: User, req: express.Request) {
  const token = createVerifyToken(user.id);
  const base = publicBase() || `${req.protocol}://${req.get("host")}`;
  const url = `${base}/verify.html?token=${token}`;
  const result = await sendMail({
    to: user.email,
    subject: "Confirm your email address",
    ...linkMessage({
      heading: "Confirm your email address",
      line: `Hello ${xml(user.name.split(/\s+/)[0])}, thank you for creating a Muster account. Confirm this address to finish setting it up.`,
      button: "Confirm my email",
      url,
      note: "Once confirmed you will be signed in, and Muster will walk you through your project, your crew and when calls should go out.",
      footer: "This link expires in 24 hours. If you did not create an account, no action is needed and nothing further will be sent.",
    }),
  });
  // A developer without a mail provider still needs a way in.
  if (!result.sent) console.log(`[auth] confirmation link for ${user.email}: ${url}`);
  return result;
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    if (req.body?.agree !== true) throw new AuthError("Agree to the terms to continue.");
    const user = createUser(req.body ?? {}, { requireVerification: mailConfigured() });
    setSessionCookie(req, res, user.id, true);
    // A new owner fills in the project; the owner's name is who foremen hear about.
    const settings = loadSettings();
    if (user.role === "owner" && !settings.project.superintendent) {
      saveSettings({ ...settings, project: { ...settings.project, superintendent: user.name.split(/\s+/)[0] } });
    }
    const mail = user.emailVerified ? { sent: false, reason: "verification is off on this server" } : await sendVerification(user, req);
    res.status(201).json({ user: toPublic(user), next: nextPageFor(user), mailSent: mail.sent });
  } catch (e) {
    authFailure(res, e);
  }
});

app.post("/api/auth/verify", (req, res) => {
  try {
    const user = verifyEmail(req.body?.token);
    // Confirming from the link signs that person in, as every product does.
    setSessionCookie(req, res, user.id, true);
    res.json({ user: toPublic(user), next: nextPageFor(user) });
  } catch (e) {
    authFailure(res, e);
  }
});

app.post("/api/auth/verify/resend", async (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to continue." });
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  const mail = await sendVerification(user, req);
  res.json({ ok: mail.sent, sent: mail.sent, reason: mail.reason ?? null, email: user.email });
});

/** Setup is walked through once. The finish step calls this. */
app.post("/api/auth/onboarded", (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to continue." });
  markOnboarded(user.id);
  res.json({ ok: true });
});

app.post("/api/auth/signin", (req, res) => {
  const key = `${String(req.body?.email ?? "").trim().toLowerCase()}|${req.ip}`;
  const wait = signinLimiter.retryAfter(key);
  if (wait) {
    res.set("Retry-After", String(wait));
    return res.status(429).json({ error: `Too many tries. Wait ${Math.ceil(wait / 60)} minutes and try again.` });
  }
  try {
    const user = authenticate(req.body?.email, req.body?.password);
    signinLimiter.clear(key);
    setSessionCookie(req, res, user.id, req.body?.remember !== false);
    res.json({ user: toPublic(user), next: nextPageFor(user) });
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) signinLimiter.fail(key);
    authFailure(res, e);
  }
});

app.post("/api/auth/signout", (req, res) => {
  endSession(readCookie(req.headers.cookie, SESSION_COOKIE));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.post("/api/auth/reset", (req, res) => {
  try {
    const user = resetPassword(req.body?.token, req.body?.password);
    // A new password lifts any lock from earlier failed tries.
    signinLimiter.clearPrefix(`${user.email}|`);
    res.json({ ok: true });
  } catch (e) {
    authFailure(res, e);
  }
});

if (!process.env.ASSEMBLYAI_API_KEY) {
  console.error("Missing ASSEMBLYAI_API_KEY");
  process.exit(1);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

function findBooking(activityId: unknown, date?: string) {
  if (setupGaps(loadSettings()).length) return null;
  let project;
  try {
    project = currentProject(date);
  } catch {
    return null;
  }
  const activity = project.activities.find((a) => a.id === String(activityId ?? ""));
  if (!activity) return null;
  const contact = project.contacts.find((c) => c.id === activity.contactId);
  if (!contact) return null;
  return { project, activity, contact };
}

/** Current usage against the plan, for the whole workspace. */
function usage() {
  const settings = loadSettings();
  const crewCount = settings.source === "sheet" ? lastSnapshot()?.project.contacts.length ?? 0 : listCrew().length;
  return usageNow(settings.project.timezone, crewCount);
}

/** Sends validation problems as 400s, anything else as 500s. */
function handle(res: express.Response, fn: () => unknown, status = 200) {
  try {
    res.status(status).json(fn() ?? { ok: true });
  } catch (e: any) {
    if (e instanceof ValidationError) res.status(400).json({ errors: e.errors });
    else {
      console.error(e);
      res.status(500).json({ errors: [e.message] });
    }
  }
}

// ----------------------------------------------------------------------------
// Day view
// ----------------------------------------------------------------------------

app.get("/api/day", (req, res) => {
  const settings = loadSettings();
  try {
    const project = currentProject(dateParam(req.query.date));
    const checkIns = listCheckIns(project);
    res.json({
      project,
      checkIns,
      findings: evaluateDay(project, checkIns),
      problems: settings.source === "sheet" ? lastSnapshot()?.problems ?? [] : [],
      source: settings.source,
      setupGaps: setupGaps(settings),
      tomorrow: tomorrow(settings.project.timezone),
      handled: handledFor(project.planDate),
    });
  } catch (e: any) {
    res.status(409).json({ error: e.message, source: settings.source, setupGaps: setupGaps(settings) });
  }
});

/** Findings the superintendent has dealt with, per plan date, so the morning list stays short. */
type Handled = Record<string, string[]>;
function handledFor(planDate: string): string[] {
  return (readState<Handled>("handled") ?? {})[planDate] ?? [];
}

app.post("/api/findings/handled", (req, res) => {
  const planDate = dateParam(req.body?.date);
  const key = typeof req.body?.key === "string" ? req.body.key.slice(0, 200) : "";
  if (!planDate || !key) return void res.status(400).json({ errors: ["date and key are required"] });
  const all = readState<Handled>("handled") ?? {};
  const set = new Set(all[planDate] ?? []);
  if (req.body?.handled === false) set.delete(key);
  else set.add(key);
  all[planDate] = [...set];
  writeState("handled", all);
  res.json({ handled: all[planDate] });
});

// ----------------------------------------------------------------------------
// Crew and bookings entered in the app
// ----------------------------------------------------------------------------

const today = () => localMoment(new Date(), loadSettings().project.timezone).date;

app.get("/api/crew", (_req, res) => handle(res, () => listCrew()));
app.post("/api/crew", (req, res) =>
  handle(res, () => {
    const u = usage();
    if (u.crew.limit !== null && u.crew.count >= u.crew.limit) {
      throw new ValidationError([`The ${u.plan.name} plan covers up to ${u.crew.limit} subcontractors. Upgrade to add more.`]);
    }
    return addContact(req.body);
  }, 201),
);

app.get("/api/usage", (_req, res) => handle(res, () => usage()));

/** Everything the Usage and limits page shows: meters, history and the plan table. */
app.get("/api/usage/detail", (_req, res) =>
  handle(res, () => {
    const timezone = loadSettings().project.timezone;
    return {
      ...usage(),
      history: dailyUsage(timezone, 14),
      source: loadSettings().source,
      plans: Object.values(PLANS),
      currentPlanId: currentPlan().id,
    };
  }),
);

// ----------------------------------------------------------------------------
// Notifications and search
// ----------------------------------------------------------------------------

interface Note {
  id: string;
  type: "checkin" | "problem" | "call_failed" | "round" | "limit";
  title: string;
  text: string;
  at: string;
}

const SEEN = "notifications-seen";
const CALL_ENDED: Record<string, string> = {
  hung_up: "hung up before finishing",
  time_limit: "ran past the time limit",
  usage_limit: "stopped at the plan limit",
  agent_disconnected: "dropped",
};

/** Built from what already happened: calls, findings, rounds and the plan. */
function notifications(): Note[] {
  const settings = loadSettings();
  const notes: Note[] = [];

  for (const call of listCalls(60)) {
    if (!call.endedAt) continue;
    const who = `${call.company} (${call.foreman})`;
    if (call.endReason === "finished") {
      notes.push({ id: `call_${call.callId}`, type: "checkin", title: "Check-in finished", text: `${who} completed their check-in.`, at: call.endedAt });
    } else if (call.endReason && CALL_ENDED[call.endReason]) {
      notes.push({ id: `call_${call.callId}`, type: "call_failed", title: "Call did not finish", text: `${who} ${CALL_ENDED[call.endReason]}.`, at: call.endedAt });
    }
  }

  try {
    const project = currentProject();
    const checkIns = listCheckIns(project);
    const handled = new Set(handledFor(project.planDate));
    for (const finding of evaluateDay(project, checkIns)) {
      const key = `${finding.code}:${finding.activityIds.join(",")}`;
      if (handled.has(key)) continue;
      const activity = project.activities.find((a) => finding.activityIds.includes(a.id));
      const contact = project.contacts.find((c) => c.id === activity?.contactId);
      const checkIn = checkIns.find((c) => c.activityId === activity?.id);
      notes.push({
        id: `finding_${key}`,
        type: "problem",
        title: "Problem found",
        text: `${contact?.company ?? "A subcontractor"}: ${finding.title}`,
        at: checkIn?.updatedAt ?? new Date().toISOString(),
      });
    }
  } catch {
    // No plan for tomorrow yet, so there is nothing to flag.
  }

  const rounds = scheduleState();
  for (const entry of rounds.log.slice(-40)) {
    if (!/finished:/.test(entry.line)) continue;
    notes.push({ id: `round_${entry.at}`, type: "round", title: "Calling round finished", text: entry.line, at: entry.at });
  }

  const now = usage();
  if (now.blocked) {
    notes.push({ id: `limit_${now.period.month}_blocked`, type: "limit", title: "Limit reached", text: now.blocked, at: new Date().toISOString() });
  } else if (now.minutes.limit && now.minutes.used / now.minutes.limit >= 0.8) {
    notes.push({
      id: `limit_${now.period.month}_near`,
      type: "limit",
      title: "Close to your limit",
      text: `${now.minutes.used} of ${now.minutes.limit} call minutes used this month. They reset on ${now.period.resetsOn}.`,
      at: new Date().toISOString(),
    });
  }

  void settings;
  return notes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}

app.get("/api/notifications", (_req, res) =>
  handle(res, () => {
    const user = res.locals.user as User;
    const seen = (readState<Record<string, string>>(SEEN) ?? {})[user.id] ?? "";
    const items = notifications();
    return { items, unread: items.filter((n) => n.at > seen).length, seenAt: seen || null };
  }),
);

app.post("/api/notifications/seen", (_req, res) =>
  handle(res, () => {
    const user = res.locals.user as User;
    const all = readState<Record<string, string>>(SEEN) ?? {};
    all[user.id] = new Date().toISOString();
    writeState(SEEN, all);
    return { ok: true, seenAt: all[user.id] };
  }),
);

/** One search across crew, upcoming bookings and calls. */
app.get("/api/search", (req, res) =>
  handle(res, () => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2) return { query: q, crew: [], bookings: [], calls: [], counts: { crew: 0, bookings: 0, calls: 0 } };
    const settings = loadSettings();
    const today = localMoment(new Date(), settings.project.timezone).date;
    const has = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase().includes(q);

    const crewList = settings.source === "sheet" ? lastSnapshot()?.project.contacts ?? [] : listCrew();
    const crew = crewList.filter((c) => has(c.company, c.foreman, c.trade, c.phone));

    const bookings = (settings.source === "sheet" ? [] : listBookingsFrom(today))
      .map((b) => ({ booking: b, contact: crewList.find((c) => c.id === b.contactId) }))
      .filter(({ booking, contact }) => has(booking.description, booking.area, contact?.company, contact?.foreman));

    const calls = listCalls(200).filter((c) => has(c.company, c.foreman, c.work));

    return {
      query: q,
      crew: crew.slice(0, 8).map((c) => ({ id: c.id, company: c.company, foreman: c.foreman, trade: c.trade, language: c.language })),
      bookings: bookings.slice(0, 8).map(({ booking, contact }) => ({
        id: booking.id,
        date: booking.date,
        start: booking.start,
        description: booking.description,
        area: booking.area,
        company: contact?.company ?? "",
      })),
      calls: calls.slice(0, 8).map((c) => ({ id: c.callId, company: c.company, foreman: c.foreman, work: c.work, startedAt: c.startedAt })),
      counts: { crew: crew.length, bookings: bookings.length, calls: calls.length },
    };
  }),
);

/**
 * The crew list with what matters about each subcontractor on a given day:
 * bookings that day, bookings still to come, and the latest check-in result.
 */
app.get("/api/crew/overview", (req, res) =>
  handle(res, () => {
    const settings = loadSettings();
    const tz = settings.project.timezone;
    const todayDate = localMoment(new Date(), tz).date;
    const date = dateParam(req.query.date) ?? tomorrow(tz);

    if (settings.source === "sheet") {
      const project = currentProject();
      return {
        date: project.planDate,
        source: "sheet",
        crew: project.contacts.map((contact) => {
          const mine = project.activities.filter((a) => a.contactId === contact.id);
          const latest = mine.map((a) => getCheckIn(project, a.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          return { contact, onDate: mine.length, upcoming: mine.length, lastCheckIn: latest ?? null, lastDate: latest ? project.planDate : null };
        }),
      };
    }

    const project = currentProject(date);
    const from = listBookingsFrom(todayDate);
    const past = listBookingsUntil(date);
    return {
      date,
      source: "app",
      crew: listCrew().map((contact) => {
        const onDate = from.filter((b) => b.contactId === contact.id && b.date === date).length;
        const upcoming = from.filter((b) => b.contactId === contact.id).length;
        let lastCheckIn = null;
        let lastDate = null;
        for (const b of past.filter((x) => x.contactId === contact.id)) {
          const ci = getCheckIn({ ...project, planDate: b.date, activities: [b] }, b.id);
          if (ci.status !== "pending" || ci.attempts > 0) {
            lastCheckIn = ci;
            lastDate = b.date;
            break;
          }
        }
        return { contact, onDate, upcoming, lastCheckIn, lastDate };
      }),
    };
  }),
);
app.put("/api/crew/:id", (req, res) => handle(res, () => updateContact(String(req.params.id), req.body)));
app.delete("/api/crew/:id", (req, res) => handle(res, () => removeContact(String(req.params.id), today())));

app.get("/api/bookings", (req, res) => {
  const date = dateParam(req.query.date) ?? tomorrow(loadSettings().project.timezone);
  handle(res, () => ({ date, bookings: listBookings(date) }));
});
app.post("/api/bookings", (req, res) => handle(res, () => addBooking(req.body), 201));
app.put("/api/bookings/:id", (req, res) => handle(res, () => updateBooking(String(req.params.id), req.body)));
app.delete("/api/bookings/:id", (req, res) => handle(res, () => removeBooking(String(req.params.id))));
app.post("/api/bookings/copy", (req, res) =>
  handle(res, () => ({ copied: copyBookings(String(req.body?.from ?? ""), String(req.body?.to ?? "")) })),
);

app.get("/api/calls", (_req, res) => {
  res.json(
    listCalls().map((c) => ({
      callId: c.callId,
      activityId: c.activityId,
      planDate: c.planDate,
      company: c.company,
      foreman: c.foreman,
      work: c.work,
      channel: c.channel,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      endReason: c.endReason,
      turns: c.turns.length,
    })),
  );
});

app.get("/api/calls/:callId", (req, res) => {
  const call = getCall(String(req.params.callId));
  if (!call) return void res.status(404).json({ error: "not found" });
  res.json(call);
});

// ----------------------------------------------------------------------------
// Settings, sheet and schedule
// ----------------------------------------------------------------------------

app.get("/api/settings", (_req, res) => {
  const snap = lastSnapshot();
  res.json({
    settings: loadSettings(),
    serviceAccount: serviceAccountEmail(),
    sheet: snap ? { readAt: snap.readAt, bookings: snap.project.activities.length, problems: snap.problems } : null,
    // The number this server calls from, so the Phone page can say what foremen see.
    twilioNumber: process.env.TWILIO_PHONE_NUMBER || null,
    // Where Help sends people who are stuck. Unset means this server has no support route.
    supportEmail: process.env.MUSTER_SUPPORT_EMAIL || null,
  });
});

app.put("/api/settings", (req, res) => {
  const { settings, errors } = saveSettings(req.body);
  if (errors.length) return void res.status(400).json({ errors });
  res.json({ settings });
});

/**
 * Exactly what the agent will be given for one booking, using the saved profile
 * or a draft sent from the settings form, so nothing about the prompt is hidden.
 */
app.post("/api/agent/preview", (req, res) => {
  const settings = loadSettings();
  const draft = validateProfile(req.body?.agent ?? settings.agent);
  if (draft.errors.length) return void res.status(400).json({ errors: draft.errors });

  let project;
  try {
    project = currentProject(dateParam(req.body?.date));
  } catch (e: any) {
    return void res.status(409).json({ errors: [e.message] });
  }
  if (!project.name || !project.superintendent) {
    return void res.status(400).json({ errors: ["Add the project name and superintendent first"] });
  }
  const activity = project.activities.find((a) => a.id === req.body?.activityId) ?? project.activities[0];
  if (!activity) return void res.status(404).json({ errors: ["Add a booking for tomorrow to preview the prompt"] });
  const contact = project.contacts.find((c) => c.id === activity.contactId);
  if (!contact) return void res.status(404).json({ errors: ["That booking's subcontractor is not on the crew list"] });
  const session = buildSession(project, activity, contact, "audio/pcm", draft.profile);

  res.json({
    activityId: activity.id,
    bookings: project.activities.map((a) => ({
      id: a.id,
      label: `${a.start} ${project.contacts.find((c) => c.id === a.contactId)?.company ?? ""}`,
    })),
    greeting: session.greeting,
    systemPrompt: session.system_prompt,
    keyterms: session.input.keyterms,
    tools: session.tools.map((t: any) => t.name),
  });
});

app.post("/api/sheet/refresh", async (_req, res) => {
  if (!sheetIdFrom(loadSettings())) {
    return void res.status(400).json({ error: "Choose From a Google Sheet, add the link and save settings first" });
  }
  try {
    const snap = await refreshFromSheet();
    res.json({ bookings: snap.project.activities.length, planDate: snap.project.planDate, problems: snap.problems });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/phone/test", async (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  const base = publicBase();
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return res.status(400).json({ error: "Twilio is not set up on this server. Add the Twilio keys to .env." });
  }
  if (!base) return res.status(400).json({ error: "MUSTER_PUBLIC_URL is not set to this server's https address, so Twilio cannot reach it." });

  const settings = loadSettings();
  const to = String(req.body?.to ?? "").replace(/[^\d+]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(to)) return res.status(400).json({ error: "Enter the number to call, with its country code." });

  const from = settings.phone.useOwnNumber && settings.phone.number ? settings.phone.number : TWILIO_PHONE_NUMBER;
  try {
    const call = await Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).calls.create({
      to,
      from,
      url: `${base}/twilio/test`,
    });
    // A test call is a real call, so it counts like any other.
    recordDial();
    res.json({ ok: true, sid: call.sid, from });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Twilio refused the call." });
  }
});

app.get("/api/rounds", (_req, res) => res.json(scheduleState()));

app.post("/api/rounds/run", (req, res) => {
  const onlyActivityId = typeof req.body?.activityId === "string" ? req.body.activityId : undefined;
  const gaps = setupGaps(loadSettings());
  if (gaps.length) return void res.status(400).json({ errors: [`Add the ${gaps.join(" and ")} in Settings first`] });
  if (scheduleState().running) return void res.status(409).json({ errors: ["A round is already running"] });
  const blocked = usage().blocked;
  if (blocked) return void res.status(429).json({ errors: [blocked] });
  startRound({
    refresh: !onlyActivityId,
    reason: onlyActivityId ? "Single call" : "Manual round",
    onlyActivityId,
    date: dateParam(req.body?.date),
  }).catch(() => {});
  res.status(202).json({ ok: true });
});

app.post("/api/rounds/stop", (_req, res) => {
  stopRound();
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Phone
// ----------------------------------------------------------------------------

app.post("/twilio/outbound", (req, res) => {
  const host = publicHost();
  const gaps = setupGaps(loadSettings());
  const booking = findBooking(req.query.activity, dateParam(req.query.date));

  /** Why this call cannot go ahead, in words a person on the phone can act on. */
  const refusal = (): string | null => {
    if (!host) return "This server does not know its own address yet, so it cannot carry the call.";
    if (gaps.length) return `Setup is not finished. Add the ${gaps.join(" and ")} in Muster, then try again.`;
    if (!booking) return "That booking could not be found. It may have been changed or removed since the call was placed.";
    const blocked = usage().blocked;
    return blocked ? `This call cannot run. ${blocked}` : null;
  };

  const why = refusal();
  if (why || !booking) {
    console.error(`[twilio] outbound refused: ${why}`);
    res.type("text/xml").send(
      `<Response><Say voice="Polly.Joanna">Sorry, this is Muster. ${xml(why ?? "This call cannot run.")}</Say><Hangup/></Response>`,
    );
    return;
  }
  const answeredBy = String(req.body?.AnsweredBy ?? "");
  if (answeredBy.startsWith("machine")) {
    const { phone } = loadSettings();
    console.log(`[twilio] answering machine for ${booking.contact.company}`);
    res.type("text/xml").send(
      phone.voicemail
        ? `<Response><Pause length="2"/><Say voice="Polly.Joanna">${xml(phone.voicemailMessage)}</Say><Hangup/></Response>`
        : `<Response><Hangup/></Response>`,
    );
    return;
  }

  console.log(`[twilio] call answered for ${booking.contact.company}`);
  res.type("text/xml").send(
    `<Response><Connect><Stream url="wss://${host}/twilio/stream"><Parameter name="activity" value="${booking.activity.id}" /><Parameter name="date" value="${booking.project.planDate}" /></Stream></Connect></Response>`,
  );
});

app.post("/twilio/test", (_req, res) => {
  const { project, agent } = loadSettings();
  const line = `This is a test call from ${agent.name || "Muster"}${project.name ? `, for ${project.name}` : ""}. Your phone line is working. Goodbye.`;
  res.type("text/xml").send(`<Response><Say voice="Polly.Joanna">${xml(line)}</Say><Hangup/></Response>`);
});

app.ws("/twilio/stream", (ws) => {
  let session: CheckInSession | null = null;
  let streamSid = "";
  let markSeq = 0;
  const marks = new Map<string, () => void>();

  const transport: AudioTransport = {
    sendAudio: (payload) => send({ event: "media", streamSid, media: { payload } }),
    clear: () => send({ event: "clear", streamSid }),
    drain: () =>
      new Promise<void>((resolve) => {
        const name = `drain_${++markSeq}`;
        marks.set(name, resolve);
        send({ event: "mark", streamSid, mark: { name } });
        setTimeout(resolve, 10_000);
      }),
    close: () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };

  function send(msg: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case "start": {
        streamSid = msg.start.streamSid;
        const booking = findBooking(msg.start.customParameters?.activity, dateParam(msg.start.customParameters?.date));
        if (!booking) {
          console.error("[twilio] stream started for an unknown activity");
          ws.close();
          return;
        }
        const u = usage();
        if (u.blocked) {
          console.error(`[twilio] call refused: ${u.blocked}`);
          ws.close();
          return;
        }
        session = new CheckInSession(booking.project, booking.activity, booking.contact, transport, "audio/pcmu", "phone");
        session.start(u.minutes.remainingSeconds);
        break;
      }
      case "media":
        if (msg.media?.track === "inbound") session?.pushAudio(msg.media.payload);
        break;
      case "mark": {
        const done = marks.get(msg.mark?.name);
        if (done) {
          marks.delete(msg.mark.name);
          done();
        }
        break;
      }
      case "stop":
        session?.end("hung_up");
        break;
    }
  });

  ws.on("close", () => session?.end("hung_up"));
});

// ----------------------------------------------------------------------------
// Browser
// ----------------------------------------------------------------------------

app.ws("/browser/stream", (ws, req) => {
  if (!sessionUser(req)) {
    ws.close(4401, "sign in required");
    return;
  }
  const booking = findBooking(req.query.activity, dateParam(req.query.date));
  if (!booking) {
    ws.close(4004, "unknown activity");
    return;
  }

  let drainSeq = 0;
  const drains = new Map<number, () => void>();
  const send = (msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const transport: AudioTransport = {
    sendAudio: (audio) => send({ type: "audio", audio }),
    clear: () => send({ type: "clear" }),
    drain: () =>
      new Promise<void>((resolve) => {
        const id = ++drainSeq;
        drains.set(id, resolve);
        send({ type: "drain", id });
        setTimeout(resolve, 10_000);
      }),
    close: () => {
      send({ type: "ended" });
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };

  const u = usage();
  if (u.blocked) {
    send({ type: "limit", message: u.blocked });
    ws.close(4029, "usage limit");
    return;
  }
  const session = new CheckInSession(booking.project, booking.activity, booking.contact, transport, "audio/pcm", "browser");
  send({ type: "call", callId: session.callId });
  session.start(u.minutes.remainingSeconds);

  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "audio" && typeof msg.audio === "string") session.pushAudio(msg.audio);
    else if (msg.type === "drained") {
      const done = drains.get(msg.id);
      if (done) {
        drains.delete(msg.id);
        done();
      }
    } else if (msg.type === "hangup") session.end("hung_up");
  });

  ws.on("close", () => session.end("hung_up"));
});

const port = Number(process.env.PORT || 3000);

/**
 * Nothing reads the data directory until the mirror has been restored, so a
 * host that wipes its filesystem comes back with the accounts and calls intact.
 */
async function start() {
  if (snapshotConfigured()) {
    const result = await restore();
    console.log(
      result.restored
        ? `Restored ${result.files} files from the saved copy`
        : `Using the local data directory: ${result.reason}`,
    );
  }

  startSheetMirror();
  startScheduler();

  const awake = startKeepAwake();
  if (awake.started) console.log(`Keeping this instance awake by calling ${publicBase()}/health every few minutes`);

  app.listen(port, () => {
    console.log(`Muster running on http://localhost:${port}`);
    // Phone calls fail silently when this is stale, so state it at every start.
    console.log(
      publicBase()
        ? `Phone calls will send Twilio to: ${publicBase()}`
        : "Phone calls are off: MUSTER_PUBLIC_URL is not set to this server's https address",
    );
    console.log(`Talk page: http://localhost:${port}/talk.html`);
    if (!snapshotConfigured()) {
      console.log("Data is kept on this machine only. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to survive a host with no disk.");
    }
  });
}

// A host stopping the process is the common case, so write pending changes out.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void flush().finally(() => process.exit(0));
  });
}

start().catch((e) => {
  console.error(`Muster could not start: ${e.message}`);
  process.exit(1);
});
