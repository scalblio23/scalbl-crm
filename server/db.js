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
    // ---------- Calendars (Google-connected booking calendars) ----------
    // One row per bookable calendar (a rep/team can have more than
    // one, e.g. "Sales call" vs "Onboarding call"). `availability` is
    // a per-weekday map of time ranges in the calendar's own
    // `timezone`, e.g. {"mon":[{"start":"09:00","end":"17:00"}]} — see
    // server/calendarAvailability.js for how it's turned into actual
    // bookable slots. The google_* columns hold the OAuth tokens for
    // whichever Google account was connected via "Integrate with
    // Google" (see server/googleCalendar.js) — stored in the clear,
    // same as api_keys.raw_key above; there's no separate secrets
    // store in this app.
    await query(`
      CREATE TABLE IF NOT EXISTS calendars (
        id SERIAL PRIMARY KEY,
        owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        event_length_minutes INTEGER NOT NULL DEFAULT 30,
        buffer_minutes INTEGER NOT NULL DEFAULT 0,
        min_notice_hours INTEGER NOT NULL DEFAULT 4,
        booking_window_days INTEGER NOT NULL DEFAULT 30,
        max_bookings_per_day INTEGER,
        availability JSONB NOT NULL DEFAULT '{}',
        google_connected BOOLEAN NOT NULL DEFAULT false,
        google_email TEXT,
        google_access_token TEXT,
        google_refresh_token TEXT,
        google_token_expiry TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Which calendar on the connected Google account events get
    // created on/checked for conflicts against — added after the
    // table first shipped (was hardcoded to "primary"), so existing
    // rows default to the same behavior they already had.
    await query(`ALTER TABLE calendars ADD COLUMN IF NOT EXISTS google_calendar_id TEXT NOT NULL DEFAULT 'primary'`);
    // One row per booked slot on a calendar. booker_timezone is the
    // timezone the visitor had selected in the widget at booking time
    // (purely for display in the confirmation email/SMS — start_time/
    // end_time are always stored in UTC). cancel_token is a bearer
    // token embedded in the confirmation email's cancel link, so a
    // booker can cancel without an account. The partial unique index
    // below is what actually prevents double-booking under a race —
    // the availability check alone is a best-effort filter, not a
    // guarantee, once two people can hit "book" on the same slot at
    // the same moment.
    await query(`
      CREATE TABLE IF NOT EXISTS calendar_bookings (
        id SERIAL PRIMARY KEY,
        calendar_id INTEGER REFERENCES calendars(id) ON DELETE CASCADE,
        contact_name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        notes TEXT,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        booker_timezone TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed',
        google_event_id TEXT,
        cancel_token TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS calendar_bookings_no_double_book
      ON calendar_bookings (calendar_id, start_time)
      WHERE status = 'confirmed'
    `);
    // ---------- Automations ----------
    // One trigger + an ordered list of actions, same linear shape as
    // GoHighLevel's workflow builder (no branching in this first
    // version). trigger_type is nullable — a freshly-created
    // automation starts unconfigured until its builder is filled in
    // and saved (see server/automations.js for how trigger_config and
    // actions are actually interpreted).
    await query(`
      CREATE TABLE IF NOT EXISTS automations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_type TEXT,
        trigger_config JSONB NOT NULL DEFAULT '{}',
        actions JSONB NOT NULL DEFAULT '[]',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // One row per in-progress (or finished) firing of an automation.
    // Exists because "wait" steps mean an automation can't just run
    // start-to-finish inside the request that triggered it — a
    // serverless function doesn't live long enough to sleep for hours
    // or days. Instead each firing is a durable row: `context` is a
    // snapshot of the trigger's data (contact, calendar, appointment
    // time, …) taken once at trigger time, `next_step_index` is how
    // far through the automation's `actions` array it's gotten, and
    // `run_at` is when it's next due to be advanced — either "now"
    // (nothing to wait on) or the target time a "wait" step computed.
    // See server/automations.js for how a run is actually advanced,
    // and api/automations-process-runs.js for what moves it forward
    // once its wait is up.
    await query(`
      CREATE TABLE IF NOT EXISTS automation_runs (
        id SERIAL PRIMARY KEY,
        automation_id INTEGER REFERENCES automations(id) ON DELETE CASCADE,
        context JSONB NOT NULL DEFAULT '{}',
        next_step_index INTEGER NOT NULL DEFAULT 0,
        run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
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

// ---------- Calendars ----------

function calendarFromRow(r, { includeSecrets = false } = {}) {
  const base = {
    id: r.id,
    ownerUserId: r.owner_user_id,
    name: r.name,
    slug: r.slug,
    description: r.description || "",
    timezone: r.timezone,
    eventLengthMinutes: r.event_length_minutes,
    bufferMinutes: r.buffer_minutes,
    minNoticeHours: r.min_notice_hours,
    bookingWindowDays: r.booking_window_days,
    maxBookingsPerDay: r.max_bookings_per_day,
    availability: r.availability || {},
    googleConnected: r.google_connected,
    googleEmail: r.google_email,
    googleCalendarId: r.google_calendar_id || "primary",
    active: r.active,
    createdAt: r.created_at,
  };
  // Access/refresh tokens never leave the server — only
  // server/googleCalendar.js reads them directly off the DB row.
  if (includeSecrets) {
    base.googleAccessToken = r.google_access_token;
    base.googleRefreshToken = r.google_refresh_token;
    base.googleTokenExpiry = r.google_token_expiry;
  }
  return base;
}

function slugifyCalendarName(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "calendar"}-${crypto.randomBytes(3).toString("hex")}`;
}

const DEFAULT_AVAILABILITY = {
  mon: [{ start: "09:00", end: "17:00" }],
  tue: [{ start: "09:00", end: "17:00" }],
  wed: [{ start: "09:00", end: "17:00" }],
  thu: [{ start: "09:00", end: "17:00" }],
  fri: [{ start: "09:00", end: "17:00" }],
  sat: [],
  sun: [],
};

export async function getCalendars() {
  const rows = await query("SELECT * FROM calendars ORDER BY created_at ASC");
  return rows.map((r) => calendarFromRow(r));
}

export async function getCalendarById(id, opts) {
  const rows = await query("SELECT * FROM calendars WHERE id = $1", [id]);
  return rows[0] ? calendarFromRow(rows[0], opts) : null;
}

// Used by the public booking endpoints — looked up by slug rather
// than id, and only ever needs the row itself (callers decide what
// to expose to the visitor).
export async function getCalendarBySlug(slug, opts) {
  const rows = await query("SELECT * FROM calendars WHERE slug = $1", [slug]);
  return rows[0] ? calendarFromRow(rows[0], opts) : null;
}

export async function createCalendar({ name, ownerUserId }) {
  const slug = slugifyCalendarName(name);
  const rows = await query(
    `INSERT INTO calendars (owner_user_id, name, slug, availability)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [ownerUserId || null, name, slug, JSON.stringify(DEFAULT_AVAILABILITY)]
  );
  return calendarFromRow(rows[0]);
}

// Settings patch from the Calendar settings panel — every field is
// optional so the frontend can save one section (Timezone, Booking
// rules, Availability, …) at a time without resending the rest.
export async function updateCalendar(id, patch) {
  const rows = await query(
    `UPDATE calendars SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       timezone = COALESCE($4, timezone),
       event_length_minutes = COALESCE($5, event_length_minutes),
       buffer_minutes = COALESCE($6, buffer_minutes),
       min_notice_hours = COALESCE($7, min_notice_hours),
       booking_window_days = COALESCE($8, booking_window_days),
       -- max_bookings_per_day is nullable *by design* (null = no
       -- limit), so it can't use the COALESCE(new, existing) trick
       -- every other field above uses — that would make "explicitly
       -- clear the limit" indistinguishable from "field wasn't part
       -- of this patch". $9 says which case this is.
       max_bookings_per_day = CASE WHEN $9 THEN $10 ELSE max_bookings_per_day END,
       availability = COALESCE($11::jsonb, availability),
       active = COALESCE($12, active),
       google_calendar_id = COALESCE($13, google_calendar_id)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.description ?? null,
      patch.timezone ?? null,
      patch.eventLengthMinutes ?? null,
      patch.bufferMinutes ?? null,
      patch.minNoticeHours ?? null,
      patch.bookingWindowDays ?? null,
      Object.prototype.hasOwnProperty.call(patch, "maxBookingsPerDay"),
      patch.maxBookingsPerDay ?? null,
      patch.availability ? JSON.stringify(patch.availability) : null,
      patch.active ?? null,
      patch.googleCalendarId ?? null,
    ]
  );
  return rows[0] ? calendarFromRow(rows[0]) : null;
}

export async function deleteCalendar(id) {
  await query("DELETE FROM calendars WHERE id = $1", [id]);
}

// Called once the OAuth callback exchanges a code for tokens. Google
// only returns a refresh_token on the very first consent (or when
// prompt=consent forces re-consent) — reconnecting without a new
// refresh_token keeps the old one rather than wiping it out.
export async function setCalendarGoogleTokens(id, { googleEmail, accessToken, refreshToken, expiry }) {
  const rows = await query(
    `UPDATE calendars SET
       google_connected = true,
       google_email = $2,
       google_access_token = $3,
       google_refresh_token = COALESCE($4, google_refresh_token),
       google_token_expiry = $5
     WHERE id = $1
     RETURNING *`,
    [id, googleEmail, accessToken, refreshToken || null, expiry]
  );
  return rows[0] ? calendarFromRow(rows[0]) : null;
}

// Used by server/googleCalendar.js after a token refresh — updates
// just the access token/expiry without touching google_email/refresh.
export async function updateCalendarGoogleAccessToken(id, { accessToken, expiry }) {
  await query("UPDATE calendars SET google_access_token = $2, google_token_expiry = $3 WHERE id = $1", [
    id,
    accessToken,
    expiry,
  ]);
}

export async function clearCalendarGoogleTokens(id) {
  const rows = await query(
    `UPDATE calendars SET
       google_connected = false,
       google_email = NULL,
       google_access_token = NULL,
       google_refresh_token = NULL,
       google_token_expiry = NULL,
       google_calendar_id = 'primary'
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return rows[0] ? calendarFromRow(rows[0]) : null;
}

// ---------- Calendar bookings ----------

function calendarBookingFromRow(r) {
  return {
    id: r.id,
    calendarId: r.calendar_id,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    notes: r.notes,
    startTime: r.start_time,
    endTime: r.end_time,
    bookerTimezone: r.booker_timezone,
    status: r.status,
    googleEventId: r.google_event_id,
    cancelToken: r.cancel_token,
    createdAt: r.created_at,
  };
}

export async function getCalendarBookings(calendarId) {
  const rows = await query(
    "SELECT * FROM calendar_bookings WHERE calendar_id = $1 ORDER BY start_time DESC",
    [calendarId]
  );
  return rows.map(calendarBookingFromRow);
}

// Confirmed bookings overlapping [fromISO, toISO) — treated as busy
// time when computing available slots, on top of whatever Google's
// freebusy API reports (keeps a calendar's own bookings authoritative
// even the moment before Google's copy of the event exists).
export async function getConfirmedBookingsInRange(calendarId, fromISO, toISO) {
  const rows = await query(
    `SELECT * FROM calendar_bookings
     WHERE calendar_id = $1 AND status = 'confirmed' AND start_time < $3 AND end_time > $2
     ORDER BY start_time ASC`,
    [calendarId, fromISO, toISO]
  );
  return rows.map(calendarBookingFromRow);
}

export async function countConfirmedBookingsOnDay(calendarId, dayStartISO, dayEndISO) {
  const [{ count }] = await query(
    `SELECT count(*)::int AS count FROM calendar_bookings
     WHERE calendar_id = $1 AND status = 'confirmed' AND start_time >= $2 AND start_time < $3`,
    [calendarId, dayStartISO, dayEndISO]
  );
  return count;
}

export async function createCalendarBooking(b) {
  const cancelToken = crypto.randomBytes(16).toString("hex");
  const rows = await query(
    `INSERT INTO calendar_bookings
       (calendar_id, contact_name, contact_email, contact_phone, notes, start_time, end_time, booker_timezone, cancel_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      b.calendarId,
      b.contactName,
      b.contactEmail || null,
      b.contactPhone || null,
      b.notes || null,
      b.startTime,
      b.endTime,
      b.bookerTimezone || null,
      cancelToken,
    ]
  );
  return calendarBookingFromRow(rows[0]);
}

export async function setCalendarBookingGoogleEventId(id, googleEventId) {
  await query("UPDATE calendar_bookings SET google_event_id = $2 WHERE id = $1", [id, googleEventId]);
}

export async function getCalendarBookingByCancelToken(token) {
  const rows = await query("SELECT * FROM calendar_bookings WHERE cancel_token = $1", [token]);
  return rows[0] ? calendarBookingFromRow(rows[0]) : null;
}

export async function getCalendarBookingById(id) {
  const rows = await query("SELECT * FROM calendar_bookings WHERE id = $1", [id]);
  return rows[0] ? calendarBookingFromRow(rows[0]) : null;
}

export async function cancelCalendarBooking(id) {
  const rows = await query(
    "UPDATE calendar_bookings SET status = 'cancelled' WHERE id = $1 RETURNING *",
    [id]
  );
  return rows[0] ? calendarBookingFromRow(rows[0]) : null;
}

// ---------- Automations ----------

function automationFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    triggerType: r.trigger_type,
    triggerConfig: r.trigger_config || {},
    actions: r.actions || [],
    active: r.active,
    createdAt: r.created_at,
  };
}

