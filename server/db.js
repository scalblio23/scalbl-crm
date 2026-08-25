// Shared database layer — used by both the local Express server
// (server/index.js) and the Vercel serverless functions (/api/*.js),
// exactly like server/twilioCore.js does for calling. Uses the
// standard `pg` driver over a normal Postgres connection string, so
// it works with any Postgres-compatible provider (Neon, Prisma
// Postgres, Supabase, RDS, …) — whichever one POSTGRES_URL points at.
import pg from "pg";

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
        script_steps JSONB DEFAULT '[]'
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

  const contactIds = {};
  for (const c of SEED_CONTACTS) {
    const [row] = await query(
      "INSERT INTO contacts (name, email, phone, client, status, last_contact, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [c.name, c.email, c.phone, c.client, c.status, c.lastContact, c.notes]
    );
    contactIds[c.name] = row.id;
  }

  const seedConvos = [
    {
      leadId: contactIds["Sarah Mitchell"],
      name: "Sarah Mitchell",
      messages: [
        { text: "Yes I'm interested in the battery rebate", time: "10:32 AM", outgoing: false },
        { text: "No worries — I'll give you a call shortly to run through it.", time: "10:35 AM", outgoing: true },
      ],
    },
    {
      leadId: contactIds["Tom Nguyen"],
      name: "Tom Nguyen",
      messages: [
        { text: "What deposit do I need?", time: "9:15 AM", outgoing: false },
        { text: "No worries — I'll give you a call shortly to run through it.", time: "9:20 AM", outgoing: true },
      ],
    },
    {
      leadId: contactIds["Emma Taylor"],
      name: "Emma Taylor",
      messages: [{ text: "Confirmed for Thursday 2pm", time: "Yesterday", outgoing: false }],
    },
    {
      leadId: contactIds["David Chen"],
      name: "David Chen",
      messages: [{ text: "Can you call me after 5?", time: "Yesterday", outgoing: false }],
    },
  ];

  for (const convo of seedConvos) {
    const last = convo.messages[convo.messages.length - 1];
    const [row] = await query(
      "INSERT INTO conversations (lead_id, name, preview, time_label, unread) VALUES ($1,$2,$3,$4,true) RETURNING id",
      [convo.leadId, convo.name, convo.messages[0].text, last.time]
    );
    for (const m of convo.messages) {
      await query(
        "INSERT INTO messages (conversation_id, type, text, time_label, outgoing) VALUES ($1,'text',$2,$3,$4)",
        [row.id, m.text, m.time, m.outgoing]
      );
    }
  }
}

// ---------- Queries used by the API routes ----------

export async function getClients() {
  const rows = await query("SELECT * FROM clients ORDER BY id");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    industry: r.industry,
    leads: r.leads,
    adsLive: r.ads_live,
    script: r.script,
    scriptSteps: r.script_steps || [],
  }));
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

// Logs a call onto a lead's conversation — creates the conversation if
// one doesn't exist yet, otherwise appends a message and bumps it.
export async function logCall({ leadId, name, text, time }) {
  const existingRows = await query("SELECT id FROM conversations WHERE lead_id = $1", [leadId]);
  let conversationId = existingRows[0]?.id;
  if (!conversationId) {
    const rows = await query(
      "INSERT INTO conversations (lead_id, name, preview, time_label, unread) VALUES ($1,$2,$3,$4,false) RETURNING id",
      [leadId, name, text, time]
    );
    conversationId = rows[0].id;
  } else {
    await query(
      "UPDATE conversations SET preview = $2, time_label = $3, unread = false, updated_at = now() WHERE id = $1",
      [conversationId, text, time]
    );
  }
  await query("INSERT INTO messages (conversation_id, type, text, time_label, outgoing) VALUES ($1,'call',$2,$3,true)", [
    conversationId,
    text,
    time,
  ]);
  return conversationId;
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
