/**
 * Places a round of check-in calls, one foreman at a time.
 *
 * Calls run in sequence rather than in parallel: a trial Twilio account allows
 * one number, and a superintendent reading results live wants them to arrive in
 * order. A round skips anyone already checked in and anyone who has used their
 * attempts, and stops placing calls once calling hours end.
 */

import Twilio from "twilio";
import type { Project } from "../domain/types";
import { localMoment, withinHours } from "../domain/zoned";
import { getCheckIn, saveCheckIn } from "../store";
import type { Settings } from "../settings";
import { recordDial, usageNow } from "../usage";
import { currentWorkspaceId } from "../workspace-context";
import { publicBase } from "../public-url";

const FINAL = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

export interface RoundOptions {
  project: Project;
  schedule: Settings["schedule"];
  phone: Settings["phone"];
  /** Limit the round to one booking, ignoring attempts and status. */
  onlyActivityId?: string;
  log?: (line: string) => void;
  shouldStop?: () => boolean;
}

export interface RoundResult {
  called: number;
  reached: number;
  remaining: number;
  stoppedReason: string | null;
  /** True when the plan limit stopped the round, not the plan or the clock. */
  limitReached: boolean;
}

/**
 * Places one call. Ring time and voicemail detection are extras that a Twilio
 * trial account refuses outright, so a refusal falls back to a plain call rather
 * than losing the check-in.
 */
async function place(
  twilio: ReturnType<typeof Twilio>,
  core: { to: string; from: string; url: string },
  phone: Settings["phone"],
  log: (line: string) => void,
) {
  const extras: Record<string, unknown> = { timeout: phone.ringSeconds };
  if (phone.voicemail) extras.machineDetection = "Enable";
  try {
    return await twilio.calls.create({ ...core, ...extras });
  } catch (e: any) {
    if (e?.code !== 21216 && !/disallowed parameter/i.test(e?.message ?? "")) throw e;
    log("This Twilio account refuses ring time and voicemail settings, so the call was placed without them. A paid account accepts both.");
    return twilio.calls.create(core);
  }
}

