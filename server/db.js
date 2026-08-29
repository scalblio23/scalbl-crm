// Shared database layer — used by both the local Express server
// (server/index.js) and the Vercel serverless functions (/api/*.js),
// exactly like server/twilioCore.js does for calling. Uses the
// standard `pg` driver over a normal Postgres connection string, so
// it works with any Postgres-compatible provider (Neon, Prisma
// Postgres, Supabase, RDS, …) — whichever one POSTGRES_URL points at.
import pg from "pg";
import crypto from "crypto";
import { CLIENT_COLUMNS, IMPORTED_CLIENTS } from "./clientImportData.js";
import { CONTACT_COLUMNS, IMPORTED_CONTACTS } from "./contactImportData.js";

const { Pool } = pg;

function connectionString() {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
}

export function isDbConfigured() {
  return Boolean(connectionString());
}

let pool = null;
function getPool() {
  if (!pool) {
    const cs = connectionString();
    if (!cs) {
      throw new Error(
        "No database connection string found. Set POSTGRES_URL (from your Vercel Postgres database) in .env."
      );
    }
    pool = new Pool({
      connectionString: cs,
      // Most hosted Postgres providers require SSL and present a cert
      // chain Node won't fully validate by default — this matches the
      // common Vercel + Postgres deployment pattern.
      ssl: cs.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function query(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

// Runs `fn` over `items` with at most `limit` in flight at once —
// used by /api/sms-bulk-send so a large selection doesn't fire
// hundreds of Twilio sends simultaneously, while still going faster
// than one-at-a-time. Order of the returned results matches `items`;
// one item's rejection doesn't stop the others (callers pass an `fn`
// that catches its own errors into the result instead of throwing).
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Idempotent — safe to call on every request. Creates the schema on
// first use so there's no separate manual migration step.
let schemaReady = null;
export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT,
        leads INTEGER DEFAULT 0,
        ads_live BOOLEAN DEFAULT false,
        script TEXT,
        script_steps JSONB DEFAULT '[]',
        fields JSONB DEFAULT '{}'
      )
    `);
    // Table already existed before `fields` was added — safe no-op if
    // it's already there.
    await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS fields JSONB DEFAULT '{}'`);
    // Superseded by tag_webhooks (below) — a per-client token doesn't
    // match how tags are actually named, so this is dropped rather
    // than kept around unused.
    await query(`ALTER TABLE clients DROP COLUMN IF EXISTS webhook_token`);
    await query(`
      CREATE TABLE IF NOT EXISTS client_columns (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        options JSONB DEFAULT '[]',
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT NOT NULL,
        client TEXT,
        status TEXT DEFAULT 'New Lead',
        last_contact TEXT,
        notes TEXT,
        fields JSONB DEFAULT '{}',
        lead_date TEXT,
        tag TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Table already existed before these were added — safe no-op once
    // they're there. lead_date is the original date the lead came in
    // (e.g. from an imported sheet), separate from last_contact which
    // tracks outreach. tag is the free-text label shown in the
    // Contacts secondary sidebar — for imported leads, the name of the
    // sheet tab/client they came from.
    await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fields JSONB DEFAULT '{}'`);
    await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_date TEXT`);
    await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tag TEXT`);
    await query(`
      CREATE TABLE IF NOT EXISTS contact_columns (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        options JSONB DEFAULT '[]',
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER,
        name TEXT NOT NULL,
        preview TEXT,
        time_label TEXT,
        unread BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        type TEXT DEFAULT 'text',
        text TEXT,
        time_label TEXT,
        outgoing BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS dial_lists (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        lead_ids JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS called_leads (
        lead_id INTEGER PRIMARY KEY
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS call_log (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER,
        name TEXT,
        phone TEXT,
        client TEXT,
        status TEXT,
        notes TEXT,
        called_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Added for the Reports tab — who placed the call, how long it
    // lasted, and the lead's tag at call time. user_id is TEXT (not
    // INTEGER) because API-key callers resolve to a synthetic id like
    // "api-key:3" rather than a row in `users`.
    await query(`ALTER TABLE call_log ADD COLUMN IF NOT EXISTS user_id TEXT`);
    await query(`ALTER TABLE call_log ADD COLUMN IF NOT EXISTS user_name TEXT`);
    await query(`ALTER TABLE call_log ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`);
    await query(`ALTER TABLE call_log ADD COLUMN IF NOT EXISTS tag TEXT`);
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Role hierarchy: owner > super_admin > admin > client. "client" is
    // scoped to a set of lead tags (allowed_tags) — everywhere the app
    // reads contacts/conversations/calls, a client-role caller only
    // ever gets rows whose tag is in that list. The other three roles
    // all see every tab and every lead; they differ only in whether
    // they can manage other users (see server/auth.js).
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_tags JSONB DEFAULT '[]'`);
    // Single global credential (see getApiKey/regenerateApiKey below) —
    // used both as the Bearer/X-Api-Key for programmatic CRM access
    // and as the ?token= on the public /api/lead-webhook endpoint,
    // replacing what used to be a list of keys plus a separate
    // per-tag webhook token. The table can still only ever hold at
    // most one row; kept as a table rather than a single settings row
    // so the existing hash-lookup/last-used-at plumbing didn't need
    // to change shape.
    await query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT now(),
        last_used_at TIMESTAMPTZ
      )
    `);
    // raw_key holds the key in the clear so Settings can always show
    // it (not just once at creation) — needed now that it's also the
    // webhook URL's token, which has to stay copyable indefinitely.
    // Any key created before this column existed only ever had its
    // hash stored and can't be recovered for display, so it's cleared
    // out here — a one-time, self-limiting cleanup (nothing matches
    // once every row has a raw_key) that leaves the account with no
    // key until someone generates the new single one from Settings.
    await query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS raw_key TEXT`);
    await query(`DELETE FROM api_keys WHERE raw_key IS NULL`);
    // ---------- Multi-line dialling (see server/twilioCore.js's
    // conference helpers and api/multiline-*.js) ----------
    // One batch per "dial N leads at once" attempt. winner_call_sid is
    // claimed atomically (first call to answer wins — see
    // claimMultilineWinner below) and is how every other leg in the
    // batch gets identified as a loser and hung up.
    await query(`
      CREATE TABLE IF NOT EXISTS multiline_batches (
        id SERIAL PRIMARY KEY,
        conference_name TEXT UNIQUE NOT NULL,
        created_by TEXT,
        winner_call_sid TEXT,
        winner_lead_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // One row per lead dialled as part of a batch. call_sid starts
    // null (assigned right after Twilio accepts the call.create()
    // request) so a row can be inserted — and its id embedded in that
    // call's own TwiML/status-callback URLs — before the SID exists.
    await query(`
      CREATE TABLE IF NOT EXISTS multiline_batch_calls (
        id SERIAL PRIMARY KEY,
        batch_id INTEGER REFERENCES multiline_batches(id) ON DELETE CASCADE,
        lead_id INTEGER,
        name TEXT,
        phone TEXT,
        call_sid TEXT,
        status TEXT DEFAULT 'placed',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Added after the table first shipped — which caller ID each leg
    // was dialled from, shown per-line on the Multi Line tab.
    await query(`ALTER TABLE multiline_batch_calls ADD COLUMN IF NOT EXISTS from_number TEXT`);
    // Why a leg never made it out (Twilio rejected the call.create()
    // itself) — see setMultilineBatchCallFailed.
    await query(`ALTER TABLE multiline_batch_calls ADD COLUMN IF NOT EXISTS error_message TEXT`);
    // ---------- Soundboard (quick-play clips for a live call) ----------
    // Short pre-recorded clips a rep can fire off mid-call — e.g. a
    // canned response to a phone's call-screening prompt ("please
    // state your name and reason for calling") — see
    // src/lib/soundboardProcessor.js for how it actually gets mixed
    // into the live call's outgoing audio. audio_data is base64 —
    // clips are short (capped client-side), so this stays small.
    await query(`
      CREATE TABLE IF NOT EXISTS soundboard_clips (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        audio_data TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // ---------- Booking (Google Calendar) — see server/googleCalendar.js
    // and server/bookingApi.js ----------
    // One connected Google account per CRM user — each rep books off
    // their own calendar and sends confirmations from their own Gmail,
    // not a shared account. refresh_token is nullable because Google
    // only ever hands one out on first consent (or a forced
    // re-consent); access_token/token_expiry are refreshed in place as
    // they're used (see getValidAccessTokenForUser).
    await query(`
      CREATE TABLE IF NOT EXISTS google_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        google_email TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TIMESTAMPTZ,
        scope TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // One booking page per user. working_hours gates which times of
    // day are ever offered (Google Calendar only tells us when the
    // user is *busy*, not when they're willing to take meetings at
    // all); destination_calendar_id is which of the user's Google
    // calendars a new booking actually gets created on — independent
    // of booking_calendars below, which is only about which calendars
    // are *read* for conflicts.
    await query(`
      CREATE TABLE IF NOT EXISTS booking_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT UNIQUE NOT NULL,
        title TEXT DEFAULT 'Book a meeting',
        description TEXT DEFAULT '',
        location TEXT DEFAULT '',
        slot_minutes INTEGER DEFAULT 30,
        min_notice_hours INTEGER DEFAULT 4,
        days_ahead INTEGER DEFAULT 30,
        timezone TEXT DEFAULT 'UTC',
        destination_calendar_id TEXT DEFAULT 'primary',
        working_hours JSONB DEFAULT '{"mon":{"enabled":true,"start":"09:00","end":"17:00"},"tue":{"enabled":true,"start":"09:00","end":"17:00"},"wed":{"enabled":true,"start":"09:00","end":"17:00"},"thu":{"enabled":true,"start":"09:00","end":"17:00"},"fri":{"enabled":true,"start":"09:00","end":"17:00"},"sat":{"enabled":false,"start":"09:00","end":"17:00"},"sun":{"enabled":false,"start":"09:00","end":"17:00"}}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Table already existed before destination_calendar_id shipped —
    // safe no-op once it's there.
    await query(`ALTER TABLE booking_settings ADD COLUMN IF NOT EXISTS destination_calendar_id TEXT DEFAULT 'primary'`);
    // Cached copy of the user's Google calendar list, so the Booking
    // tab has something to render instantly and so `included` (which
    // calendars feed into freebusy — see api/public-availability.js)
    // survives between visits. Re-synced from Google on every GET
    // /api/google-calendars; is_primary is what lets the UI flag "your
    // main calendar" and offer to exclude it, per the ask.
    await query(`
      CREATE TABLE IF NOT EXISTS booking_calendars (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        calendar_summary TEXT,
        is_primary BOOLEAN DEFAULT false,
        included BOOLEAN DEFAULT true,
        UNIQUE(user_id, calendar_id)
      )
    `);
    // One row per confirmed booking. google_calendar_id is whichever
    // calendar the event actually landed on (destination_calendar_id
    // at the time of booking), kept per-row since a user can change
    // that setting later without invalidating older bookings' cancel
    // path.
    await query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        contact_name TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        contact_timezone TEXT,
        notes TEXT,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        google_event_id TEXT,
        google_calendar_id TEXT DEFAULT 'primary',
        status TEXT DEFAULT 'confirmed',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await seedIfEmpty();
    await seedUsersIfMissing();
    // Owner is pinned to one specific email rather than being a role
    // anyone can grant — self-healing here (after seeding, so it also
    // catches a brand-new database where Henry's row didn't exist a
    // moment ago) means even a bad edit elsewhere can't strip it or
    // hand it to someone else.
    await query(`UPDATE users SET role = 'owner' WHERE email = $1 AND role IS DISTINCT FROM 'owner'`, [
      OWNER_EMAIL,
    ]);
  })();
  return schemaReady;
}

// Invite-only accounts: pre-seed the people allowed to ever log in,
// with no password set yet. Each one claims their account once via
// "set password" — anyone else's email just won't exist here, so
// there's no open self-registration. Roles for anyone invited this
// way default to 'admin' (see the users table's column default) —
// Henry's is corrected to 'owner' by the self-heal above regardless
// of what's written here.
const OWNER_EMAIL = "henryfortunatow@gmail.com";
const INVITED_USERS = [
  { name: "Henry", email: "henryfortunatow@gmail.com" },
  { name: "Jem", email: "jem.scalbl@gmail.com" },
  { name: "Cody", email: "codyadrury90@gmail.com" },
  { name: "Dave", email: "lorddave1513@gmail.com" },
];

async function seedUsersIfMissing() {
  for (const u of INVITED_USERS) {
    await query("INSERT INTO users (name, email) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING", [
      u.name,
      u.email,
    ]);
  }
}

// ---------- Seed data (same sample data the app shipped with) ----------
const SEED_CLIENTS = [
  {
    name: "Lux Solar",
    industry: "Solar",
    leads: 42,
    adsLive: true,
    script: "https://scripts.scalbl.io/lux-solar",
    scriptSteps: [
      "Introduce yourself and confirm you're calling about their battery rebate enquiry.",
      "Confirm they own the property and have north/west-facing roof space.",
      "Explain the current rebate amount and typical payback period.",
      "Offer a free site assessment and lock in a time.",
      "If hesitant, offer to send the rebate breakdown by email.",
    ],
  },
  {
    name: "Stoprent Properties",
    industry: "Property",
    leads: 31,
    adsLive: true,
    script: "https://scripts.scalbl.io/stoprent-properties",
    scriptSteps: [
      "Introduce yourself and confirm which listing they enquired about.",
      "Ask their preferred move-in date and household size.",
      "Confirm budget range and any must-have features.",
      "Offer an inspection time and confirm the best contact number.",
      "Send a calendar invite once a time is agreed.",
    ],
  },
  {
    name: "Silverloom Advisory",
    industry: "Finance",
    leads: 18,
    adsLive: true,
    script: "https://scripts.scalbl.io/silverloom-advisory",
    scriptSteps: [
      "Introduce yourself and confirm they requested a financial review.",
      "Ask what prompted the enquiry (super, investing, insurance, etc.).",
      "Briefly explain the free initial consultation and what it covers.",
      "Book a call with an advisor and confirm timezone.",
      "Note any sensitive details in Notes rather than over email.",
    ],
  },
  {
    name: "Lasertronics",
    industry: "Office Equipment",
    leads: 9,
    adsLive: false,
    script: "https://scripts.scalbl.io/lasertronics",
    scriptSteps: [
      "Introduce yourself and confirm the equipment they enquired about.",
      "Ask about current setup, page volume, and lease end date if any.",
      "Explain the current promo pricing and service inclusions.",
      "Offer to send a tailored quote by email.",
      "If no answer, leave a voicemail and log a follow-up for next week.",
    ],
  },
];

const SEED_CONTACTS = [
  {
    name: "Sarah Mitchell",
    email: "sarah.mitchell@gmail.com",
    phone: "0412 334 556",
    client: "Lux Solar",
    status: "New Lead",
    lastContact: "Today",
    notes: "Interested in the battery rebate, wants a quote by Friday.",
  },
  {
    name: "David Chen",
    email: "david.chen@outlook.com",
    phone: "0433 221 908",
    client: "Lux Solar",
    status: "Contacted",
    lastContact: "Yesterday",
    notes: "Asked to be called back after 5pm.",
  },
  {
    name: "Emma Taylor",
    email: "emma.taylor@bigpond.com",
    phone: "0401 887 234",
    client: "Stoprent Properties",
    status: "Booked",
    lastContact: "Mon",
    notes: "Confirmed inspection for Thursday 2pm.",
  },
  {
    name: "James Wilson",
    email: "james.wilson@yahoo.com",
    phone: "0455 112 763",
    client: "Silverloom Advisory",
    status: "New Lead",
    lastContact: "Today",
    notes: "Referred by an existing client, wants a callback.",
  },
  {
    name: "Priya Sharma",
    email: "priya.sharma@hotmail.com",
    phone: "0422 645 190",
    client: "Lasertronics",
    status: "No Answer",
    lastContact: "Tue",
    notes: "Left a voicemail, try again next week.",
  },
  {
    name: "Tom Nguyen",
    email: "tom.nguyen@gmail.com",
    phone: "0466 903 415",
    client: "Stoprent Properties",
    status: "Contacted",
    lastContact: "Today",
    notes: "Asking about deposit requirements.",
  },
];

async function seedIfEmpty() {
  const [{ count }] = await query("SELECT count(*)::int AS count FROM clients");
  if (count > 0) return;

  for (const c of SEED_CLIENTS) {
    await query(
      "INSERT INTO clients (name, industry, leads, ads_live, script, script_steps) VALUES ($1,$2,$3,$4,$5,$6)",
      [c.name, c.industry, c.leads, c.adsLive, c.script, JSON.stringify(c.scriptSteps)]
    );
  }

  for (const c of SEED_CONTACTS) {
    await query(
      "INSERT INTO contacts (name, email, phone, client, status, last_contact, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [c.name, c.email, c.phone, c.client, c.status, c.lastContact, c.notes]
    );
  }
  // Conversations are NOT seeded — they only appear once a real call
  // is logged, so the inbox starts empty rather than full of sample
  // chatter.
}

// ---------- Queries used by the API routes ----------

function clientFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    industry: r.industry,
    leads: r.leads,
    adsLive: r.ads_live,
    script: r.script,
    scriptSteps: r.script_steps || [],
    fields: r.fields || {},
  };
}

export async function getClients() {
  const rows = await query("SELECT * FROM clients ORDER BY id");
  return rows.map(clientFromRow);
}

export async function createClient(c) {
  const rows = await query(
    "INSERT INTO clients (name, industry, leads, ads_live, script, script_steps, fields) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [
      c.name,
      c.industry || null,
      c.leads || 0,
      c.adsLive || false,
      c.script || null,
      JSON.stringify(c.scriptSteps || []),
      JSON.stringify(c.fields || {}),
    ]
  );
  return clientFromRow(rows[0]);
}

// Patches a client's name and/or custom fields. `fields` is shallow-
// merged onto the existing JSONB blob so updating one cell doesn't
// clobber the others.
export async function updateClient(id, patch) {
  const rows = await query(
    `UPDATE clients SET
       name = COALESCE($2, name),
       fields = fields || $3::jsonb
     WHERE id = $1
     RETURNING *`,
    [id, patch.name ?? null, JSON.stringify(patch.fields || {})]
  );
  return rows[0] ? clientFromRow(rows[0]) : null;
}

export async function deleteClients(ids) {
  await query("DELETE FROM clients WHERE id = ANY($1::int[])", [ids]);
}

// ---------- Client table columns (dynamic schema) ----------

export async function getClientColumns() {
  const rows = await query("SELECT * FROM client_columns ORDER BY position, id");
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type,
    options: r.options || [],
    position: r.position,
  }));
}

const COLUMN_TYPES = ["text", "long_text", "number", "currency", "url", "date", "select", "checkbox"];

function slugifyColumnKey(label) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `field_${Date.now()}`
  );
}

export async function createClientColumn({ label, type, options }) {
  if (!COLUMN_TYPES.includes(type)) throw new Error(`Unknown column type: ${type}`);
  const key = slugifyColumnKey(label);
  const [{ next_position }] = await query(
    "SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM client_columns"
  );
  const rows = await query(
    "INSERT INTO client_columns (key, label, type, options, position) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [key, label, type, JSON.stringify(options || []), next_position]
  );
  const r = rows[0];
  return { id: r.id, key: r.key, label: r.label, type: r.type, options: r.options || [], position: r.position };
}

export async function deleteClientColumn(id) {
  await query("DELETE FROM client_columns WHERE id = $1", [id]);
}

// Wipes existing clients + column definitions and replaces them with
// the real client-list data imported from the team's CSV. Safe to
// re-run — it's a full reset, not an incremental merge.
export async function importClientData() {
  await query("DELETE FROM clients");
  await query("DELETE FROM client_columns");
  for (let i = 0; i < CLIENT_COLUMNS.length; i++) {
    const c = CLIENT_COLUMNS[i];
    await query(
      "INSERT INTO client_columns (key, label, type, options, position) VALUES ($1,$2,$3,$4,$5)",
      [c.key, c.label, c.type, JSON.stringify(c.options || []), i]
    );
  }
  for (const c of IMPORTED_CLIENTS) {
    await query("INSERT INTO clients (name, fields) VALUES ($1,$2)", [c.name, JSON.stringify(c.fields || {})]);
  }
  return { clients: IMPORTED_CLIENTS.length, columns: CLIENT_COLUMNS.length };
}

function contactFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    client: r.client,
    status: r.status,
    lastContact: r.last_contact,
    notes: r.notes,
    fields: r.fields || {},
    leadDate: r.lead_date,
    tag: r.tag,
    createdAt: r.created_at,
  };
}

// allowedTags scopes the result to a client-role user's own leads —
// pass null/undefined for full access (owner/super_admin/admin, and
// API keys).
export async function getContacts(allowedTags) {
  const rows = allowedTags
    ? await query("SELECT * FROM contacts WHERE tag = ANY($1::text[]) ORDER BY created_at DESC", [allowedTags])
    : await query("SELECT * FROM contacts ORDER BY created_at DESC");
  return rows.map(contactFromRow);
}

// Used by the API layer to check a client-role caller's tag access
// before letting them touch one specific contact (edit/delete).
export async function getContactById(id) {
  const rows = await query("SELECT * FROM contacts WHERE id = $1", [id]);
  return rows[0] ? contactFromRow(rows[0]) : null;
}

export async function createContact(c) {
  const rows = await query(
    "INSERT INTO contacts (name, email, phone, client, status, last_contact, notes, fields, lead_date, tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    [
      c.name,
      c.email || "",
      c.phone,
      c.client || "",
      c.status || "New Lead",
      c.lastContact || "Today",
      c.notes || "",
      JSON.stringify(c.fields || {}),
      c.leadDate || null,
      c.tag || null,
    ]
  );
  return contactFromRow(rows[0]);
}

// `fields` is shallow-merged onto the existing JSONB blob, same as
// updateClient, so patching one custom column doesn't clobber others.
export async function updateContact(id, patch) {
  const rows = await query(
    `UPDATE contacts SET
       status = COALESCE($2, status),
       notes = COALESCE($3, notes),
       last_contact = COALESCE($4, last_contact),
       fields = fields || $5::jsonb,
       lead_date = COALESCE($6, lead_date),
       tag = COALESCE($7, tag),
       phone = COALESCE($8, phone)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.status ?? null,
      patch.notes ?? null,
      patch.lastContact ?? null,
      JSON.stringify(patch.fields || {}),
      patch.leadDate ?? null,
      patch.tag ?? null,
      patch.phone ?? null,
    ]
  );
  return rows[0] ? contactFromRow(rows[0]) : null;
}

export async function deleteContacts(ids) {
  await query("DELETE FROM contacts WHERE id = ANY($1::int[])", [ids]);
}

// Used by /api/sms-bulk-send to resolve the selected contact ids to
// names/phones/tags right before sending, rather than trusting
// whatever the client had cached.
export async function getContactsByIds(ids) {
  if (!ids || !ids.length) return [];
  const rows = await query("SELECT * FROM contacts WHERE id = ANY($1::int[])", [ids]);
  return rows.map(contactFromRow);
}

// ---------- Contact table columns (dynamic schema, same pattern as
// client_columns) ----------

export async function getContactColumns() {
  const rows = await query("SELECT * FROM contact_columns ORDER BY position, id");
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type,
    options: r.options || [],
    position: r.position,
  }));
}

