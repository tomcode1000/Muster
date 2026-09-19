import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muster-ws-"));
process.env.MUSTER_DATA_DIR = dir;

// Imported after the data directory is set, so nothing touches real data.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ws = require("../src/workspace") as typeof import("../src/workspace");

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const concrete = { company: "Gulf Coast Concrete", trade: "Concrete", foreman: "Luis Ortega", phone: "+1 305 555 0101", language: "es" };

let contactId = "";
before(() => {
  contactId = ws.addContact(concrete).id;
});

test("crew members are validated and phones normalised", () => {
  const c = ws.listCrew().find((x) => x.id === contactId)!;
  assert.equal(c.phone, "+13055550101");
  assert.equal(c.language, "es");

  assert.throws(() => ws.addContact({ company: "", trade: "", foreman: "", phone: "123" }), (e: any) => {
    assert.equal(e.errors.length, 4);
    return true;
  });
  assert.throws(() => ws.addContact({ ...concrete, company: "gulf coast concrete" }), /already on the crew list/);
});

test("bookings are validated against the crew and the clock", () => {
  const good = {
    date: "2026-09-15",
    contactId,
    description: "Slab pour",
    area: "Level 1",
    start: "6:30am",
    end: "1pm",
    crewNeeded: 8,
    exclusiveArea: true,
    requirements: "Pump truck booked; Pre-pour inspection passed; Pump truck booked",
    materials: ["concrete"],
  };
  const b = ws.addBooking(good);
  assert.equal(b.start, "06:30");
  assert.equal(b.end, "13:00");
  assert.deepEqual(b.requirements.map((r) => r.id), ["pump-truck-booked", "pre-pour-inspection-passed"]);

  assert.throws(() => ws.addBooking({ ...good, contactId: "nobody" }), /crew list/);
  assert.throws(() => ws.addBooking({ ...good, end: "06:00" }), /Finish must be after start/);
  assert.throws(() => ws.addBooking({ ...good, crewNeeded: 0 }), /Crew needed/);
});

test("a crew member with upcoming bookings cannot be removed", () => {
  assert.throws(() => ws.removeContact(contactId, "2026-09-14"), /upcoming booking/);
  // Past bookings do not block removal.
  assert.doesNotThrow(() => ws.listBookings("2026-09-15"));
});

test("copying a day skips bookings already on the target date", () => {
  assert.equal(ws.copyBookings("2026-09-15", "2026-09-16"), 1);
  assert.equal(ws.copyBookings("2026-09-15", "2026-09-16"), 0);
  const copied = ws.listBookings("2026-09-16");
  assert.equal(copied.length, 1);
  assert.notEqual(copied[0].id, ws.listBookings("2026-09-15")[0].id);
});

test("editing a booking keeps its id and creation time", () => {
  const [b] = ws.listBookings("2026-09-16");
  const updated = ws.updateBooking(b.id, { ...b, crewNeeded: 6, requirements: [] });
  assert.equal(updated.id, b.id);
  assert.equal(updated.createdAt, b.createdAt);
  assert.equal(updated.crewNeeded, 6);
});
