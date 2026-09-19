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

/** The plain and styled versions of one link message, kept together so they cannot drift. */
export function linkMessage(opts: { heading: string; line: string; button: string; url: string; footer: string }): Pick<Message, "text" | "html"> {
  return {
    text: `${opts.heading}\n\n${opts.line}\n\n${opts.url}\n\n${opts.footer}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#121a33">
  <div style="font-size:19px;font-weight:700;color:#0e1733;margin-bottom:18px">Muster</div>
  <h1 style="margin:0 0 12px;font-size:20px;color:#0e1733">${opts.heading}</h1>
  <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#4a5268">${opts.line}</p>
  <a href="${opts.url}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#1f6bff;color:#fff;font-size:14px;font-weight:600;text-decoration:none">${opts.button}</a>
  <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a90a2">${opts.footer}</p>
  <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#8a90a2;word-break:break-all">${opts.url}</p>
</div>`,
  };
}
