import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, mailConfigured, mailProvider, parseFrom } from "../src/mail";

function withEnv(env: Record<string, string | undefined>, body: () => void) {
  const keys = ["MUSTER_MAIL_FROM", "MUSTER_BREVO_KEY", "MUSTER_RESEND_KEY"];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    body();
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k]!;
    }
  }
}

test("a sender is read whether or not it carries a name", () => {
  assert.deepEqual(parseFrom("Muster <hello@example.com>"), { name: "Muster", email: "hello@example.com" });
  assert.deepEqual(parseFrom('"Muster Calls" <hi@example.com>'), { name: "Muster Calls", email: "hi@example.com" });
  assert.deepEqual(parseFrom("hello@example.com"), { name: "Muster", email: "hello@example.com" });
});

test("sending stays off until a key and a sender are both set", () => {
  withEnv({}, () => assert.equal(mailConfigured(), false));
  withEnv({ MUSTER_BREVO_KEY: "k" }, () => assert.equal(mailConfigured(), false));
  withEnv({ MUSTER_MAIL_FROM: "Muster <a@b.com>" }, () => assert.equal(mailConfigured(), false));
  withEnv({ MUSTER_MAIL_FROM: "Muster <a@b.com>", MUSTER_RESEND_KEY: "k" }, () => assert.equal(mailConfigured(), true));
});

// Brevo delivers to anybody once one sender address is verified, which is what
// a public sign up needs, so it is preferred when both are present.
test("Brevo wins when both providers are configured", () => {
  withEnv({ MUSTER_MAIL_FROM: "Muster <a@b.com>", MUSTER_BREVO_KEY: "b", MUSTER_RESEND_KEY: "r" }, () => {
    assert.equal(mailProvider(), "brevo");
  });
  withEnv({ MUSTER_MAIL_FROM: "Muster <a@b.com>", MUSTER_RESEND_KEY: "r" }, () => {
    assert.equal(mailProvider(), "resend");
  });
});

test("each provider is asked in its own shape", () => {
  const message = { to: "foreman@example.com", subject: "Confirm your email", text: "link", html: "<p>link</p>" };

  const brevo = buildRequest("brevo", message, "Muster <hello@example.com>", "brevo-key");
  assert.equal(brevo.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal((brevo.init.headers as Record<string, string>)["api-key"], "brevo-key");
  const brevoBody = JSON.parse(brevo.init.body as string);
  assert.deepEqual(brevoBody.sender, { name: "Muster", email: "hello@example.com" });
  assert.deepEqual(brevoBody.to, [{ email: "foreman@example.com" }]);
  assert.equal(brevoBody.textContent, "link");
  assert.equal(brevoBody.htmlContent, "<p>link</p>");

  const resend = buildRequest("resend", message, "Muster <hello@example.com>", "resend-key");
  assert.equal(resend.url, "https://api.resend.com/emails");
  assert.equal((resend.init.headers as Record<string, string>).Authorization, "Bearer resend-key");
  const resendBody = JSON.parse(resend.init.body as string);
  assert.equal(resendBody.from, "Muster <hello@example.com>");
  assert.deepEqual(resendBody.to, ["foreman@example.com"]);
});
