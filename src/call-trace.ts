/**
 * How far a call got.
 *
 * A phone that rings and goes quiet has three quite different causes, and they
 * need different fixes:
 *
 *   Twilio never asked for instructions   the number rang but the webhook was
 *                                         never fetched: a wrong address, a
 *                                         blocked region, or a trial refusing
 *   instructions given, no audio stream   Twilio had the TwiML but could not
 *                                         open the media socket
 *   stream opened, nothing said           the agent never spoke or never heard
 *
 * Twilio identifies a call the same way at every step, so the steps are
 * recorded against that id and read back when the call ends.
 */

export type Stage = "twiml" | "stream";

interface Trace {
  twiml?: number;
  stream?: number;
}

const traces = new Map<string, Trace>();
const KEEP_MS = 30 * 60_000;

/**
 * When a media socket last reached this server at all, named or not.
 *
 * Twilio identifies a call in its first frame, so a socket that opens and says
 * nothing leaves no trace against a call id. Knowing one arrived still
 * separates "Twilio never got here" from "Twilio got here and gave up".
 */
let lastSocket = 0;

export function markSocketOpened() {
  lastSocket = Date.now();
}

export function socketOpenedSince(at: number): boolean {
  return lastSocket >= at;
}

export function markCall(sid: string | undefined, stage: Stage) {
  if (!sid) return;
  const trace = traces.get(sid) ?? {};
  trace[stage] = Date.now();
  traces.set(sid, trace);
  prune();
}

export function callReached(sid: string): { twiml: boolean; stream: boolean } {
  const trace = traces.get(sid) ?? {};
  return { twiml: Boolean(trace.twiml), stream: Boolean(trace.stream) };
}

function prune() {
  if (traces.size < 200) return;
  const cutoff = Date.now() - KEEP_MS;
  for (const [sid, trace] of traces) {
    if (Math.max(trace.twiml ?? 0, trace.stream ?? 0) < cutoff) traces.delete(sid);
  }
}
