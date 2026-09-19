/**
 * Sending email.
 *
 * Muster sends two kinds of message today: verify your address, and reset your
 * password. It talks to Resend over HTTPS, so there is no mail library to
 * install and no SMTP server to run.
 *
 * With no key set, sending is off. Nothing pretends to have been sent: the
 * server logs the link instead, and the app says verification is off.
 */

const API = "https://api.resend.com/emails";

export function mailConfigured(): boolean {
  return Boolean(process.env.MUSTER_RESEND_KEY && process.env.MUSTER_MAIL_FROM);
}

export interface Message {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(message: Message): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured()) return { sent: false, reason: "no mail provider is configured on this server" };
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MUSTER_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MUSTER_MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[mail] ${res.status} ${body.slice(0, 200)}`);
      return { sent: false, reason: `the mail provider refused the message (${res.status})` };
    }
    return { sent: true };
  } catch (e: any) {
    console.error(`[mail] ${e.message}`);
    return { sent: false, reason: "the mail provider could not be reached" };
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