export async function getAutomations() {
  const rows = await query("SELECT * FROM automations ORDER BY created_at ASC");
  return rows.map(automationFromRow);
}

export async function getAutomationById(id) {
  const rows = await query("SELECT * FROM automations WHERE id = $1", [id]);
  return rows[0] ? automationFromRow(rows[0]) : null;
}

// Only ever called with a real trigger_type by server/automations.js,
// and only for automations actually switched on — an inactive one, or
// one whose builder was never finished (trigger_type still null),
// should never fire.
export async function getActiveAutomationsByTrigger(triggerType) {
  const rows = await query(
    "SELECT * FROM automations WHERE trigger_type = $1 AND active = true ORDER BY created_at ASC",
    [triggerType]
  );
  return rows.map(automationFromRow);
}

export async function createAutomation({ name }) {
  const rows = await query("INSERT INTO automations (name) VALUES ($1) RETURNING *", [name]);
  return automationFromRow(rows[0]);
}

// Same "every field optional" shape as updateCalendar — the builder
// can save the trigger and the actions list independently.
export async function updateAutomation(id, patch) {
  const rows = await query(
    `UPDATE automations SET
       name = COALESCE($2, name),
       trigger_type = COALESCE($3, trigger_type),
       trigger_config = COALESCE($4::jsonb, trigger_config),
       actions = COALESCE($5::jsonb, actions),
       active = COALESCE($6, active)
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.triggerType ?? null,
      patch.triggerConfig ? JSON.stringify(patch.triggerConfig) : null,
      patch.actions ? JSON.stringify(patch.actions) : null,
      patch.active ?? null,
    ]
  );
  return rows[0] ? automationFromRow(rows[0]) : null;
}

export async function deleteAutomation(id) {
  await query("DELETE FROM automations WHERE id = $1", [id]);
}

// ---------- Automation runs (durable queue for "wait" steps) ----------

function automationRunFromRow(r) {
  return {
    id: r.id,
    automationId: r.automation_id,
    context: r.context || {},
    nextStepIndex: r.next_step_index,
    runAt: r.run_at,
    status: r.status,
    lastError: r.last_error,
  };
}

export async function createAutomationRun({ automationId, context, runAt }) {
  const rows = await query(
    "INSERT INTO automation_runs (automation_id, context, run_at) VALUES ($1,$2,$3) RETURNING *",
    [automationId, JSON.stringify(context || {}), (runAt || new Date()).toISOString()]
  );
  return automationRunFromRow(rows[0]);
}

// Atomically claims up to `limit` due runs by flipping them to
// 'processing' in one statement — the FOR UPDATE SKIP LOCKED subquery
// is what makes this safe to call concurrently (a trigger firing's
// own immediate advance and the cron poller both call this same
// path), same idea as claimMultilineWinner's atomic UPDATE above,
// just claiming a batch instead of a single winner.
export async function claimDueAutomationRuns(limit = 20) {
  const rows = await query(
    `UPDATE automation_runs SET status = 'processing'
     WHERE id IN (
       SELECT id FROM automation_runs
       WHERE status = 'pending' AND run_at <= now()
       ORDER BY run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  );
  return rows.map(automationRunFromRow);
}

// Advances a claimed run: either reschedules it (more steps left,
// status goes back to 'pending' so a later poll picks it up) or
// closes it out ('done'/'failed').
export async function updateAutomationRunProgress(id, { nextStepIndex, runAt, status, lastError }) {
  await query(
    `UPDATE automation_runs SET
       next_step_index = COALESCE($2, next_step_index),
       run_at = COALESCE($3, run_at),
       status = COALESCE($4, status),
       last_error = COALESCE($5, last_error)
     WHERE id = $1`,
    [
      id,
      nextStepIndex ?? null,
      runAt ? new Date(runAt).toISOString() : null,
      status ?? null,
      lastError ?? null,
    ]
  );
}
