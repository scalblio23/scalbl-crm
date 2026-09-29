# Scalbl CRM

A simple internal CRM prototype covering conversations, contacts, a powerdialler, clients, and settings.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

## Build

```bash
npm run build
```

## Calling (SIP trunk — VoIPcloud / VoIPline)

With `VOICE_PROVIDER=sip`, the Powerdialler calls out through a VoIPcloud
SIP trunk (registered to `sipm5.au.voipcloud.online:7060` over TCP) instead
of Twilio, presenting `+61480851534` as caller ID. Callbacks to that number
ring the app too. The dialler workflow is unchanged: same Call button,
sessions, wrap-up, soundboard, call log and conversation logging. SMS still
goes through Twilio, because the SIP trunk carries voice only.

```
browser (mic/speaker) ──WebSocket, PCM 8 kHz──▶ voice gateway ──SIP/TCP + G.711 RTP──▶ VoIPcloud ──▶ PSTN
```

A SIP registration and its RTP audio need sockets that stay open, and
serverless functions can't hold those. So SIP calling runs in a separate,
always-on process, the **voice gateway** (`server/voiceGateway.js`). It:

- registers with the trunk (digest auth), refreshes the registration before
  it expires, sends TCP keepalives, and reconnects and re-registers if the
  connection drops;
- places calls with SIP INVITE, using the destination in E.164
  (`0412 345 678` → `+61412345678`) and the caller ID;
- accepts inbound INVITEs on the same registration and offers them to every
  logged-in rep who isn't already on a call; the first to answer gets it;
- handles ringing (180/183, including the network's own ringback as early
  media), answered, busy (486/600), declined (603), no-answer (ring timeout,
  60s by default), failed and hang-up, whichever side hangs up;
