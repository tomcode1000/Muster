/**
 * Keeping a sleeping host awake.
 *
 * A free instance sleeps after about fifteen minutes with no traffic, and a
 * sleeping process places no calls: the evening round is a timer inside it. The
 * cure is traffic, so the server asks for its own health endpoint on a timer.
 *
 * This only covers the case where the service is already running. It cannot
 * wake a process that is already asleep, so an outside monitor is still the
 * belt to this pair of braces. Both together cost nothing.
 *
 * Off unless MUSTER_KEEP_AWAKE is on, because a machine that never sleeps does
 * not need it, and the request would be pure noise in the log.
 */

import { isOn } from "./auth";
import { publicBase } from "./public-url";

const MINUTES = Number(process.env.MUSTER_KEEP_AWAKE_MINUTES || 10);

export function keepAwakeConfigured(): boolean {
  return isOn(process.env.MUSTER_KEEP_AWAKE) && Boolean(publicBase());
}

export function startKeepAwake(): { started: boolean; reason?: string } {
  if (!isOn(process.env.MUSTER_KEEP_AWAKE)) return { started: false, reason: "MUSTER_KEEP_AWAKE is off" };
  const base = publicBase();
  if (!base) return { started: false, reason: "no public address to call" };

  const every = Math.max(1, MINUTES) * 60_000;
  const timer = setInterval(() => {
    fetch(`${base}/health`, { headers: { "User-Agent": "muster-keep-awake" } }).catch((e) => {
      // Worth one line: a host that cannot reach itself is usually about to stop.
      console.error(`[keep-awake] ${e.message}`);
    });
  }, every);
  // A heartbeat must never be the reason the process refuses to exit.
  timer.unref?.();

  return { started: true };
}
