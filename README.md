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

## Calling (Twilio)

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
`TWILIO_TWIML_APP_SID`, and `TWILIO_CALLER_ID` (the number from step 1).

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
  (`POST /api/voice`), and logs call status (`POST /api/status`).
- `api/*.js` — the same three endpoints as Vercel serverless functions,
  deployed automatically alongside the frontend when you deploy to Vercel.
  Both paths share their Twilio logic from `server/twilioCore.js`.
- If Twilio isn't configured yet, the Call button surfaces a clear error in
  the Powerdialler instead of failing silently.

### Deploying to Vercel

The `/api` functions deploy automatically with the rest of the app — no
separate backend hosting needed. Two things to set up in the Vercel project:

1. **Environment variables** — Project Settings → Environment Variables, add
   `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`,
   `TWILIO_TWIML_APP_SID`, `TWILIO_CALLER_ID` (same values as your local
   `.env`). Do **not** set `VITE_CALL_SERVER_URL` here — leaving it unset
   makes the frontend call `/api/token` on the same domain, which is what
   you want in production.
2. **TwiML App Voice webhook** — once deployed, point it at
   `https://<your-vercel-domain>/api/voice` (method `POST`) in the Twilio
   Console (Voice → TwiML → TwiML Apps).

Redeploy after changing env vars (Vercel only picks them up on a fresh
build). You can sanity-check they're set correctly by visiting
`https://<your-vercel-domain>/api/health` — it should return `{"ok":true}`.

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
