import { test } from "node:test";
import assert from "node:assert/strict";
import { parseServiceAccount } from "../src/sheets/google";

const key = { client_email: "muster@project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" };

test("plain JSON is read as it stands", () => {
  const sa = parseServiceAccount(JSON.stringify(key));
  assert.equal(sa.client_email, key.client_email);
  assert.ok(sa.private_key.includes("\n"));
});

test("base64 is decoded first", () => {
  const sa = parseServiceAccount(Buffer.from(JSON.stringify(key)).toString("base64"));
  assert.equal(sa.client_email, key.client_email);
});

// Pasting JSON into a dashboard commonly escapes the newlines inside the key.
test("escaped newlines in the private key are turned back", () => {
  // What a dashboard hands back after someone pastes the JSON into a text box.
  const pasted = JSON.stringify({ ...key, private_key: "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----" });
  const sa = parseServiceAccount(pasted);
  assert.ok(sa.private_key.startsWith("-----BEGIN PRIVATE KEY-----\n"));
  assert.ok(!sa.private_key.includes("\\n"));
});

test("anything else is refused by name", () => {
  assert.throws(() => parseServiceAccount("not json", "MY_KEY"), /MY_KEY is not valid JSON/);
  assert.throws(() => parseServiceAccount('{"client_email":"a@b.c"}', "MY_KEY"), /MY_KEY is not a service account key/);
});
