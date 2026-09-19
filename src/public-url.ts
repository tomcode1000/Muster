/**
 * The address the outside world reaches this server on.
 *
 * Twilio opens an audio stream back to us, and sheet links have to survive
 * being clicked from someone else's machine, so both need a real public URL
 * rather than whatever the process thinks its own host is.
 *
 * Read MUSTER_PUBLIC_URL first. HOSTNAME still works for a local tunnel, but
 * container platforms set HOSTNAME themselves, to the instance id, so a value
 * that is not a URL is treated as absent rather than sent to Twilio.
 */

export function publicBase(): string {
  const candidate = (process.env.MUSTER_PUBLIC_URL || process.env.HOSTNAME || "").trim();
  const trimmed = candidate.replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

/** The same address without its scheme, for comparing against a request host. */
export function publicHost(): string {
  return publicBase().replace(/^https?:\/\//i, "");
}