- sends DTMF as RFC 4733 telephone-events (falling back to SIP INFO if the
  far end doesn't support them), receives it both ways, and has a keypad on
  the live call;
- carries audio as G.711 A-law or u-law RTP, and bridges it to each rep's
  browser over a WebSocket.

The browser side is `src/lib/sipDevice.js`. It exposes the same call API as
`twilioDevice.js`, and `src/lib/voiceDevice.js` chooses between the two
based on the backend's `VOICE_PROVIDER`.

### Channels

`SIP_MAX_CHANNELS` (default 1, matching "SIP Line MAX 1ch") caps
simultaneous calls, inbound and outbound together. With one channel, a
callback arriving mid-call gets busy. To add channels, buy them from
VoIPcloud and raise the number; no code changes. **Multi Line** dialling
works over SIP once there are 2 or more channels. The gateway rings each
lead on its own channel, bridges whoever answers first and cancels the
others.

### Set up locally

1. Fill in the `SIP_*` and `VOICE_GATEWAY_*` values in `.env` (see
   `.env.example`). `SIP_PASSWORD` is only ever read by the gateway.
2. `npm run dev:sip` starts the frontend, the API server and the voice
   gateway together. You can also run `npm run voice-gateway` on its own.
3. Check `http://localhost:3002/health`. `registration.state` should be
   `"registered"`.

### Deploying

The Vercel app needs `VOICE_PROVIDER=sip`, `VOICE_GATEWAY_URL` and
`VOICE_GATEWAY_SECRET` (plus `SIP_CALLER_ID` for display). Run the gateway
on any always-on host with Node 20+, such as a small VPS:

- give it the full `.env` (the `SIP_*` values, `VOICE_GATEWAY_SECRET`, and
  `POSTGRES_URL` so missed calls get logged);
- put its port (3002) behind a TLS reverse proxy (Caddy or nginx) so
  browsers can reach it at `wss://…/voice`;
- allow UDP `SIP_RTP_PORTS` (default 10000-10999) inbound for call audio;
- set `SIP_PUBLIC_IP` if it's behind NAT and audio is one-way.

**On DigitalOcean**, `deploy/voice-gateway/` automates this. Use one of
two scripts:

- **`setup.sh`**: run it as root on a fresh Ubuntu 24.04 Droplet, e.g.
  from the Droplet's web Console. It installs Node and Caddy, fetches the
  app, prompts for the SIP password, `VOICE_GATEWAY_SECRET` and
  `POSTGRES_URL`, runs the gateway as the `scalbl-voice` systemd service,
  sets up HTTPS and opens the firewall. Afterwards it prints the Vercel
  variables to set.

  ```bash
  bash <(curl -fsSL -H "Authorization: token <GITHUB_TOKEN>" \
    https://raw.githubusercontent.com/scalblio23/scalbl-crm/refs/heads/<BRANCH>/deploy/voice-gateway/setup.sh)
  ```

- **`provision-do.mjs`**: does the whole thing through the DigitalOcean
  API. It creates the Droplet (Sydney, $6/mo) and runs `setup.sh` on it
  unattended on first boot, adds a Cloud Firewall and sets the DNS A record
  if the domain's DNS is on DigitalOcean. It then waits for `/health` to
  report `registered`. Pass `--replace` to rebuild an existing Droplet of
  the same name.

  ```bash
  DIGITALOCEAN_TOKEN=... VOICE_DOMAIN=voice.example.com SIP_PASSWORD=... \
  GITHUB_TOKEN=... POSTGRES_URL=... node deploy/voice-gateway/provision-do.mjs
  ```

On the Droplet, `journalctl -u scalbl-voice -f` shows the gateway's logs
and `/var/log/scalbl-setup.log` has the setup output.

Missed inbound calls (the caller hung up, or no rep was online) are logged
onto the matching contact's conversation, the same way inbound SMS are.

Use a headset. Browser echo cancellation is weaker for audio played this
way than for WebRTC.

### Tests

`npm run test:sip` runs the SIP stack against a fake trunk. It covers
registration and auth, re-registration after a dropped connection, outbound
answered/busy/failed/no-answer calls, early media, audio in both directions,
DTMF, inbound answer/cancel/BYE, the channel limit, multi-line and the
browser WebSocket bridge.

## Calling (Twilio)

Used when `VOICE_PROVIDER=twilio` (or no SIP settings are configured).

The Powerdialler's Call button places real calls the same way GoHighLevel's
dialler does: the browser registers as a Twilio Voice "device" (a softphone),
so calls ring through the rep's mic/speakers instead of their actual phone.
Twilio credentials never reach the browser — a small backend in `/server`
mints short-lived call tokens and tells Twilio who to dial.

### 1. Set up Twilio

1. Create a Twilio account and buy a phone number (Console → Phone Numbers).
2. Console → Account → **API keys & tokens** → create a Standard API key.
   Note the SID and Secret — the secret is only shown once.
3. Console → Voice → TwiML → **TwiML Apps** → create one. Leave the Voice
   webhook blank for now — you'll fill it in once you have a public URL for
   `/api/voice` (see step 3 below).

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`,
`TWILIO_TWIML_APP_SID`, and `TWILIO_CALLER_ID` (the number from step 1). To
rotate outbound calls across several numbers instead of one — spreading call
volume so no single number gets carrier-flagged — set `TWILIO_CALLER_IDS`
(comma-separated) instead; see `.env.example` for details.

### 3. Run the app + calling server together

```bash
npm run dev:all
```

This runs the Vite frontend and the Express calling server (`/server`,
default port 3001) side by side. `npm run server` runs just the backend.

Twilio needs to reach `/api/voice` on the backend to know who to dial, so in
local dev expose it with a tunnel (e.g. `ngrok http 3001`) and paste the
resulting URL + `/api/voice` into the TwiML App's Voice webhook (method
`POST`). In production, point it at your deployed backend's `/api/voice`.

### How it fits together

- `src/lib/twilioDevice.js` — frontend wrapper around the Twilio Voice SDK;
  fetches a token, registers the browser as a calling device, places/ends calls.
- `server/index.js` — **local dev only** (used by `npm run dev:all`). Mints
  Access Tokens (`GET /api/token`), answers Twilio's voice webhook
  (`POST /api/voice`), logs call status (`POST /api/status`), and drives
  multi-line dialling (`/api/multiline-*`, see below).
- `api/*.js` — the same endpoints as Vercel serverless functions, deployed
  automatically alongside the frontend when you deploy to Vercel. Both paths
  share their Twilio logic from `server/twilioCore.js`.
- If Twilio isn't configured yet, the Call button surfaces a clear error in
  the Powerdialler instead of failing silently.

### Deploying to Vercel

The `/api` functions deploy automatically with the rest of the app — no
separate backend hosting needed. Two things to set up in the Vercel project:

1. **Environment variables** — Project Settings → Environment Variables, add
   `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`,
   `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID` (or `TWILIO_CALLER_IDS` for
   rotation — same values as your local `.env`). Do **not** set
   `VITE_CALL_SERVER_URL` here — leaving it unset makes the frontend call
   `/api/token` on the same domain, which is what you want in production.
2. **TwiML App Voice webhook** — once deployed, point it at
   `https://<your-vercel-domain>/api/voice` (method `POST`) in the Twilio
   Console (Voice → TwiML → TwiML Apps).

Redeploy after changing env vars (Vercel only picks them up on a fresh
build). You can sanity-check they're set correctly by visiting
`https://<your-vercel-domain>/api/health` — it should return `{"ok":true}`.

### Multi-line dialling

The **Multi Line** tab is a separate mode of the same Powerdialler engine —
same dialler lists, same lead queue/filters, same wrap-up flow — with its
"Lines" selector (2-4) forcing every round to dial that many leads at once
instead of one at a time. Whoever answers first gets bridged to the rep, and
every other line gets hung up immediately; while lines are still ringing, the
tab shows each one's lead, phone number, and which caller ID it's dialling
from. Under the hood, the rep's own browser leg and each lead's leg (placed
via the Twilio REST API) all join the same Twilio Conference; the first leg
to report `in-progress` wins, and the rest are cancelled. The regular
Powerdialler tab is unaffected — it always dials one lead at a time.

This needs a real, publicly-reachable URL Twilio can fetch — see `PUBLIC_URL`
in `.env.example`. It's automatic on Vercel; in local dev, set it to the same
ngrok URL used for the Voice webhook above. Without it, starting a multi-line
dial fails with a clear error rather than silently placing calls Twilio can't
call back.

Each line rings for `MULTILINE_RING_SECONDS` (25s, in `server/twilioCore.js`)
before Twilio gives up on it — well short of Twilio's own 60s default, so an
unanswered line doesn't sit ringing for a full minute. The tab shows a live
"gives up in Ns" countdown while it waits. If Twilio's status callback for a
line never makes it back here at all (most likely a `PUBLIC_URL` that isn't
actually reachable), the frontend also gives up on its own a few seconds
after that window — so a broken callback shows up as a clear "gave up
waiting" error instead of the dial just hanging with hold music forever.

**If a line never rings at all** — a lead's leg is placed via the REST API
straight from their stored phone number, normalized to E.164 the same way
the single-line dialler does (so a locally-formatted number like
`0412 334 556` still routes correctly). If Twilio rejects the call outright
(bad number, geo permissions, or — very commonly when testing against a
brand-new Twilio account — a **trial account only allowing calls to
numbers verified in the Twilio Console**), that line's card in the "Dialling
N lines" panel turns red with Twilio's own error message right there,
instead of just sitting on "Dialling…" with no explanation. Same message is
also in the Vercel Functions logs (or the local server's console) either way.

There's no answering-machine detection and no participant muting — every
leg that connects is immediately audible, so two lines answering within the
same instant can briefly cross-talk before the loser is dropped (usually well
under a second). Dialling more lines than you have reps to answer them is a
regulated practice in a lot of places (the US TCPA/TSR's abandoned-call rules
in particular) — that's on whoever's operating this CRM to stay within, not
something the app enforces.

### Soundboard

Both dialling tabs' live-call view has a small **soundboard** — short clips a
rep records once (mic, in-browser) and can fire off mid-call, e.g. a quick
canned reply to a phone's call-screening prompt ("please say your name and
reason for calling"). Unlike just playing a sound file on your own speakers,
a clip actually gets mixed into the call's outgoing audio — the person on the
other end hears it — via the Twilio Voice SDK's `AudioProcessor` API
(`src/lib/soundboardProcessor.js`), which taps into the mic stream every call
already sends and mixes a clip's audio into that same stream on demand. Clips
are shared across the whole team (stored as base64 in `soundboard_clips`),
not per-rep.

## SMS (Twilio)

Uses the same Twilio account and credentials as calling — no separate setup.

- **Outbound**: the message box in the Conversation view sends a real SMS via
  `POST /api/sms-send`, and logs it onto that lead's conversation. Click
  **New** above the conversation list to text a contact who doesn't have a
  thread yet.
- **Inbound**: replies show up automatically — Twilio posts to
  `POST /api/sms-inbound`, which matches the sender's number to a contact (by
  phone, ignoring formatting) and logs it onto their conversation, creating
  one if it's the first message from them.

To receive inbound texts, set the **Messaging** webhook on your Twilio
number: Console → Phone Numbers → your number → **Messaging Configuration** →
**A message comes in** → `https://<your-domain>/api/sms-inbound` (method
`POST`). In local dev, use the same ngrok URL as the voice webhook.

The app currently only picks up new inbound messages on page refresh — there's
no live push yet.

## Database (Postgres)

Contacts, conversations, dialler lists, and the call log are stored in a
Postgres database, not the browser — so they persist across devices and
survive a redeploy. Same setup pattern as Twilio: one database, wherever the
app is running (locally or on Vercel).

The database layer (`server/db.js`) uses the standard `pg` driver over a
normal Postgres connection string, so it works with whichever
Postgres-compatible provider you connect through Vercel's Storage tab — Neon,
Prisma Postgres, Supabase, etc. — as long as `POSTGRES_URL` is set to a
direct (non-Prisma-Accelerate) connection string.

### 1. Create the database

1. Open your project on **vercel.com** → **Storage** tab → **Create Database**.
2. Pick a Postgres provider (any of them work here — Neon, Prisma Postgres,
   Supabase…) and connect it to your project.
3. Vercel injects `POSTGRES_URL` (and a couple of related vars) into your
   project's environment variables for you — no manual copy-paste needed for
   the deployed site.

### 2. Configure local dev

Copy the `POSTGRES_URL` value from **Project Settings → Environment
Variables** in the Vercel dashboard into your local `.env`:

```bash
POSTGRES_URL=postgres://...
```

The same database works for both local dev and production — there's no
separate "local database" to set up.

### 3. That's it — the schema creates itself

The first API request creates the tables if they don't exist yet and seeds
them with the app's sample data (same contacts/clients you saw before). No
manual migration step. Restart `npm run dev:all` (or redeploy on Vercel) and
the app will start reading and writing through the database automatically.

Check it worked by visiting `/api/health` — the `database` field should say
`"connected"` instead of `"not configured — set POSTGRES_URL"`.

### How it fits together

- `server/db.js` — shared database layer (schema, seed data, queries), used
  by both `server/index.js` (local dev) and the Vercel functions below.
- `api/contacts.js`, `api/clients.js`, `api/conversations.js`,
  `api/dial-lists.js`, `api/called-leads.js`, `api/call-log.js` — one
  serverless function per resource, deployed automatically with the app.
- `src/lib/api.js` — frontend fetch wrapper the app uses to read/write these.
- If the database isn't reachable, the app falls back to its built-in sample
  data and shows a dismissible banner explaining that changes won't be saved
  until it's fixed — it won't just show a blank screen.

## Login (users)

The app requires logging in — everyone who logs in shares the same CRM data,
login just controls who's allowed in and whose name shows up on activity
(calls, texts). Accounts are invite-only: someone is added to the `users`
table (currently seeded with Henry and Jem — see `INVITED_USERS` in
`server/db.js`) before they can do anything.

### 1. Set `SESSION_SECRET`

Sessions are a signed JWT in an HttpOnly cookie — no separate session table.
Generate a random secret and set it both locally and on Vercel:

```bash
openssl rand -hex 32
```

```bash
# .env
SESSION_SECRET=<paste the value here>
```

Add the same variable in **Vercel → Project Settings → Environment
Variables**, then redeploy — logins won't work without it (the API returns a
clear error instead of failing silently).

### 2. First login — claiming an account

An invited user's row exists in the database but starts with no password.
The first time they visit the app they'll see a login screen with a "First
time here? Set your password" link — that calls `/api/auth-set-password`,
which only works while the account has no password yet. After that, only
`/api/auth-login` works for that email.

Nobody can create an account for an email that wasn't invited — both
endpoints check the `users` table first.

### 3. Adding another user later

Add a `{ name, email }` entry to `INVITED_USERS` in `server/db.js` and
redeploy — the next schema check seeds the row (`password_hash` starts
`NULL`), and that person can then claim it the same way.

### How it fits together

- `server/auth.js` — password hashing (bcrypt), session cookie
  creation/verification, and `requireAuth()`, shared by local dev and Vercel.
- `api/auth-login.js`, `api/auth-set-password.js`, `api/auth-logout.js`,
  `api/auth-me.js` — the four auth endpoints; everything else under `/api`
  requires a valid session cookie except the Twilio webhooks
  (`/api/voice`, `/api/status`, `/api/sms-inbound`) and `/api/health`.