export async function createContactColumn({ label, type, options }) {
  if (!COLUMN_TYPES.includes(type)) throw new Error(`Unknown column type: ${type}`);
  const key = slugifyColumnKey(label);
  const [{ next_position }] = await query(
    "SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM contact_columns"
  );
  const rows = await query(
    "INSERT INTO contact_columns (key, label, type, options, position) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [key, label, type, JSON.stringify(options || []), next_position]
  );
  const r = rows[0];
  return { id: r.id, key: r.key, label: r.label, type: r.type, options: r.options || [], position: r.position };
}

export async function deleteContactColumn(id) {
  await query("DELETE FROM contact_columns WHERE id = $1", [id]);
}

// Changes an existing column's type/options/label in place — the
// values already stored in each contact's `fields` blob don't need
// to move, since type is purely a display/edit hint (e.g. retyping a
// column "text" -> "select" just changes how the same string values
// render). Looked up by key (e.g. "stage") since that's stable and
// human-guessable, unlike the numeric id. Whichever of label/type/
// options is passed gets updated; everything else is left as-is.
export async function updateContactColumnByKey(key, { label, type, options } = {}) {
  if (type && !COLUMN_TYPES.includes(type)) throw new Error(`Unknown column type: ${type}`);
  const rows = await query(
    `UPDATE contact_columns SET
       label = COALESCE($2, label),
       type = COALESCE($3, type),
       options = COALESCE($4, options)
     WHERE key = $1
     RETURNING *`,
    [key, label ?? null, type ?? null, options ? JSON.stringify(options) : null]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, key: r.key, label: r.label, type: r.type, options: r.options || [], position: r.position };
}

