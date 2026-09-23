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
npm start                 # compiles, then http://localhost:3000
npm test
```

`npm start` compiles to `dist/` and runs the built server, which is what the deployment does. While working on the code, `npm run dev` runs the sources directly through `ts-node` with no build step.

Open `http://localhost:3000`, press **Get Started**, create your account, and follow setup: project, crew, call schedule. Then add bookings on **Plan** and use **Try a check-in** to talk to the agent from the browser.

### Phone calls

Twilio must reach this server over the internet.

1. Put your Twilio SID, auth token and number in `.env`.
2. Start a tunnel: `cloudflared tunnel --url http://localhost:3000`. The free ngrok tier blocks the audio stream Twilio opens.
3. Put the tunnel's `https://` address in `MUSTER_PUBLIC_URL`, then restart `npm start`. The server prints the address it will give Twilio.
4. While testing, set `MUSTER_PHONE_OVERRIDE` to one verified number so every call rings you.

The laptop's internet must not come from the phone being called, or answering the call cuts the server off.

## Deploy on Render

`render.yaml` describes the deployment. In the Render dashboard, choose **New**, **Blueprint**, and point it at this repository.

`npm start` compiles and then runs the built server. Starting through `ts-node` instead holds the compiler in memory beside the running app, and a 512MB free instance dies with a JavaScript heap error before it opens a port.

Two things about Muster shape that file, and they are worth knowing before you pick a plan.

Twilio holds a media stream open for the length of every call, so Muster has to be a service that stays up, not a function that answers one request. The evening round is driven by a timer inside that same process, so an instance asleep at call time places no calls. That rules out serverless hosts.

The blueprint uses the free instance, which needs no card. It sleeps after about fifteen minutes idle, and a sleeping process places no calls, so `MUSTER_KEEP_AWAKE` is set: the server asks for its own health endpoint every ten minutes. A month is 720 hours and the free allowance is 750 instance hours, so one always awake service fits. That cannot wake a process that is already asleep, so also point a free uptime monitor at `/health`, which covers the gap after a deploy.

It also has no disk, so `data/` is wiped on every deploy and restart. Muster handles that rather than losing the workspace: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (free at upstash.com, no card) and the data directory is mirrored to that store after every write, then restored at boot. Local files always win, so a machine with a real disk is never overwritten by the mirror.

After the first deploy, set these in the dashboard under **Environment**:

| Variable | Value |
|---|---|
| `MUSTER_PUBLIC_URL` | Only for a custom domain. Render sets `RENDER_EXTERNAL_URL` itself and Muster reads that |
| `ASSEMBLYAI_API_KEY` | your key |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | your Twilio credentials |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | the REST details of a free Upstash Redis database, so the data survives a deploy |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the service account key itself, for reading sheets. A deployment has no file to point at |

On Render nothing needs filling in: the platform sets `RENDER_EXTERNAL_URL` to the service's own address and Muster uses it. Set `MUSTER_PUBLIC_URL` only to override that, for a custom domain or a tunnel. With no usable address, phone calls are refused rather than dialled into nowhere, and the server says so at startup.

Set `MUSTER_PUBLIC_URL` rather than `HOSTNAME`. Container platforms set `HOSTNAME` themselves, to the instance id, and Muster would otherwise hand that to Twilio as a web address. `HOSTNAME` is still read when it holds a real URL, so existing tunnel setups keep working.

A sleeping instance is not fatal to the round. The scheduler runs a round it slept through, as long as calling hours have not ended, so a ping shortly before call time is enough to wake it.

The free plan is right for a demonstration and wrong for real use, because of the missing disk. When it stops being a demonstration, switch to the paid instance with a disk and set `MUSTER_DATA_DIR` to the mount path. The end of `render.yaml` gives the exact lines. That instance never sleeps, so the uptime pinger can go at the same time.

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

## Accounts and workspaces

Every app screen and API needs a signed in user. The landing page, the auth screens and the Twilio routes stay public.

A workspace holds one project: its crew, plan, check-ins, calls, settings and usage. Every account owns one, and the session decides which is in play for a request, so two accounts on the same server never see each other's work. Accounts and sessions live outside every workspace, because the session is what decides which workspace you are in.

A phone call arrives with no session, so the workspace travels in the callback address Muster hands Twilio, and comes back in the media stream's first frame. The evening round runs on one timer that considers each workspace on its own clock.

- The first account created owns the workspace, and sign up closes after it. Set `MUSTER_OPEN_SIGNUP=true` to let more people join the same workspace.
- Passwords are hashed with scrypt. Sessions live in an HttpOnly cookie for 30 days with **Remember me**, 12 hours without it.
- Five wrong passwords for one email lock sign in for 15 minutes.
- New accounts confirm their address before they can reach the app. Set `MUSTER_MAIL_FROM` and one provider key to send the link:
  - `MUSTER_BREVO_KEY`: Brevo verifies one sender address, a plain Gmail address is fine, and then delivers to anybody. Use this when strangers can sign up.
  - `MUSTER_RESEND_KEY`: Resend needs a domain you own before it delivers to anyone but the account holder.
  With no key, sending is off, and then no account is held back waiting for a link that cannot arrive, including one that signed up while sending was on.
- Setup runs once per account. Finishing it is recorded, so nobody is walked through it twice.
- Without a mail provider, reset a password with `npm run reset-password -- you@company.com` and open the link it prints within 30 minutes. `npm run mail-test -- you@company.com` checks a mail setup.

## Usage limits

Limits are enforced on the server and set by `MUSTER_PLAN` in `.env`.

| | Free | Pro | Business |
|---|---|---|---|
| Call minutes per month | 30 | 300 | 1,000 |
| Calls per day | 20 | 100 | 400 |
| Subcontractors | 5 | 50 | No limit |

## Known limits

- **Each account owns a workspace.** Crew, plan, calls, settings and usage are separate, and nobody can see another account's data. The first account created keeps the original workspace, so an installation from before this existed is not stranded.
- **Google sign in is not connected.** Use email and password.
- **One project per workspace.**
- **Data is stored as JSON files** in `data/`. On a host with no disk, set the Upstash keys and the directory is mirrored and restored automatically.

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
