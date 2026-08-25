// Shared database layer — used by both the local Express server
// (server/index.js) and the Vercel serverless functions (/api/*.js),
// exactly like server/twilioCore.js does for calling. Uses the
// standard `pg` driver over a normal Postgres connection string, so
// it works with any Postgres-compatible provider (Neon, Prisma
// Postgres, Supabase, RDS, …) — whichever one POSTGRES_URL points at.
import pg from "pg";
import { CLIENT_COLUMNS, IMPORTED_CLIENTS } from "./clientImportData.js";

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
    await seedIfEmpty();
  })();
  return schemaReady;
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
    createdAt: r.created_at,
  };
}

export async function getContacts() {
  const rows = await query("SELECT * FROM contacts ORDER BY created_at DESC");
  return rows.map(contactFromRow);
}

export async function createContact(c) {
  const rows = await query(
    "INSERT INTO contacts (name, email, phone, client, status, last_contact, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [c.name, c.email || "", c.phone, c.client || "", c.status || "New Lead", c.lastContact || "Today", c.notes || ""]
  );
  return contactFromRow(rows[0]);
}

export async function updateContact(id, patch) {
  const rows = await query(
    `UPDATE contacts SET
       status = COALESCE($2, status),
       notes = COALESCE($3, notes),
       last_contact = COALESCE($4, last_contact)
     WHERE id = $1
     RETURNING *`,
    [id, patch.status ?? null, patch.notes ?? null, patch.lastContact ?? null]
  );
  return rows[0] ? contactFromRow(rows[0]) : null;
}

export async function deleteContacts(ids) {
  await query("DELETE FROM contacts WHERE id = ANY($1::int[])", [ids]);
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