const IMPORT_SELECT_COLOR_CYCLE = ["blue", "green", "amber", "red", "purple", "gray"];

// Looks at the actual values a column took across an import batch and
// picks a reasonable column type for it — used so a bulk import of
// leads with wildly different question sets per source doesn't dump
// everything into generic text columns. Conservative on purpose: only
// promotes to "select" or "number" when the data clearly supports it,
// otherwise falls back to "text" (never guesses at date/currency/url,
// which are easy to get wrong from free-form sheet data).
function inferColumnType(values) {
  const nonEmpty = values.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (nonEmpty.length === 0) return { type: "text", options: [] };

  const distinct = Array.from(new Set(nonEmpty));
  if (distinct.length <= 8 && nonEmpty.length >= 3 && distinct.length < nonEmpty.length) {
    return {
      type: "select",
      options: distinct.map((value, i) => ({ value, color: IMPORT_SELECT_COLOR_CYCLE[i % IMPORT_SELECT_COLOR_CYCLE.length] })),
    };
  }
  if (nonEmpty.every((v) => /^-?\d+(\.\d+)?$/.test(v))) {
    return { type: "number", options: [] };
  }
  return { type: "text", options: [] };
}

// Bulk-imports contacts from an external source (e.g. a leads
// spreadsheet). Each record's `fields` keys become contact_columns
// automatically — reusing an existing column by key when the label
// matches one already created (so shared questions like "Notes"
// collapse onto one column instead of duplicating per source), and
// inferring a type for genuinely new ones from the values seen in
// this batch. Runs as plain sequential inserts, which is fine for a
// one-off admin import rather than a hot request path.
export async function importContactsBulk(records) {
  const existingColumns = await getContactColumns();
  const columnByKey = new Map(existingColumns.map((c) => [c.key, c]));

  // Collect every field key -> its values across the whole batch, for
  // columns that don't exist yet.
  const valuesByNewKey = new Map();
  for (const r of records) {
    for (const [label, value] of Object.entries(r.fields || {})) {
      const key = slugifyColumnKey(label);
      if (columnByKey.has(key)) continue;
      if (!valuesByNewKey.has(key)) valuesByNewKey.set(key, { label, values: [] });
      valuesByNewKey.get(key).values.push(value);
    }
  }

  const createdColumns = [];
  const [{ next_position }] = await query(
    "SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM contact_columns"
  );
  let position = next_position;
  for (const [key, { label, values }] of valuesByNewKey) {
    const { type, options } = inferColumnType(values);
    const rows = await query(
      "INSERT INTO contact_columns (key, label, type, options, position) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING RETURNING *",
      [key, label, type, JSON.stringify(options), position]
    );
    if (rows[0]) {
      const col = { id: rows[0].id, key, label, type, options, position };
      columnByKey.set(key, col);
      createdColumns.push(col);
      position += 1;
    }
  }

  let imported = 0;
  for (const r of records) {
    const fields = {};
    for (const [label, value] of Object.entries(r.fields || {})) {
      const col = columnByKey.get(slugifyColumnKey(label));
      if (col) fields[col.key] = value;
    }
    await query(
      "INSERT INTO contacts (name, email, phone, client, status, last_contact, notes, fields, lead_date, tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        r.name || "Unknown",
        r.email || "",
        r.phone || "",
        r.client || "",
        r.status || "New Lead",
        r.lastContact || "",
        r.notes || "",
        JSON.stringify(fields),
        r.leadDate || null,
        r.tag || null,
      ]
    );
    imported += 1;
  }

  return { imported, columnsCreated: createdColumns.length };
}

