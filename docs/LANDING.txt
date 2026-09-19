# Muster landing page: full design brief

The hero is already built in code and matches the approved design. This brief covers
everything below it, in order, plus the shared rules that keep the page one piece of work.

## Who is reading

A general contractor or superintendent, on a laptop between site walks, or on a phone in a
truck. They are not shopping for AI. They are tired of ringing fifteen foremen every evening
and still being surprised at 7am. The page has to name that day and show the morning result.

## Voice and rules

1. **Plain site language.** "Muster rings every foreman on tomorrow's schedule." Not
   "AI powered workforce orchestration."
2. **Show the product, not abstractions.** Every section carries a real screen, a real
   transcript line, or a real row from the plan.
3. **No dashes in copy.** Commas, full stops, colons.
4. **One icon set:** drawn SVG, one stroke weight, colour inherited. No emoji.
5. **No invented proof.** The hero carries no customer count, star rating or company logos until they are real. What sits there instead is true on the day it is read: the languages, the quotes, the free plan.
   Earlier drafts carried a customer count, four faces and a logo strip. All of it was
   removed, because none of it was true.
6. **Numbers must be defensible.** "Thirty foremen, one evening" is a description. "Saves
   10 hours a week" is a claim, so leave it out until measured.

## Visual system, carried from the hero

- **Background:** #f6f7fb, with a soft lavender glow behind visual sections.
- **Ink:** #0e1733 headings, #4a5268 body, #8a90a2 quiet text.
- **Accents:** blue #2f5bea, violet #7b5cf0, used together only in the gradient on a single
  emphasised word per page.
- **Severity colours, used nowhere else:** critical #e5484d, high #f08c2e, medium #f5a524,
  confirmed #22a06b.
- **Type:** Plus Jakarta Sans. Section heading 36 to 40px, tight tracking. Body 15 to 16px,
  line height 1.6. Eyebrow labels 11px, uppercase, letterspaced, in a pale blue pill.
- **Surfaces:** white cards, 1px #e6e8f0 border, 12 to 16px radius, shadows barely there.
- **Rhythm:** sections 96 to 120px tall on desktop, 64px on phone. One idea per section.
- **Motion:** content rises 18px and fades as it enters the viewport, once. Nothing loops
  except the waveform. Everything stops under reduced motion.

---

## Section 1b: Logo strip

**Purpose:** carry the hero's social proof into the page before the argument starts.

- Sits directly under the hero, on the same background, 72px tall on desktop.
- One quiet line above, 11px, uppercase, letterspaced, in the muted grey: **Contractors
  running Muster on active projects**.
- Five or six wordmarks in a row, greyscale at about 55 percent opacity, lifting to full
  ink on hover. Even optical sizing matters more than equal pixel widths.
- On phone: two rows of three, or a slow marquee if the designer prefers, paused under
  reduced motion.
- Keep it flat: no cards, no borders, no drop shadows.

## Section 2: The evening

**Purpose:** name the problem in the reader's own words before selling anything.

- Eyebrow: **The evening**
- Heading: **Fifteen calls, and you still find out at 7am.**
- Body: The schedule says who is working tomorrow. It does not say who is short handed, who
  is still waiting on a pump truck, or who is not coming at all. That lives in fifteen phone
  calls, and the calls that matter are the ones nobody had time to make.
- **Visual:** three small cards in a row, each a moment from a real evening:
  1. A phone log with nine outgoing calls and three "no answer".
  2. A text thread that ends with "will confirm in the morning".
  3. A schedule row with a blank confirmation column.
- Keep it factual, not dramatic. No red alarm styling here.

## Section 3: How it works

**Purpose:** the whole product in four steps, understood without reading the words twice.

- Eyebrow: **How it works**
- Heading: **You keep the plan. Muster makes the calls.**
- **Four steps**, numbered, alternating image and text on desktop, stacked on phone:
  1. **Your plan, in Muster or your own sheet.** Who works where tomorrow, with the
     prerequisites each trade needs. Screen: the Plan page.
  2. **At your call time, it rings every foreman.** English or Spanish, whichever the foreman
     speaks. Screen: a phone mid call with a live transcript.
  3. **It records what they actually said.** Crew size, arrival, deliveries, blockers, and
     your own extra questions. Screen: the recorded facts panel from a call log.
  4. **By morning, one ranked list.** Every problem, with the quote it came from. Screen: the
     Today view.
- Each step has a one line caption under the screen, not a paragraph.
- **Detail worth designing well:** step 2 and step 4 should visibly share the same call. The
  quote in step 4 is the sentence spoken in step 2.

## Section 4: The call

**Purpose:** prove the conversation is real, because this is what people disbelieve.

- Eyebrow: **A real check-in**
- Heading: **Ninety seconds, and tomorrow is confirmed.**
- **Left:** a transcript, styled as in the product: agent lines on the ink border, foreman
  lines on the accent border, timestamps quiet. Eight to ten turns, including one
  interruption and one correction ("actually, make it five").
- **Right:** the facts that call produced, appearing as a checklist: crew of 5 of 8, arrival
  07:30, pump truck not confirmed, concrete at 11:00, hoist not needed.
- **Between them:** a thin line linking each fact to the line it came from, drawn on scroll.
- **Include a Spanish call** as a second tab, showing the same structure. Same design, no
  flags, no stereotyping: just a label reading "Spanish".
