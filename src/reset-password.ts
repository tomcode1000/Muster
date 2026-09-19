/**
 * Prints a one-time password reset link for an account.
 *
 *   npm run reset-password -- you@company.com
 *
 * Muster sends no email, so whoever runs the server hands the link over.
 */

import "dotenv-flow/config";
import { AuthError, createResetToken } from "./auth";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run reset-password -- you@company.com");
  process.exit(1);
}

try {
  const { token, user } = createResetToken(email);
  const base = (process.env.HOSTNAME || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
  console.log(`Reset link for ${user.name} (${user.email}), valid for 30 minutes:`);
  console.log(`${base}/signin.html?reset=${token}`);
} catch (e) {
  console.error(e instanceof AuthError ? e.message : e);
  process.exit(1);
}