// One multi-row insert instead of 226 one-at-a-time — the latter was
// 226 sequential round trips sharing a request with the DELETEs and
// the first batch of contacts, which was enough on its own to blow
// past Vercel's timeout before a single lead got inserted.
async function seedContactColumnsForImport() {
  if (!CONTACT_COLUMNS.length) return;
  const placeholders = [];
  const params = [];
  CONTACT_COLUMNS.forEach((c, i) => {
    const base = i * 5;
    placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
    params.push(c.key, c.label, c.type, JSON.stringify(c.options || []), i);
  });
  await query(
    `INSERT INTO contact_columns (key, label, type, options, position) VALUES ${placeholders.join(",")}`,
    params
  );
}

// Inserts a batch of already-shaped contact rows in chunks of 300 —
// one query per row would be needlessly slow for a few thousand rows.
async function insertContactRows(rows) {
  const COLS_PER_ROW = 10;
  const BATCH_SIZE = 300;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = [];
    const params = [];
    batch.forEach((c, idx) => {
      const base = idx * COLS_PER_ROW;
      const ph = Array.from({ length: COLS_PER_ROW }, (_, k) => `$${base + k + 1}`).join(",");
      placeholders.push(`(${ph})`);
      params.push(
        c.name || "Unknown",
        c.email || "",
        c.phone || "",
        c.client || "",
        c.status || "New Lead",
        c.lastContact || "",
        c.notes || "",
        JSON.stringify(c.fields || {}),
        c.leadDate || null,
        c.tag || null
      );
    });
    await query(
      `INSERT INTO contacts (name, email, phone, client, status, last_contact, notes, fields, lead_date, tag) VALUES ${placeholders.join(",")}`,
      params
    );
  }
}

