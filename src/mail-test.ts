/**
 * Sends one test message, so a mail setup can be checked without creating an account.
 *
 *   npm run mail-test -- you@yourcompany.com
 */

import "dotenv-flow/config";
import { linkMessage, mailConfigured, sendMail } from "./mail";

const to = process.argv[2];
if (!to) {
  console.error("Usage: npm run mail-test -- you@yourcompany.com");
  process.exit(1);
}

if (!mailConfigured()) {
  console.error("Sending is off. Add MUSTER_RESEND_KEY and MUSTER_MAIL_FROM to .env, then try again.");
  process.exit(1);
}

const base = (process.env.HOSTNAME || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");

sendMail({
  to,
  subject: "Muster test message",
  ...linkMessage({
    heading: "Muster can send email",
    line: "This is a test message. If it reached you, confirmation links and password resets will too.",
    button: "Open Muster",
    url: base,
    footer: `Sent from ${process.env.MUSTER_MAIL_FROM}.`,
  }),
}).then((result) => {
  if (result.sent) {
    console.log(`Sent to ${to}. Check the inbox, and the spam folder if it is not there.`);
    process.exit(0);
  }
  console.error(`Not sent: ${result.reason}`);
  process.exit(1);
});
