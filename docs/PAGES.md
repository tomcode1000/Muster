# Muster: pages and screens

## What the product does

A superintendent runs a construction project with many subcontractors. Every evening, Muster phones each foreman booked for tomorrow, in English or Spanish. It confirms crew size, arrival time, prerequisites (pump truck booked, inspection passed), deliveries and blockers. By morning the superintendent sees tomorrow's plan, with every problem ranked and backed by the foreman's own words.

**Who uses it**
- **Superintendent:** on a laptop in the site trailer in the evening, and on a phone on site in the morning. Busy, not technical, reads in glances.
- **Foreman:** only ever hears a phone call, or taps one link. Never logs in.

**Design principles**
1. **The morning answer comes first.** The most important screen answers "what will go wrong tomorrow" in under five seconds.
2. **Evidence, not claims.** Every problem shows the foreman's quote and a link to the call.
3. **Phone first for daytime screens** (Today, Call detail). Laptop first for setup screens (Crew, Plan, Settings).
4. **Plain site language.** "Not coming", "3 of 8 crew", "Pump truck not confirmed". Not "anomaly detected".
5. **One icon set:** SVG, one stroke weight, colour inherited from text. No emoji.
6. **No dashes in interface copy.** Use commas, full stops or colons.
7. **Severity colours only mean severity:** critical, high, medium, low, confirmed. Never used for decoration.

## Navigation

**Main navigation**, in this order:
- **Today**
- **Plan**
- **Crew**
- **Calls**
- **Settings**

**Top bar:**
- **Project switcher**
- **Try a check-in** (a secondary action)
- **Account menu**

**Phone:** a bottom tab bar with Today, Plan, Crew and Calls. Settings lives in the account menu.

---

## 1. Sign in
- **Purpose:** get into the account.
- **Content:** product name, one line on what Muster does, email field, "Send sign-in link" button.
- **States:**
  - default
  - link sent ("Check your email")
  - link expired
  - error

## 2. Onboarding
- **Purpose:** from nothing to a first call, in three steps. Shown once, and can be resumed.
- **Step 1, Project:** project name, your name (foremen will hear it), time zone.
- **Step 2, Crew and bookings:** choose **Enter in Muster** or **Connect a Google Sheet**.
  - The sheet option shows the account email to share the sheet with, a "Check connection" button, and the result.
- **Step 3, Calls:** evening call time, days of the week, calling hours.
- **Finish:** a "Try a check-in yourself" call to action, plus "Go to Today".
- **Details:** a progress indicator. Back and Next buttons on each step.

## 3. Today (home)
**Purpose:** the morning view of tomorrow's (or today's) plan and what needs action.

**Header:**
- the date, with previous and next day controls
- a one line summary: "12 booked, 9 confirmed, 3 need attention"

**Needs attention list**, ranked by severity. Each card shows:
- a severity marker and a title ("Gulf Coast Concrete is bringing 3 of 8")
- one line of detail ("Slab pour, Level 1, planned for a crew of 8")
- the evidence quote in the foreman's words, with the time
- actions: **Open call**, **Call again**, **Mark handled**

**Everyone else:** a compact list of confirmed and on-track bookings. Each row shows time, company, area, crew, and a status pill.

**Status pills:** Confirmed, Not coming, On call, No answer, Not called.

**States:**
- **Nothing booked:** points to Plan.
- **Calls not run yet:** shows the next call time and a "Call everyone now" button.
- **Round in progress:** a live progress strip.
- **All clear.**

## 4. Plan
**Purpose:** enter who works where on a given day.

**Header:**
- date picker
- "Copy from another day"
- "Add booking" (the primary button)

**Booking table** (cards on a phone):
- start and finish
- company
- work
- area
- crew needed
- prerequisites
- check-in status
- row actions: call now, edit, remove

**Add or edit booking** (a side drawer on a laptop, a full screen sheet on a phone):
- subcontractor (a searchable select, with "Add new subcontractor" inline)
- work, area, start, finish, crew needed
- prerequisites as removable chips
- materials as chips
- a "Needs the area to themselves" toggle
- inline validation messages under each field

**Conflict hint:** while editing, show a notice if the area and time overlap another booking that needs the area to itself.

**Google Sheet mode:** the table is read only, with a banner "Bookings come from your Google Sheet", "Refresh from sheet", and a list of rows that need fixing.

**States:** empty day, loading, validation error, sheet mode.

## 5. Crew
**Purpose:** the standing list of subcontractors and the foreman who answers for each.

**Header:**
- search
- "Add subcontractor" (the primary button)
- "Import from CSV"

**Table columns:**
- company
- trade
- foreman
- phone
- language (English, Spanish)
- number of upcoming bookings
- last check-in result

**Add or edit drawer:**
- company, trade, foreman name
- phone, with a country code picker
- language