// Wipes existing contacts + column definitions and seeds the column
// list fresh — its own step, called once before any row-inserting
// calls, so a wipe never has to share a request (and its slice of
// Vercel's timeout) with actually inserting leads.
export async function resetContactImport() {
  await query("DELETE FROM contacts");
  await query("DELETE FROM contact_columns");
  await seedContactColumnsForImport();
  return { total: IMPORTED_CONTACTS.length, columns: CONTACT_COLUMNS.length };
}

// Inserts one page of the real lead data imported from the team's
// spreadsheet — call resetContactImport() once first, then this
// repeatedly with increasing offsets. Paginated specifically so each
// call finishes well inside Vercel's serverless request timeout — a
// single request trying to insert all ~6,500 rows (or even just
// wiping + seeding 226 columns one at a time) in one go was hitting
// a 504.
export async function importContactDataBatch({ offset = 0, limit = 500 } = {}) {
  const slice = IMPORTED_CONTACTS.slice(offset, offset + limit);
  await insertContactRows(slice);
  const nextOffset = offset + slice.length;
  return {
    inserted: slice.length,
    nextOffset,
    total: IMPORTED_CONTACTS.length,
    done: nextOffset >= IMPORTED_CONTACTS.length,
  };
}

// Full, single-shot import — fine for local dev (no request timeout
// to worry about), but risks a 504 if called against the deployed
// site for a batch this large. Prefer resetContactImport() +
// importContactDataBatch() there.
export async function importContactData() {
  await resetContactImport();
  await insertContactRows(IMPORTED_CONTACTS);
  return { contacts: IMPORTED_CONTACTS.length, columns: CONTACT_COLUMNS.length };
}

// Strips a phone number down to just its Australian local digits
// (drops the country code / leading 0) so a locally-formatted number
// like "0412 334 556" and Twilio's E.164 "+61412334556" compare equal.
function normalizeAuPhoneDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("61")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

// Matches an inbound SMS's From number to a contact, for logging it
// onto the right conversation.
export async function findContactByPhone(rawPhone) {
  const target = normalizeAuPhoneDigits(rawPhone);
  if (!target) return null;
  const rows = await query("SELECT * FROM contacts");
  const match = rows.find((r) => normalizeAuPhoneDigits(r.phone) === target);
  return match ? contactFromRow(match) : null;
}

// allowedTags scopes this to conversations for leads the caller can
// see (client role only) — dropping any conversation with no matching
// contact (e.g. SMS from an unrecognized number), since those aren't
// attributable to any client's leads.
export async function getConversations(allowedTags) {
  const convos = allowedTags
    ? await query(
        `SELECT c.* FROM conversations c
         JOIN contacts ct ON ct.id = c.lead_id
         WHERE ct.tag = ANY($1::text[])
         ORDER BY c.updated_at DESC`,
        [allowedTags]
      )
    : await query("SELECT * FROM conversations ORDER BY updated_at DESC");
  const messages = convos.length
    ? await query("SELECT * FROM messages WHERE conversation_id = ANY($1::int[]) ORDER BY id ASC", [
        convos.map((c) => c.id),
      ])
    : [];
  return convos.map((c) => ({
    id: c.id,
    leadId: c.lead_id,
    name: c.name,
    preview: c.preview,
    time: c.time_label,
    unread: c.unread,
    messages: messages
      .filter((m) => m.conversation_id === c.id)
      .map((m) => ({ id: m.id, type: m.type, text: m.text, time: m.time_label, outgoing: m.outgoing })),
  }));
}

