// Shared database layer — used by both the local Express server
// (server/index.js) and the Vercel serverless functions (/api/*.js),
// exactly like server/twilioCore.js does for calling. Uses the
// standard `pg` driver over a normal Postgres connection string, so
// it works with any Postgres-compatible provider (Neon, Prisma
// Postgres, Supabase, RDS, …) — whichever one POSTGRES_URL points at.
import pg from "pg";
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
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
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
    await seedIfEmpty();
    await seedUsersIfMissing();
  })();
  return schemaReady;
}

// Invite-only accounts: pre-seed the people allowed to ever log in,
// with no password set yet. Each one claims their account once via
// "set password" — anyone else's email just won't exist here, so
// there's no open self-registration.
const INVITED_USERS = [
  { name: "Henry", email: "henryfortunatow@gmail.com" },
  { name: "Jem", email: "jem.scalbl@gmail.com" },
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

export async function getContacts() {
  const rows = await query("SELECT * FROM contacts ORDER BY created_at DESC");
  return rows.map(contactFromRow);
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
       tag = COALESCE($7, tag)
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
    ]
  );
  return rows[0] ? contactFromRow(rows[0]) : null;
}

export async function deleteContacts(ids) {
  await query("DELETE FROM contacts WHERE id = ANY($1::int[])", [ids]);
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

export async function getConversations() {
  const convos = await query("SELECT * FROM conversations ORDER BY updated_at DESC");
  const messages = await query("SELECT * FROM messages ORDER BY id ASC");
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
export async function logCall({ leadId, name, text, time }) {
  return logMessage({ leadId, name, text, time, type: "call", outgoing: true });
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

export async function getCalledLeadIds() {
  const rows = await query("SELECT lead_id FROM called_leads");
  return rows.map((r) => r.lead_id);
}

export async function markLeadCalled(leadId) {
  await query("INSERT INTO called_leads (lead_id) VALUES ($1) ON CONFLICT DO NOTHING", [leadId]);
}

export async function getCallLog() {
  const rows = await query("SELECT * FROM call_log ORDER BY called_at DESC");
  return rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    name: r.name,
    phone: r.phone,
    client: r.client,
    status: r.status,
    notes: r.notes,
    calledAt: r.called_at,
  }));
}

export async function addCallLogEntry(entry) {
  const rows = await query(
    "INSERT INTO call_log (lead_id, name, phone, client, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [entry.leadId, entry.name, entry.phone, entry.client, entry.status, entry.notes]
  );
  const row = rows[0];
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    phone: row.phone,
    client: row.client,
    status: row.status,
    notes: row.notes,
    calledAt: row.called_at,
  };
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

// ---------- API keys (for programmatic/agent access) ----------
// The raw key is only ever known at creation time — only its hash is
// stored, same principle as a password. key_prefix is a few
// characters of the raw key kept in the clear purely so the UI can
// show which key is which without ever displaying the full secret.

export async function createApiKey({ label, keyHash, keyPrefix, createdBy }) {
  const rows = await query(
    "INSERT INTO api_keys (label, key_hash, key_prefix, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [label, keyHash, keyPrefix, createdBy || null]
  );
  return rows[0];
}

export async function getApiKeys() {
  const rows = await query(
    "SELECT ak.id, ak.label, ak.key_prefix, ak.created_at, ak.last_used_at, u.name AS created_by_name " +
      "FROM api_keys ak LEFT JOIN users u ON u.id = ak.created_by ORDER BY ak.created_at DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    keyPrefix: r.key_prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    createdByName: r.created_by_name,
  }));
}

export async function findApiKeyByHash(keyHash) {
  const rows = await query("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash]);
  return rows[0] || null;
}

export async function touchApiKeyLastUsed(id) {
  await query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [id]);
}

export async function deleteApiKey(id) {
  await query("DELETE FROM api_keys WHERE id = $1", [id]);
}