**Remove:**
- a confirmation dialog
- blocked with a clear reason when the subcontractor still has upcoming bookings

**Crew member detail**, optional for version one:
- recent calls
- no-show and short-crew history

**States:** empty, search with no results, sheet mode read only.

## 6. Calls
**Purpose:** everything Muster said and heard.

**Tonight's round panel**, at the top whenever a round is running or scheduled:
- next run time
- progress (for example "4 of 12 called")
- who is being called right now
- retry queue
- "Call everyone now" and "Stop after this call"

**Call list** (newest first). Each row shows:
- company and foreman
- date and time
- duration
- channel (phone or browser)
- outcome: Finished, Hung up, No answer, Time limit, Dropped

**Filters:** date, outcome, subcontractor.

## 7. Call detail
**Purpose:** proof of what was said.

**Header:**
- company, foreman, work and area
- date, duration, outcome

**Audio player:** the recording, with a clickable timeline.

**Transcript:**
- speaker labels (agent name, foreman name) and timestamps
- clicking a line jumps the audio to that moment
- Spanish lines show an English translation underneath

**What was recorded:**
- crew size, arrival time, each prerequisite and its status, deliveries, blockers, call back request, answers to extra questions
- each item shows **Saved** or **Rejected**, and links to the transcript line it came from

**Actions:** Call again, Copy summary.

## 8. Try a check-in
**Purpose:** hear exactly what a foreman hears, from the browser. Also what judges and new customers use first.

**Content:**
- choose a day and a booking
- the booking summary card
- a large "Start check-in" button that becomes "End check-in" while live
- a live transcript that fills in as you speak
- microphone permission helper

**States:**
- microphone blocked
- connecting
- live, with a speaking indicator for both sides
- ended, with a link to the call detail

## 9. Foreman check-in link (public, no login)
**Purpose:** a foreman taps a link sent on WhatsApp and checks in by voice from their phone, instead of taking a call.

**Content:**
- project name and booking
- one "Tap to talk" button
- live transcript
- "Done" confirmation

**Language:** English or Spanish, following the foreman's setting.

**States:**
- link expired
- already checked in
- microphone blocked

## 10. Settings
Tabs, each saved separately.

**10a. Project**
- project name, superintendent name, time zone
- site words to recognise, as a chip input with a counter out of 100

**10b. Agent**
- agent name
- first words in English and in Spanish, with fill-in chips you click to insert: first name, company, work, area, start, superintendent, project
- extra instructions, with a character counter out of 2000
- extra questions: a reorderable list, each with question text and answer type (Yes or no, Number, Short answer), maximum 10
- **View full prompt:** pick a booking and see the exact greeting, prompt, recognised words and tools, read only
- a note: "The rules that keep answers accurate always apply"

**10c. Schedule**
- automatic calls on or off
- call time and days of the week
- calling hours
- retry gap and attempts per foreman
- "next run" preview text

**10d. Data source**
- Enter in Muster, or Google Sheet
- for Google Sheet: sheet link, the account email to share it with, connection status, last read time, rows needing attention, "Refresh from sheet"
- an explanation of the Crew and Tomorrow tabs, and the result columns Muster writes

**10e. Phone**
- calling number, connection status, "Send a test call"

**10f. Team** (version two)
- invite members, with the roles Superintendent and Viewer

## 11. Projects
**Purpose:** a company runs several jobs.
- a list of projects with today's attention count for each
- "New project" opens onboarding step 1

## 12. Morning summary message (email and SMS template)
- subject: "Tomorrow at Harbor Street Clinic: 3 need attention"
- the top three problems, each with its quote, then a "View Today" button
- the SMS version is under 300 characters

## 13. System states (shared components)
- **Empty states**, each with one clear next action
- **Loading skeletons** for lists and cards
- **Error banner:** plain language, with a retry button
- **Offline notice** for phones on site
- **404 page** and **session expired**
- **Toasts:** saved, copied, call started
- **Confirmation dialogs:** remove booking, remove subcontractor, stop round

## Components the designer should define once
- severity markers and status pills
- problem card, with quote treatment
- booking row and card
- side drawer and phone sheet
- chip input
- time, date and phone inputs
- audio player with transcript sync
- live speaking indicator
- stepper for onboarding
- tabs, table, search, filters
- toast, dialog, banner

## Build status today
- **Built and wired to real data:**
  - Landing page, all sections
  - Sign in, Create account and password reset, with real accounts and sessions
  - Onboarding, all four steps
  - Today, Plan with the booking drawer, Crew, Calls list and detail, Try a check-in, Settings
  - Usage limits per plan, shown on Today and Settings
- **Not built yet:**
  - Google sign in
  - Several projects per account
  - Audio recordings in call detail
  - Foreman link page
  - Team
  - Morning summary email and SMS