// Logs one message onto a lead's conversation — creates the
// conversation if one doesn't exist yet, otherwise appends and bumps
// it. Shared by call logging, outbound SMS, and inbound SMS.
// `leadId` may be null (SMS from a number with no matching contact) —
// in that case conversations are matched/created by `name` instead.
export async function logMessage({ leadId, name, text, time, type = "text", outgoing = false }) {
  const existingRows = leadId
    ? await query("SELECT id FROM conversations WHERE lead_id = $1", [leadId])
    : await query("SELECT id FROM conversations WHERE lead_id IS NULL AND name = $1", [name]);
  let conversationId = existingRows[0]?.id;
  if (!conversationId) {
    const rows = await query(
      "INSERT INTO conversations (lead_id, name, preview, time_label, unread) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [leadId, name, text, time, !outgoing]
    );
    conversationId = rows[0].id;
  } else {
    await query(
      "UPDATE conversations SET preview = $2, time_label = $3, unread = $4, updated_at = now() WHERE id = $1",
      [conversationId, text, time, !outgoing]
    );
  }
  await query("INSERT INTO messages (conversation_id, type, text, time_label, outgoing) VALUES ($1,$2,$3,$4,$5)", [
    conversationId,
    type,
    text,
    time,
    outgoing,
  ]);
  return conversationId;
}

// Logs a call onto a lead's conversation — thin wrapper around
// logMessage kept for backwards-compat call sites.
export async function logCall({ leadId, name, text, time, type = "call" }) {
  return logMessage({ leadId, name, text, time, type, outgoing: true });
}

export async function deleteConversations(ids) {
  await query("DELETE FROM conversations WHERE id = ANY($1::int[])", [ids]);
}

export async function getDialLists() {
  const rows = await query("SELECT * FROM dial_lists ORDER BY created_at");
  return rows.map((r) => ({ id: r.id, name: r.name, leadIds: r.lead_ids || [] }));
}

export async function createDialList(name, leadIds) {
  const rows = await query("INSERT INTO dial_lists (name, lead_ids) VALUES ($1,$2) RETURNING *", [
    name,
    JSON.stringify(leadIds),
  ]);
  return { id: rows[0].id, name: rows[0].name, leadIds: rows[0].lead_ids || [] };
}

export async function deleteDialList(id) {
  await query("DELETE FROM dial_lists WHERE id = $1", [id]);
}

