/** Clock times on a plan day, "HH:MM" in 24 hour form. */

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(clock: string): number {
  const m = CLOCK.exec(clock.trim());
  if (!m) throw new Error(`Not a clock time: "${clock}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Accepts what a model tends to produce from speech, "7", "7:30", "07:30",
 * "7:30 am", "3pm", and returns "HH:MM", or null when it cannot be read.
 */
export function normalizeClock(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const s = String(input).trim().toLowerCase().replace(/\./g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function formatClock(clock: string): string {
  const total = toMinutes(clock);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}
