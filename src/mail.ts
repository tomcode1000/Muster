/**
 * Sending email.
 *
 * Muster sends two kinds of message today: confirm your address, and reset your
 * password. Both go out over HTTPS, so there is no mail library to install and
 * no SMTP server to run.
 *
 * Two providers, because their free tiers differ in the way that matters:
 *
 *   Brevo    verifies one sender address, a plain Gmail address is fine, and
 *            then delivers to anybody. That is what a public sign up needs.
 *   Resend   needs a domain you own before it will deliver to anyone except
 *            the address that owns the account.
 *
 * Whichever key is set is used, Brevo first. With neither, sending is off:
 * nothing pretends to have been sent, the server logs the link instead, and an
 * account is not held back waiting for a message that cannot arrive.
 */

export type Provider = "brevo" | "resend";

export interface Message {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function mailProvider(): Provider | null {
  if (!process.env.MUSTER_MAIL_FROM) return null;
  if (process.env.MUSTER_BREVO_KEY) return "brevo";
  if (process.env.MUSTER_RESEND_KEY) return "resend";
  return null;
}

export function mailConfigured(): boolean {
  return mailProvider() !== null;
}

/** Reads `Muster <hello@example.com>` into its two parts. A bare address works too. */
export function parseFrom(value: string): { name: string; email: string } {
  const match = value.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "") || "Muster", email: match[2].trim() };
  return { name: "Muster", email: value.trim() };
}

/** The HTTP call for one provider, kept separate from sending so it can be checked. */
export function buildRequest(provider: Provider, message: Message, from: string, key: string): { url: string; init: RequestInit } {
  const sender = parseFrom(from);
  if (provider === "brevo") {
    return {
      url: "https://api.brevo.com/v3/smtp/email",
      init: {
        method: "POST",
        headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          ...(message.html ? { htmlContent: message.html } : {}),
        }),
      },
    };
  }
  return {
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    },
  };
}

export async function sendMail(message: Message): Promise<{ sent: boolean; provider?: Provider; reason?: string }> {
  const provider = mailProvider();
  if (!provider) return { sent: false, reason: "no mail provider is configured on this server" };

  const key = (provider === "brevo" ? process.env.MUSTER_BREVO_KEY : process.env.MUSTER_RESEND_KEY)!;
  const { url, init } = buildRequest(provider, message, process.env.MUSTER_MAIL_FROM!, key);

  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[mail] ${provider} answered ${res.status}: ${body.slice(0, 200)}`);
      return { sent: false, provider, reason: `the mail provider refused the message (${res.status})` };
    }
    return { sent: true, provider };
  } catch (e: any) {
    console.error(`[mail] ${provider}: ${e.message}`);
    return { sent: false, provider, reason: "the mail provider could not be reached" };
  }
}

/**
 * One link message, in both forms an inbox may show.
 *
 * Built with table layout and inline styles, because that is what mail clients
 * render reliably: Outlook ignores flexbox and grid, and Gmail strips a style
 * block. The plain text version is written to stand on its own, since some
 * people read mail with images and HTML off.
 */
export function linkMessage(opts: {
  heading: string;
  line: string;
  button: string;
  url: string;
  footer: string;
  /** Optional closing note, such as what happens after the link is used. */
  note?: string;
}): Pick<Message, "text" | "html"> {
  const text = [
    "MUSTER",
    "",
    opts.heading,
    "",
    opts.line,
    "",
    opts.url,
    "",
    ...(opts.note ? [opts.note, ""] : []),
    opts.footer,
    "",
    "Muster. Evening check-in calls to every subcontractor booked for tomorrow.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f7fc">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fc;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e8ebf3;border-radius:16px">
        <tr><td style="padding:28px 32px 0">
          <div style="font:700 19px/1 ui-sans-serif,system-ui,'Segoe UI',sans-serif;letter-spacing:-0.02em;color:#0e1733">Muster</div>
        </td></tr>
        <tr><td style="padding:22px 32px 0">
          <h1 style="margin:0;font:700 21px/1.3 ui-sans-serif,system-ui,'Segoe UI',sans-serif;letter-spacing:-0.02em;color:#0e1733">${opts.heading}</h1>
          <p style="margin:12px 0 0;font:400 14px/1.65 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#4a5268">${opts.line}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 0">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:10px;background:#1f6bff">
              <a href="${opts.url}" style="display:inline-block;padding:13px 26px;font:600 14px/1 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#ffffff;text-decoration:none">${opts.button}</a>
            </td>
          </tr></table>
        </td></tr>
        ${opts.note ? `<tr><td style="padding:22px 32px 0">
          <p style="margin:0;font:400 13px/1.65 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#4a5268">${opts.note}</p>
        </td></tr>` : ""}
        <tr><td style="padding:22px 32px 0">
          <p style="margin:0;font:400 12px/1.6 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#8a90a2">${opts.footer}</p>
          <p style="margin:8px 0 0;font:400 12px/1.6 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#8a90a2">If the button does not work, copy this address into your browser:</p>
          <p style="margin:4px 0 0;font:400 12px/1.6 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#2f5bea;word-break:break-all">${opts.url}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 28px">
          <div style="border-top:1px solid #eef0f6;padding-top:16px">
            <p style="margin:0;font:400 11.5px/1.6 ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#9aa1b4">Muster calls every subcontractor foreman booked for tomorrow and turns their answers into a ranked plan for the morning.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { text, html };
}