// Merges leadIds into an existing dial list (deduped) — used by
// "Add to Powerlist" on the Contacts page, as opposed to
// createDialList which always makes a new one.
export async function addLeadsToDialList(id, leadIds) {
  const rows = await query("SELECT lead_ids FROM dial_lists WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const merged = Array.from(new Set([...(rows[0].lead_ids || []), ...leadIds]));
  const updated = await query("UPDATE dial_lists SET lead_ids = $2 WHERE id = $1 RETURNING *", [
    id,
    JSON.stringify(merged),
  ]);
  return { id: updated[0].id, name: updated[0].name, leadIds: updated[0].lead_ids || [] };
}

// Removes a lead from every Powerlist it's currently in — called once
// a call to that lead actually completes, so a list's own leadIds
// always just *is* the "still to call" queue: no separate called/
// not-called flag to keep in sync with it.
export async function removeLeadFromDialLists(leadId) {
  const rows = await query("SELECT id, lead_ids FROM dial_lists WHERE lead_ids @> $1::jsonb", [
    JSON.stringify([leadId]),
  ]);
  for (const row of rows) {
    const next = (row.lead_ids || []).filter((id) => id !== leadId);
    await query("UPDATE dial_lists SET lead_ids = $2 WHERE id = $1", [row.id, JSON.stringify(next)]);
  }
}

export async function getCalledLeadIds() {
  const rows = await query("SELECT lead_id FROM called_leads");
  return rows.map((r) => r.lead_id);
}

export async function markLeadCalled(leadId) {
  await query("INSERT INTO called_leads (lead_id) VALUES ($1) ON CONFLICT DO NOTHING", [leadId]);
}

function callLogFromRow(r) {
  return {
    id: r.id,
    leadId: r.lead_id,
    name: r.name,
    phone: r.phone,
    client: r.client,
    tag: r.tag,
    status: r.status,
    notes: r.notes,
    userId: r.user_id,
    userName: r.user_name,
    durationSeconds: r.duration_seconds,
    calledAt: r.called_at,
  };
}

export async function getCallLog(allowedTags) {
  const rows = allowedTags
    ? await query("SELECT * FROM call_log WHERE tag = ANY($1::text[]) ORDER BY called_at DESC", [allowedTags])
    : await query("SELECT * FROM call_log ORDER BY called_at DESC");
  return rows.map(callLogFromRow);
}

export async function addCallLogEntry(entry) {
  const rows = await query(
    `INSERT INTO call_log (lead_id, name, phone, client, tag, status, notes, user_id, user_name, duration_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      entry.leadId,
      entry.name,
      entry.phone,
      entry.client,
      entry.tag ?? null,
      entry.status,
      entry.notes,
      entry.userId ?? null,
      entry.userName ?? null,
      entry.durationSeconds ?? null,
    ]
  );
  return callLogFromRow(rows[0]);
}

// ---------- Users ----------

export async function getUserByEmail(email) {
  const rows = await query("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase().trim()]);
  return rows[0] || null;
}

// Sets a user's password — but only if one isn't already set. That's
// what makes this "claim your invited account" rather than "reset
// anyone's password": once password_hash is non-null, this is a
// no-op (returns null), and the normal login flow takes over.
export async function claimUserPassword(email, passwordHash) {
  const rows = await query(
    "UPDATE users SET password_hash = $2 WHERE email = $1 AND password_hash IS NULL RETURNING *",
    [String(email).toLowerCase().trim(), passwordHash]
  );
  return rows[0] || null;
}

function userFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role || "admin",
    allowedTags: r.allowed_tags || [],
    hasPassword: Boolean(r.password_hash),
    createdAt: r.created_at,
  };
}

export async function getUserById(id) {
  const rows = await query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

// For the Settings → Users list. Never returns password_hash.
export async function getUsers() {
  const rows = await query("SELECT * FROM users ORDER BY created_at ASC");
  return rows.map(userFromRow);
}

// Invites a new user (no password yet — they claim the account the
// same way INVITED_USERS does). role defaults to 'admin'; 'owner' is
// rejected here — see server/auth.js, which enforces that only the
// one hardcoded owner email can ever hold that role.
export async function inviteUser({ name, email, role, allowedTags }) {
  const rows = await query(
    `INSERT INTO users (name, email, role, allowed_tags) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    [name, String(email).toLowerCase().trim(), role || "admin", JSON.stringify(allowedTags || [])]
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function updateUser(id, { name, role, allowedTags }) {
  const rows = await query(
    `UPDATE users SET
       name = COALESCE($2, name),
       role = COALESCE($3, role),
       allowed_tags = COALESCE($4::jsonb, allowed_tags)
     WHERE id = $1 RETURNING *`,
    [id, name ?? null, role ?? null, allowedTags ? JSON.stringify(allowedTags) : null]
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function deleteUserById(id) {
  await query("DELETE FROM users WHERE id = $1", [id]);
}

// ---------- API key (single global credential) ----------
// Exactly one key exists at a time — it's both the Bearer/X-Api-Key
// for programmatic CRM access (see server/auth.js) and the ?token= on
// the public /api/lead-webhook endpoint. There's no per-tag token
// anymore: a lead posted through the webhook carries its own tag in
// the payload instead of the tag being implied by which token was
// used. raw_key is kept in the clear (alongside key_hash, still used
// to verify it) so Settings can always display the current key rather
// than only once at creation.

function apiKeyFromRow(r) {
  return {
    id: r.id,
    key: r.raw_key,
    keyPrefix: r.key_prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    createdByName: r.created_by_name,
  };
}

export async function getApiKey() {
  const rows = await query(
    "SELECT ak.*, u.name AS created_by_name FROM api_keys ak " +
      "LEFT JOIN users u ON u.id = ak.created_by ORDER BY ak.created_at DESC LIMIT 1"
  );
  return rows[0] ? apiKeyFromRow(rows[0]) : null;
}

// Replaces whatever key exists (if any) with a brand-new one —
// covers both "generate the first key" and "regenerate it", since
// only one row is ever allowed to exist.
export async function regenerateApiKey({ key, keyHash, keyPrefix, createdBy }) {
  await query("DELETE FROM api_keys");
  const rows = await query(
    "INSERT INTO api_keys (label, key_hash, key_prefix, raw_key, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    ["CRM API key", keyHash, keyPrefix, key, createdBy || null]
  );
  const created = rows[0];
  const withName = createdBy ? await getUserById(createdBy) : null;
  return apiKeyFromRow({ ...created, created_by_name: withName?.name || null });
}

export async function deleteApiKey() {
  await query("DELETE FROM api_keys");
}

export async function findApiKeyByHash(keyHash) {
  const rows = await query("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash]);
  return rows[0] || null;
}

export async function touchApiKeyLastUsed(id) {
  await query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [id]);
}

// ---------- Multi-line dialling ----------
// "Dial N leads at once, whoever answers first gets bridged to the
// rep, the rest get hung up" — see server/twilioCore.js for the
// conference TwiML and api/multiline-*.js for the endpoints that use
// these. A batch's calls only ever end in one of these statuses:
// placed | ringing | in-progress | completed | busy | failed |
// no-answer | canceled — the first three are "still live", the rest
// are terminal.
const MULTILINE_TERMINAL_STATUSES = ["completed", "busy", "failed", "no-answer", "canceled"];

export async function createMultilineBatch({ conferenceName, createdBy }) {
  const rows = await query(
    "INSERT INTO multiline_batches (conference_name, created_by) VALUES ($1,$2) RETURNING *",
    [conferenceName, createdBy || null]
  );
  return rows[0];
}

// Inserted before the Twilio call is placed — its id gets embedded in
// that call's TwiML/status-callback URLs, then setMultilineBatchCallSid
// fills in the resulting call_sid once Twilio hands one back.
export async function addMultilineBatchCall({ batchId, leadId, name, phone, fromNumber }) {
  const rows = await query(
    "INSERT INTO multiline_batch_calls (batch_id, lead_id, name, phone, from_number) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [batchId, leadId, name, phone, fromNumber || null]
  );
  return rows[0];
}

export async function setMultilineBatchCallSid(rowId, callSid) {
  await query("UPDATE multiline_batch_calls SET call_sid = $2, status = 'ringing' WHERE id = $1", [rowId, callSid]);
}

export async function updateMultilineBatchCallStatusByRowId(rowId, status) {
  await query("UPDATE multiline_batch_calls SET status = $2 WHERE id = $1", [rowId, status]);
}

// Records why a leg never actually made it out — Twilio rejecting the
// call.create() request itself (bad number format, an unverified
// number on a trial account, geo permissions, …), as opposed to a
// normal ring-then-no-answer. Surfaced on the Multi Line tab so "did
// the call even go through" has a real answer instead of just a
// stuck "Dialling…" or a bare "Failed".
export async function setMultilineBatchCallFailed(rowId, errorMessage) {
  await query("UPDATE multiline_batch_calls SET status = 'failed', error_message = $2 WHERE id = $1", [
    rowId,
    String(errorMessage || "").slice(0, 500),
  ]);
}

// The whole feature's concurrency-safety hinges on this one atomic
// UPDATE: whichever of a batch's calls reaches "answered" first is
// the only one that can ever successfully set winner_call_sid (the
// WHERE clause makes every later attempt a no-op that returns no
// row), so two legs racing to claim it can never both win.
export async function claimMultilineWinner({ batchId, callSid, leadId }) {
  const rows = await query(
    "UPDATE multiline_batches SET winner_call_sid = $2, winner_lead_id = $3 WHERE id = $1 AND winner_call_sid IS NULL RETURNING *",
    [batchId, callSid, leadId]
  );
  return rows[0] || null;
}

// Every other leg in the batch still in a non-terminal state once a
// winner's been claimed (or the rep bailed out before anyone
// answered) — these all need to be hung up/cancelled.
export async function getOtherPendingMultilineBatchCalls(batchId, excludeCallSid) {
  const rows = await query(
    `SELECT * FROM multiline_batch_calls
     WHERE batch_id = $1 AND status NOT IN (${MULTILINE_TERMINAL_STATUSES.map((_, i) => `$${i + 3}`).join(",")})
       AND ($2::text IS NULL OR call_sid IS DISTINCT FROM $2)`,
    [batchId, excludeCallSid || null, ...MULTILINE_TERMINAL_STATUSES]
  );
  return rows;
}

// Polled by the frontend while a batch is in flight. status is
// derived rather than stored: 'connected' once a winner's been
// claimed, 'no-answer' once every leg has reached a terminal state
// with nobody winning, otherwise still 'dialing'.
export async function getMultilineBatchWithCalls(id) {
  const batches = await query("SELECT * FROM multiline_batches WHERE id = $1", [id]);
  const batch = batches[0];
  if (!batch) return null;
  const calls = await query("SELECT * FROM multiline_batch_calls WHERE batch_id = $1 ORDER BY id", [id]);
  const status = batch.winner_call_sid
    ? "connected"
    : calls.length && calls.every((c) => MULTILINE_TERMINAL_STATUSES.includes(c.status))
    ? "no-answer"
    : "dialing";
  const winnerCall = batch.winner_call_sid ? calls.find((c) => c.call_sid === batch.winner_call_sid) : null;
  return {
    id: batch.id,
    status,
    winner: winnerCall
      ? { leadId: batch.winner_lead_id, name: winnerCall.name, phone: winnerCall.phone, fromNumber: winnerCall.from_number }
      : null,
    calls: calls.map((c) => ({
      leadId: c.lead_id,
      name: c.name,
      phone: c.phone,
      fromNumber: c.from_number,
      status: c.status,
      errorMessage: c.error_message,
    })),
  };
}

// ---------- Soundboard clips ----------
// Shared across the whole team (not per-rep) — recorded once,
// available to anyone on a live call.

function soundboardClipFromRow(r) {
  return {
    id: r.id,
    label: r.label,
    audioData: r.audio_data,
    mimeType: r.mime_type,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

export async function getSoundboardClips() {
  const rows = await query(
    "SELECT sc.*, u.name AS created_by_name FROM soundboard_clips sc " +
      "LEFT JOIN users u ON u.id::text = sc.created_by ORDER BY sc.created_at ASC"
  );
  return rows.map(soundboardClipFromRow);
}

export async function createSoundboardClip({ label, audioData, mimeType, createdBy }) {
  const rows = await query(
    "INSERT INTO soundboard_clips (label, audio_data, mime_type, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [label, audioData, mimeType, createdBy || null]
  );
  return soundboardClipFromRow(rows[0]);
}

export async function deleteSoundboardClip(id) {
  await query("DELETE FROM soundboard_clips WHERE id = $1", [id]);
}

// ---------- Booking (Google Calendar) ----------

export function slugify(str) {
  const s = String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return s || "user";
}

export async function isBookingSlugTaken(slug) {
  const rows = await query("SELECT 1 FROM booking_settings WHERE slug = $1", [slug]);
  return rows.length > 0;
}

// Appends -2, -3, … the first time a name collides — collisions are
// rare (first-name based) but two reps can share a first name.
export async function generateUniqueBookingSlug(base) {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  while (await isBookingSlugTaken(candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

export async function getGoogleConnectionByUserId(userId) {
  const rows = await query("SELECT * FROM google_connections WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

// refresh_token is only overwritten when Google actually sends a new
// one — it doesn't re-issue one on every token refresh, only on
// consent — so a null here must never clobber an existing value.
export async function upsertGoogleConnection({ userId, googleEmail, accessToken, refreshToken, expiresAt, scope }) {
  const rows = await query(
    `INSERT INTO google_connections (user_id, google_email, access_token, refresh_token, token_expiry, scope, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       google_email = EXCLUDED.google_email,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, google_connections.refresh_token),
       token_expiry = EXCLUDED.token_expiry,
       scope = EXCLUDED.scope,
       updated_at = now()
     RETURNING *`,
    [userId, googleEmail, accessToken, refreshToken || null, expiresAt, scope || null]
  );
  return rows[0];
}

export async function updateGoogleConnectionTokens(userId, { accessToken, expiresAt }) {
  const rows = await query(
    "UPDATE google_connections SET access_token = $2, token_expiry = $3, updated_at = now() WHERE user_id = $1 RETURNING *",
    [userId, accessToken, expiresAt]
  );
  return rows[0] || null;
}

// Disconnecting drops the cached calendar list too — it's meaningless
// without a live connection, and re-connecting re-syncs it fresh.
export async function deleteGoogleConnection(userId) {
  await query("DELETE FROM google_connections WHERE user_id = $1", [userId]);
  await query("DELETE FROM booking_calendars WHERE user_id = $1", [userId]);
}

export async function getBookingSettingsByUserId(userId) {
  const rows = await query("SELECT * FROM booking_settings WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

export async function getBookingSettingsBySlug(slug) {
  const rows = await query("SELECT * FROM booking_settings WHERE slug = $1", [slug]);
  return rows[0] || null;
}

export async function createBookingSettings({ userId, slug, timezone }) {
  const rows = await query(
    `INSERT INTO booking_settings (user_id, slug, timezone) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO NOTHING RETURNING *`,
    [userId, slug, timezone || "UTC"]
  );
  if (rows[0]) return rows[0];
  return getBookingSettingsByUserId(userId); // lost the race to create it — read what's there
}

const BOOKING_SETTINGS_COLUMNS = {
  title: "title",
  description: "description",
  location: "location",
  slotMinutes: "slot_minutes",
  minNoticeHours: "min_notice_hours",
  daysAhead: "days_ahead",
  timezone: "timezone",
  destinationCalendarId: "destination_calendar_id",
  workingHours: "working_hours",
};

export async function updateBookingSettings(userId, patch) {
  const setClauses = [];
  const values = [userId];
  for (const [key, column] of Object.entries(BOOKING_SETTINGS_COLUMNS)) {
    if (patch[key] === undefined) continue;
    const isJson = key === "workingHours";
    values.push(isJson ? JSON.stringify(patch[key]) : patch[key]);
    setClauses.push(`${column} = $${values.length}${isJson ? "::jsonb" : ""}`);
  }
  if (!setClauses.length) return getBookingSettingsByUserId(userId);
  const rows = await query(
    `UPDATE booking_settings SET ${setClauses.join(", ")}, updated_at = now() WHERE user_id = $1 RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function getBookingCalendars(userId) {
  return query(
    "SELECT * FROM booking_calendars WHERE user_id = $1 ORDER BY is_primary DESC, calendar_summary ASC",
    [userId]
  );
}

// Re-syncs the cached calendar list from a fresh Google response,
// preserving each existing calendar's `included` flag (a newly-seen
// calendar defaults to included — the user excludes it, including
// their primary one, explicitly). Calendars Google no longer returns
// (removed/unsubscribed) are dropped.
export async function syncBookingCalendars(userId, googleCalendars) {
  const existing = await getBookingCalendars(userId);
  const existingById = new Map(existing.map((c) => [c.calendar_id, c]));
  const seen = new Set();
  for (const cal of googleCalendars) {
    seen.add(cal.id);
    const prior = existingById.get(cal.id);
    await query(
      `INSERT INTO booking_calendars (user_id, calendar_id, calendar_summary, is_primary, included)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, calendar_id) DO UPDATE SET
         calendar_summary = EXCLUDED.calendar_summary,
         is_primary = EXCLUDED.is_primary`,
      [userId, cal.id, cal.summary, cal.primary, prior ? prior.included : true]
    );
  }
  for (const c of existing) {
    if (!seen.has(c.calendar_id)) await query("DELETE FROM booking_calendars WHERE id = $1", [c.id]);
  }
  return getBookingCalendars(userId);
}

export async function setBookingCalendarIncluded(userId, calendarId, included) {
  const rows = await query(
    "UPDATE booking_calendars SET included = $3 WHERE user_id = $1 AND calendar_id = $2 RETURNING *",
    [userId, calendarId, included]
  );
  return rows[0] || null;
}

export async function createBooking(b) {
  const rows = await query(
    `INSERT INTO bookings
       (user_id, contact_name, contact_email, contact_timezone, notes, start_at, end_at, google_event_id, google_calendar_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed') RETURNING *`,
    [
      b.userId,
      b.contactName,
      b.contactEmail,
      b.contactTimezone || null,
      b.notes || null,
      b.startAt,
      b.endAt,
      b.googleEventId || null,
      b.googleCalendarId || "primary",
    ]
  );
  return rows[0];
}

export async function getBookingsForUser(userId) {
  return query("SELECT * FROM bookings WHERE user_id = $1 ORDER BY start_at DESC LIMIT 200", [userId]);
}

export async function getBookingById(id) {
  const rows = await query("SELECT * FROM bookings WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function updateBookingStatus(id, status) {
  const rows = await query("UPDATE bookings SET status = $2 WHERE id = $1 RETURNING *", [id, status]);
  return rows[0] || null;
}
