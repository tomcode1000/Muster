/**
 * Minimal Google Sheets client, authenticated as a service account.
 *
 * The service account signs a JWT with its private key and trades it for an
 * access token, which is cached until shortly before it expires. Only the two
 * calls Muster needs are implemented: read a range, write a range.
 */

import * as crypto from "crypto";
import * as fs from "fs";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

let cached: { token: string; expiresAt: number } | null = null;

/**
 * Reads a service account key, however it was supplied.
 *
 * A deployment has no filesystem to keep a key file on, so the key travels as
 * an environment variable instead: either the JSON itself or base64 of it.
 * Pasting JSON into a dashboard usually turns the newlines inside the private
 * key into a literal backslash and n, so those are turned back.
 */
export function parseServiceAccount(raw: string, source = "the service account key"): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(text) as ServiceAccount;
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  if (!sa.client_email || !sa.private_key) throw new Error(`${source} is not a service account key`);
  return { ...sa, private_key: sa.private_key.replace(/\\n/g, "\n") };
}

function serviceAccount(): ServiceAccount {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (inline) return parseServiceAccount(inline, "GOOGLE_SERVICE_ACCOUNT_JSON");

  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!file) throw new Error("No Google key: set GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_FILE when running from a machine with the file");
  return parseServiceAccount(fs.readFileSync(file, "utf8"), file);
}

export function serviceAccountEmail(): string | null {
  try {
    return serviceAccount().client_email;
  } catch {
    return null;
  }
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const sa = serviceAccount();
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`Google sign-in failed: ${body.error_description || body.error || res.status}`);
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function call(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 403) {
      throw new Error(`${message}. Share the sheet with ${serviceAccountEmail()} as Editor.`);
    }
    throw new Error(message);
  }
  return body;
}

export async function readRange(sheetId: string, range: string): Promise<string[][]> {
  const body = await call(`${API}/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  return (body.values ?? []) as string[][];
}

export async function writeRange(sheetId: string, range: string, values: (string | number)[][]): Promise<void> {
  await call(`${API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

export async function sheetTitles(sheetId: string): Promise<string[]> {
  const body = await call(`${API}/${sheetId}?fields=sheets.properties.title`);
  return (body.sheets ?? []).map((s: any) => s.properties.title);
}

export async function addSheet(sheetId: string, title: string): Promise<void> {
  await call(`${API}/${sheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

/** Pulls the id out of a full Google Sheets link, or accepts a bare id. */
export function parseSheetId(input: string): string | null {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(input) || /^([a-zA-Z0-9_-]{20,})$/.exec(input.trim());
  return m ? m[1] : null;
}