export async function runRound(opts: RoundOptions): Promise<RoundResult> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  const base = publicBase();
  for (const [k, v] of Object.entries({ TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, MUSTER_PUBLIC_URL: base })) {
    if (!v) throw new Error(`Missing ${k} in .env`);
  }
  const log = opts.log ?? console.log;
  const twilio = Twilio(TWILIO_ACCOUNT_SID!, TWILIO_AUTH_TOKEN!);
  const { project, schedule, phone } = opts;
  const from = phone.useOwnNumber && phone.number ? phone.number : TWILIO_PHONE_NUMBER!;
  const result: RoundResult = { called: 0, reached: 0, remaining: 0, stoppedReason: null, limitReached: false };

  const due = project.activities.filter((a) => {
    if (opts.onlyActivityId) return a.id === opts.onlyActivityId;
    const c = getCheckIn(project, a.id);
    return c.status !== "complete" && c.status !== "unreachable" && c.attempts < schedule.maxAttempts;
  });

  // "0 called" on its own reads like a failure. Say which of the three reasons it is.
  if (due.length === 0) {
    const counts = project.activities.reduce(
      (acc, a) => {
        const c = getCheckIn(project, a.id);
        if (c.status === "complete") acc.done++;
        else if (c.status === "unreachable" || c.attempts >= schedule.maxAttempts) acc.spent++;
        return acc;
      },
      { done: 0, spent: 0 },
    );
    log(
      project.activities.length === 0
        ? `Nobody to call: nothing is booked for ${project.planDate}`
        : `Nobody due: ${counts.done} already checked in, ${counts.spent} out of attempts, of ${project.activities.length} booked`,
    );
  }

  for (const activity of due) {
    if (opts.shouldStop?.()) {
      result.stoppedReason = "stopped";
      break;
    }
    const now = localMoment(new Date(), project.timezone);
    if (!withinHours(now.time, schedule.callingHours.start, schedule.callingHours.end)) {
      result.stoppedReason = `outside calling hours (${now.time})`;
      break;
    }

    const usage = usageNow(project.timezone, project.contacts.length);
    if (usage.blocked) {
      result.stoppedReason = usage.blocked;
      result.limitReached = true;
      break;
    }

    const contact = project.contacts.find((c) => c.id === activity.contactId);
    if (!contact) continue;
    const to = process.env.MUSTER_PHONE_OVERRIDE || contact.phone;

    log(`Calling ${contact.foreman} (${contact.company})`);
    result.called++;
    const callsBefore = getCheckIn(project, activity.id).callIds.length;
    let status: string;
    let end: CallEnd = { status: "failed", seconds: 0 };
    try {
      recordDial();
      const url = `${base}/twilio/outbound?activity=${encodeURIComponent(activity.id)}&date=${project.planDate}&ws=${encodeURIComponent(currentWorkspaceId())}`;
      const call = await place(twilio, { to, from, url }, phone, log);
      end = await waitForEnd(twilio, call.sid);
      status = end.status;
    } catch (e: any) {
      log(`${contact.company}: call could not be placed, ${e.message}`);
      status = "failed";
    }

    const after = getCheckIn(project, activity.id);
    const talked = after.callIds.length > callsBefore;
    const advice = diagnose(end, talked);
    if (advice) log(`${contact.company}: ${advice}`);
    if (talked && after.status === "complete") {
      result.reached++;
      log(`${contact.company}: checked in`);
      continue;
    }

    // A call placed by hand for one booking sits outside the retry budget of the evening round.
    if (opts.onlyActivityId) {
      log(`${contact.company}: ${status.replace("-", " ")}, not checked in`);
      continue;
    }

    // A session counts its own attempt when the audio connects; count the rest here.
    if (!talked) after.attempts += 1;
    if (after.attempts >= schedule.maxAttempts && after.status !== "complete") after.status = "unreachable";
    after.updatedAt = new Date().toISOString();
    saveCheckIn(project, after);
    log(`${contact.company}: ${status.replace("-", " ")}, attempt ${Math.min(after.attempts, schedule.maxAttempts)} of ${schedule.maxAttempts}`);
  }

  result.remaining = project.activities.filter((a) => {
    const c = getCheckIn(project, a.id);
    return c.status !== "complete" && c.status !== "unreachable";
  }).length;
  return result;
}

interface CallEnd {
  status: string;
  /** Seconds Twilio billed for, which is the time the line was actually open. */
  seconds: number;
}

async function waitForEnd(twilio: ReturnType<typeof Twilio>, sid: string): Promise<CallEnd> {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const call = await twilio.calls(sid).fetch();
    if (FINAL.has(call.status)) return { status: call.status, seconds: Number(call.duration ?? 0) };
  }
  return { status: "failed", seconds: 0 };
}

/**
 * Turns what Twilio reported into the next thing to try.
 *
 * A trial account announces itself before every call and asks for a keypress,
 * which eats the first seconds, so a call that ends inside about fifteen
 * seconds with nothing recorded never reached the conversation at all.
 */
function diagnose(end: CallEnd, talked: boolean): string | null {
  if (end.status === "busy") return "The line was busy. Muster will retry on your schedule.";
  if (end.status === "no-answer") return "Nobody picked up.";
  if (end.status === "canceled") return "The call was cancelled before it connected.";
  if (end.status === "failed") {
    return "Twilio could not place the call. Check the number is verified on a trial account, and that calls to that country are allowed under Voice geographic permissions.";
  }
  if (end.status === "completed" && !talked) {
    return end.seconds <= 15
      ? `The call connected for ${end.seconds} seconds and no words were exchanged. On a trial account the recorded announcement plays first, so this usually means it was hung up during that, or the audio stream never opened.`
      : `The call ran ${end.seconds} seconds but nothing was recorded, so the conversation did not reach the agent.`;
  }
  return null;
}
