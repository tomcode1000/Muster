# Muster

Muster calls every subcontractor foreman booked for tomorrow, in English or Spanish, confirms crew size, arrival time, prerequisites, deliveries and blockers, and turns the answers into a ranked list for the morning. Every problem it raises carries the foreman's own words.

Built on the AssemblyAI Voice Agent API, with Twilio for phone calls.

## How it works

1. **Plan.** Tomorrow's bookings, entered in Muster or read from a Google Sheet.
2. **Call.** At your call time, Muster rings each foreman. A browser check-in runs the same conversation without a phone line.
3. **Record.** The agent writes what the foreman said into a check-in record through validated tools. Nothing is recorded that was not said.
4. **Rank.** Plain code, not the model, compares the record with the plan: short crews, late arrivals, unconfirmed prerequisites, deliveries after start, blockers and area clashes.

## Run it locally

Requirements: Node.js 20 or newer, an AssemblyAI API key. Twilio is only needed for phone calls.

```
npm install
cp .env.example .env      # add ASSEMBLYAI_API_KEY at minimum
npm start                 # http://localhost:3000
npm test
```

Open `http://localhost:3000`, press **Get Started**, create your account, and follow setup: project, crew, call schedule. Then add bookings on **Plan** and use **Try a check-in** to talk to the agent from the browser.

### Phone calls

Twilio must reach this server over the internet.

1. Put your Twilio SID, auth token and number in `.env`.
2. Start a tunnel: `cloudflared tunnel --url http://localhost:3000`. The free ngrok tier blocks the audio stream Twilio opens.
3. Put the tunnel's `https://` address in `HOSTNAME`, then restart `npm start`. The server prints the address it will give Twilio.
4. While testing, set `MUSTER_PHONE_OVERRIDE` to one verified number so every call rings you.

The laptop's internet must not come from the phone being called, or answering the call cuts the server off.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Landing page |
| `signin.html`, `signup.html` | Sign in, create account, and set a new password from a reset link |
| `onboarding.html` | Four step setup: project, crew, calls, finish |
| `today.html` | Tomorrow at a glance: problems ranked, bookings, usage |
| `plan.html` | Bookings for a day, with the add and edit drawer |
| `crew.html` | Subcontractors, foremen and their latest check-in |
| `calls.html` | Every call, with transcript and recorded facts |
| `talk.html` | A check-in from the browser |
| `settings.html` | Project, data source, agent, schedule, rounds, usage |

## Accounts

Every app screen and API needs a signed in user. The landing page, the auth screens and the Twilio routes stay public.

- The first account created owns the workspace, and sign up closes after it. Set `MUSTER_OPEN_SIGNUP=true` to let more people join the same workspace.
- Passwords are hashed with scrypt. Sessions live in an HttpOnly cookie for 30 days with **Remember me**, 12 hours without it.
- Five wrong passwords for one email lock sign in for 15 minutes.
- Muster sends no email. To reset a password, run `npm run reset-password -- you@company.com` and open the link it prints within 30 minutes.

## Usage limits

Limits are enforced on the server and set by `MUSTER_PLAN` in `.env`.

| | Free | Pro | Business |
|---|---|---|---|
| Call minutes per month | 30 | 300 | 1,000 |
| Calls per day | 20 | 100 | 400 |
| Subcontractors | 5 | 50 | No limit |

## Known limits

- **Everyone shares one workspace.** Accounts see the same crew, plan and calls, and limits apply to the workspace.
- **Google sign in is not connected.** Use email and password.
- **One project per workspace.**
- **Data is stored as JSON files** in `data/`. Attach a persistent disk when deploying.

## Project layout

```
src/
  index.ts          HTTP and WebSocket server
  agent/            Voice Agent session, prompt, tools, agent profile
  domain/           Findings engine and time helpers, pure functions
  calls/            Dialer and scheduler
  sheets/           Google Sheets client and roster mapping
  usage.ts          Plan limits and metering
  workspace.ts      Crew and bookings entered in the app
public/             Landing page and app screens
test/               Node test runner suites
```

Started from AssemblyAI's Twilio voice agent example, which provided the phone audio bridge.
