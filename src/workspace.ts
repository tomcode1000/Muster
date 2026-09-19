/**
 * Crew and bookings entered in the app.
 *
 * Crew is the standing list of subcontractors and their foremen. Bookings say
 * who works where on a given date. Every write is validated here, so the rest
 * of Muster can trust what it reads.
 */

import * as crypto from "crypto";
import type { Activity, Contact } from "./domain/types";
import { normalizeClock, toMinutes } from "./domain/time";
import { normalizePhone } from "./sheets/roster";
import { readState, writeState } from "./store";

export interface Booking extends Activity {
  date: string;
  createdAt: string;
  updatedAt: string;
}

interface Workspace {
  crew: Contact[];
  bookings: Booking[];
}

const FILE = "workspace";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(". "));
  }
}

function load(): Workspace {
  return readState<Workspace>(FILE) ?? { crew: [], bookings: [] };
}

function save(ws: Workspace) {
  writeState(FILE, ws);
}

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ----------------------------------------------------------------------------
// Crew
// ----------------------------------------------------------------------------

export function listCrew(): Contact[] {
  return load().crew.sort((a, b) => a.company.localeCompare(b.company));
}

function validateContact(input: any, existing: Contact[], id: string): Contact {
  const errors: string[] = [];
  const company = str(input?.company);
  const foreman = str(input?.foreman);
  const trade = str(input?.trade);
  const phone = normalizePhone(str(input?.phone, 40));
  const language = input?.language === "es" ? "es" : input?.language === "en" || input?.language === undefined ? "en" : null;

  if (!company) errors.push("Company is required");
  if (!foreman) errors.push("Foreman name is required");
  if (!trade) errors.push("Trade is required");
  if (!phone) errors.push("Phone must be a full number with country code, like +1 305 555 0101");
  if (!language) errors.push("Language must be English or Spanish");
  if (company && existing.some((c) => c.id !== id && c.company.toLowerCase() === company.toLowerCase())) {
    errors.push(`${company} is already on the crew list`);
  }
  if (errors.length) throw new ValidationError(errors);
  return { id, company, foreman, trade, phone: phone!, language: language! };
}

export function addContact(input: unknown): Contact {
  const ws = load();
  const contact = validateContact(input, ws.crew, newId("crew"));
  ws.crew.push(contact);
  save(ws);
  return contact;
}

export function updateContact(id: string, input: unknown): Contact {
  const ws = load();
  const i = ws.crew.findIndex((c) => c.id === id);
  if (i < 0) throw new ValidationError(["Crew member not found"]);
  const contact = validateContact(input, ws.crew, id);
  ws.crew[i] = contact;
  save(ws);
  return contact;
}

export function removeContact(id: string, today: string) {
  const ws = load();
  const upcoming = ws.bookings.filter((b) => b.contactId === id && b.date >= today);
  if (upcoming.length) {
    throw new ValidationError([`Remove their ${upcoming.length} upcoming ${upcoming.length === 1 ? "booking" : "bookings"} first`]);
  }
  ws.crew = ws.crew.filter((c) => c.id !== id);
  save(ws);
}

// ----------------------------------------------------------------------------
// Bookings
// ----------------------------------------------------------------------------

/** Every booking on or after a date, soonest first. */
export function listBookingsFrom(date: string): Booking[] {
  return load()
    .bookings.filter((b) => b.date >= date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** Every booking on or before a date, most recent first. */
export function listBookingsUntil(date: string): Booking[] {
  return load()
    .bookings.filter((b) => b.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
}

export function listBookings(date: string): Booking[] {
  return load()
    .bookings.filter((b) => b.date === date)
    .sort((a, b) => a.start.localeCompare(b.start) || a.area.localeCompare(b.area));
}

function splitList(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[;\n,]/) : [];
  return [...new Set(items.map((s) => str(s, 120)).filter(Boolean))].slice(0, 12);
}

function slug(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-") || "item";
}

function validateBooking(input: any, ws: Workspace, id: string, existing?: Booking): Booking {
  const errors: string[] = [];
  const date = str(input?.date, 10);
  const contactId = str(input?.contactId, 40);
  const start = normalizeClock(input?.start);
  const end = normalizeClock(input?.end);
  const crewNeeded = Number(input?.crewNeeded);
  const area = str(input?.area);
  const description = str(input?.description);

  if (!DATE.test(date)) errors.push("Date is required");
  if (!ws.crew.some((c) => c.id === contactId)) errors.push("Choose a subcontractor from the crew list");
  if (!description) errors.push("Describe the work");
  if (!area) errors.push("Area is required");
  if (!start) errors.push("Start time is required");
  if (!end) errors.push("Finish time is required");
  if (start && end && toMinutes(end) <= toMinutes(start)) errors.push("Finish must be after start");
  if (!Number.isInteger(crewNeeded) || crewNeeded < 1 || crewNeeded > 500) errors.push("Crew needed must be a whole number from 1");
  if (errors.length) throw new ValidationError(errors);

  const now = new Date().toISOString();
  return {
    id,
    date,
    contactId,
    description,
    area,
    start: start!,
    end: end!,
    crewNeeded,
    exclusiveArea: input?.exclusiveArea === true,
    requirements: splitList(input?.requirements).map((label) => ({ id: slug(label), label })),
    materials: splitList(input?.materials),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function addBooking(input: unknown): Booking {
  const ws = load();
  const booking = validateBooking(input, ws, newId("bk"));
  ws.bookings.push(booking);
  save(ws);
  return booking;
}

export function updateBooking(id: string, input: unknown): Booking {
  const ws = load();
  const i = ws.bookings.findIndex((b) => b.id === id);
  if (i < 0) throw new ValidationError(["Booking not found"]);
  const booking = validateBooking(input, ws, id, ws.bookings[i]);
  ws.bookings[i] = booking;
  save(ws);
  return booking;
}

export function removeBooking(id: string) {
  const ws = load();
  ws.bookings = ws.bookings.filter((b) => b.id !== id);
  save(ws);
}

/** Copies one date's bookings onto another, skipping any already there. */
export function copyBookings(from: string, to: string): number {
  if (!DATE.test(from) || !DATE.test(to)) throw new ValidationError(["Both dates are required"]);
  if (from === to) throw new ValidationError(["Pick a different date to copy from"]);
  const ws = load();
  const target = ws.bookings.filter((b) => b.date === to);
  const key = (b: Booking) => `${b.contactId}|${b.area.toLowerCase()}|${b.start}`;
  const taken = new Set(target.map(key));
  const now = new Date().toISOString();
  let copied = 0;
  for (const b of ws.bookings.filter((x) => x.date === from)) {
    if (taken.has(key(b))) continue;
    ws.bookings.push({ ...b, id: newId("bk"), date: to, createdAt: now, updatedAt: now });
    copied++;
  }
  save(ws);
  return copied;
}