- Optional audio player, if recordings ship by then.

## Section 5: Features

**Purpose:** answer the "does it handle my site" questions, quickly.

- Eyebrow: **Built for site work**
- Heading: **The details that make it usable on a real job.**
- **Six cards**, each with an icon, a short title, and two lines:
  1. **English and Spanish.** The agent follows the foreman, even mid sentence.
  2. **Your site words.** Gate 2, laydown yard, pre-pour inspection, heard correctly.
  3. **Prerequisites, not just attendance.** Pump truck, inspection, delivery window.
  4. **Ranked by exposure.** A crew that is not coming outranks a late delivery.
  5. **Every finding carries its quote.** Nothing is asserted that was not said.
  6. **Your questions, on every call.** Added in settings, recorded as their own fields.
- Cards are quiet: no gradients, no coloured backgrounds. The icons carry the variety.

## Section 6: Works with your sheet

**Purpose:** remove the "we already have a system" objection.

- Eyebrow: **Your sheet, still yours**
- Heading: **Keep the schedule where your team already keeps it.**
- Body: Point Muster at a Google Sheet and it reads the crew and tomorrow's bookings before
  each round, then writes the results back into the same rows: status, crew confirmed,
  arrival, blockers and a link to the call.
- **Visual:** a spreadsheet, with the left columns plain and the result columns filling in as
  the section enters the viewport, one row at a time. This is the single delightful moment on
  the page, so give it room.
- Small print under it: "Or enter everything in Muster. Both work the same way."

## Section 7: Scheduling and control

**Purpose:** reassure them that an agent calling their subs will not embarrass them.

- Eyebrow: **You set the rules**
- Heading: **It calls when you say, and never outside your hours.**
- **Four short items** with small icons, laid out in a row:
  - Call time and days, in your project's time zone.
  - Calling hours: nobody is rung at 9pm.
  - Retries, then marked unreachable, so it does not pester.
  - Every call recorded and transcribed, with the facts it saved.
- **Visual:** the Settings schedule panel, cropped, real.

## Section 8: Pricing

**Purpose:** be straight about it, with no tiers invented for the sake of a table.

- Eyebrow: **Pricing**
- Heading: **Priced per project, not per seat.**
- **Two cards**, equal weight:
  - **Early access.** Free while in early access. One project, unlimited foremen, calls in
    English and Spanish, Google Sheet included. Button: Start free.
  - **Team.** For contractors running several jobs. Several projects, shared access, priority
    support. Button: Talk to us.
- Under both: a line on what calls cost, since voice minutes are a real cost. Keep it honest
  and simple, for example "Calls are billed at cost, about 4 cents a minute."
- No crossed out prices, no countdown timers.

## Section 9: FAQ

**Purpose:** answer the objections a superintendent actually raises.

- Eyebrow: **Questions**
- Heading: **What people ask before their first round.**
- **Accordion, six items, one open by default:**
  1. What happens if a foreman does not answer?
  2. Will it sound like a robot calling my subs?
  3. Can it make promises or change the schedule? (No, and say why.)
  4. What if the foreman only speaks Spanish?
  5. Where does the information end up?
  6. What does it cost to run?
- Answers are two or three sentences, plain, no marketing.

## Section 10: Closing

- Heading: **Tomorrow, confirmed before you leave site.**
- One line: Set your call time, add your crew, and Muster handles the evening.
- Buttons: **Start free** and **See a check-in**, the second opening the try it yourself page.
- Behind it, the agent photo returns, smaller and lower contrast, with the circle motif.

## Footer

- Left: the wordmark, a one line description, and the email address.
- Columns: Product (Features, How it works, Pricing, Try a check-in), Company (About,
  Contact), Legal (Privacy, Terms).
- Bottom line: copyright, and "Calls are recorded and transcribed. Muster tells the foreman
  who it is calling for at the start of every call."

---

## Responsive

- **Desktop:** 1280 wide, content 1118, 12 column grid.
- **Tablet:** two column sections collapse to one, screens scale to 80 percent.
- **Phone, 390 wide:** one column, 24px side gutter, section spacing 64px, headings 28px.
  Screens crop rather than shrink below legibility. The sheet animation becomes three rows.
- **Sticky on phone:** a slim bar with **Start free** appears after the hero.

## States and pieces the designer should also draw

- Nav: default, scrolled (white, thin shadow), phone menu open.
- Buttons: default, hover, pressed, disabled, loading.
- Accordion: closed, open, focus ring.
- Form fields for the contact and sign up paths, with an error message under the field.
- A cookie or consent bar, if legal asks for one.
- Focus states for keyboard use on every interactive element, in the blue accent.
- A 404 page, in the same style, with a link back.

## Accessibility

- Text contrast at least 4.5 to 1, including the quiet grey on the pale background.
- The gradient word must remain legible if gradients fail.
- Every screen image needs alt text describing the result, not the layout.
- Motion respects reduced motion, including the sheet fill and the scroll lines.

## What to hand back

- Figma pages: Landing (desktop, tablet, phone), Components, and an Assets page with the
  agent cutout and every product screen exported at 2x.
- Real product screens please, taken from the app, not redrawn boxes.
