import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muster-snap-"));
process.env.MUSTER_DATA_DIR = dir;
process.env.MUSTER_SNAPSHOT_DEBOUNCE_MS = "10";

// Imported after the data directory is set, so nothing touches real data.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snapshot = require("../src/snapshot") as typeof import("../src/snapshot");

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (relative: string, body: string) => {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

test("sending is off until both keys are set", () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal(snapshot.snapshotConfigured(), false);
  process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
  assert.equal(snapshot.snapshotConfigured(), false);
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  assert.equal(snapshot.snapshotConfigured(), true);
});

test("packing walks the whole directory and skips half written files", () => {
  write("settings.json", '{"a":1}');
  write("checkins/main/2026-09-20/bk_1.json", '{"status":"complete"}');
  write("calls/call_1.json.4321.tmp", "half written");
  const packed = snapshot.pack(dir);
  assert.deepEqual(Object.keys(packed.files).sort(), ["checkins/main/2026-09-20/bk_1.json", "settings.json"]);
  assert.equal(packed.files["settings.json"], '{"a":1}');
});

test("unpacking rebuilds the tree and refuses a key that climbs out", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "muster-snap-out-"));
  try {
    const written = snapshot.unpack(
      { savedAt: new Date().toISOString(), files: { "users.json": "[]", "nested/deep/file.json": "{}", "../escape.json": "no" } },
      target,
    );
    assert.equal(written, 2);
    assert.equal(fs.readFileSync(path.join(target, "nested/deep/file.json"), "utf8"), "{}");
    assert.equal(fs.existsSync(path.join(path.dirname(target), "escape.json")), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("a wiped directory is restored from the key value store", async () => {
  // A stand in for Upstash: one key, spoken to over the same REST shape.
  let stored: string | null = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const [command, , value] = JSON.parse(body);
      if (command === "SET") stored = value;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result: command === "GET" ? stored : "OK" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";

  try {
    write("users.json", '[{"email":"tolu@example.com"}]');
    const saved = await snapshot.save();
    assert.equal(saved.saved, true);

    // The host wipes the filesystem, as a free instance does on every deploy.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const result = await snapshot.restore();
    assert.equal(result.restored, true);
    assert.equal(fs.readFileSync(path.join(dir, "users.json"), "utf8"), '[{"email":"tolu@example.com"}]');

    // A directory that already has files is never overwritten by the mirror.
    const second = await snapshot.restore();
    assert.equal(second.restored, false);
  } finally {
    server.close();
  }
});
