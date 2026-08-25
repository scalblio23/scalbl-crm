// Local dev backend (used with `npm run dev:all`) — Twilio calling
// plus the database API. The deployed site uses the equivalent
// functions in /api instead; both paths share their logic from
// server/twilioCore.js and server/db.js.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { missingTwilioEnv, mintAccessToken, buildVoiceTwiml, sendSms } from "./twilioCore.js";
import {
  isDbConfigured,
  ensureSchema,
  getClients,
  createClient,
  updateClient,
  deleteClients,
  getClientColumns,
  createClientColumn,
  deleteClientColumn,
  importClientData,
  importContactData,
  getContacts,
  createContact,
  updateContact,
  deleteContacts,
  getContactColumns,
  createContactColumn,
  deleteContactColumn,
  importContactsBulk,
  getConversations,
  logCall,
  logMessage,
  findContactByPhone,
  deleteConversations,
  getDialLists,
  createDialList,
  deleteDialList,
  getCalledLeadIds,
  markLeadCalled,
  getCallLog,
  addCallLogEntry,
  getUserByEmail,
  claimUserPassword,
} from "./db.js";
import {
  getUserFromRequest,
  requireAuth,
  hashPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
} from "./auth.js";

dotenv.config();

const { PORT = 3001 } = process.env;

const app = express();
// credentials: true + a reflected origin (rather than the cors()
// default wildcard "*") is required for the session cookie to be
// sent/accepted — browsers refuse credentialed requests against "*".
app.use(cors({ origin: true, credentials: true }));
app.use(express.urlencoded({ extended: false }));
// Raised from Express's 100kb default — a bulk lead import batch
// (see /api/contacts-bulk-import) can run to a few MB of JSON.
app.use(express.json({ limit: "10mb" }));

// Twilio webhooks and the auth endpoints themselves are the only
// routes reachable without a session cookie.
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/voice",
  "/api/status",
  "/api/sms-inbound",
  "/api/auth-login",
  "/api/auth-set-password",
  "/api/auth-logout",
  "/api/auth-me",
]);

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  const user = requireAuth(req, res);
  if (!user) return; // requireAuth already sent the 401
  req.user = user;
  next();
});

// Wraps a route so DB errors come back as a clean 500 instead of
// crashing the process, and so every route ensures the schema exists.
function dbRoute(fn) {
  return async (req, res) => {
    try {
      await ensureSchema();
      await fn(req, res);
    } catch (err) {
      console.error("[db]", err);
      res.status(500).json({ error: err.message || "Database error" });
    }
  };
}

app.get("/api/health", (req, res) => {
  const missing = missingTwilioEnv();
  const dbConfigured = isDbConfigured();
  res.json({
    ok: missing.length === 0 && dbConfigured,
    missing,
    database: dbConfigured ? "connected" : "not configured — set POSTGRES_URL",
  });
});

// ---------- Auth ----------

app.get("/api/auth-me", (req, res) => {
  res.json({ user: getUserFromRequest(req) });
});

app.post(
  "/api/auth-login",
  dbRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
    const row = await getUserByEmail(email);
    if (!row || !row.password_hash) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });
    const user = { id: row.id, name: row.name, email: row.email };
    res.setHeader("Set-Cookie", createSessionCookie(user));
    res.json({ user });
  })
);

app.post(
  "/api/auth-set-password",
  dbRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const existing = await getUserByEmail(email);
    if (!existing) return res.status(404).json({ error: "That email hasn't been invited." });
    if (existing.password_hash) {
      return res.status(409).json({ error: "This account already has a password — log in instead." });
    }
    const hash = await hashPassword(password);
    const row = await claimUserPassword(email, hash);
    if (!row) {
      return res.status(409).json({ error: "This account already has a password — log in instead." });
    }
    const user = { id: row.id, name: row.name, email: row.email };
    res.setHeader("Set-Cookie", createSessionCookie(user));
    res.json({ user });
  })
);

app.post("/api/auth-logout", (req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
});

// Everything the app needs on first load, in one request — see
// api/bootstrap.js for why this matters more than it might look.
app.get(
  "/api/bootstrap",
  dbRoute(async (req, res) => {
    const [clients, clientColumnsData, contacts, contactColumnsData, conversations, dialLists, calledLeadIds, callLog] =
      await Promise.all([
        getClients(),
        getClientColumns(),
        getContacts(),
        getContactColumns(),
        getConversations(),
        getDialLists(),
        getCalledLeadIds(),
        getCallLog(),
      ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      clients,
      clientColumns: clientColumnsData,
      contacts,
      contactColumns: contactColumnsData,
      conversations,
      dialLists,
      calledLeadIds,
      callLog,
    });
  })
);

// ---------- Twilio calling ----------

// Mints a short-lived Access Token so the browser can register as a
// Twilio Voice device (the same softphone model GoHighLevel uses),
// scoped to place outgoing calls through our TwiML App.
app.get("/api/token", (req, res) => {
  const missing = missingTwilioEnv();
  if (missing.length) {
    return res.status(500).json({
      error: `Twilio is not configured. Missing: ${missing.join(", ")}`,
    });
  }
  const identity = req.query.identity || "rep";
  res.json({ token: mintAccessToken(identity), identity });
});

// TwiML voice webhook. This is the URL you paste into the TwiML App's
// "Voice" config in the Twilio Console. Twilio hits this once the
// browser device places a call, and we tell it who to actually dial
// and what caller ID to show — mirroring GHL's "call bridges through
// our number" behaviour.
app.post("/api/voice", (req, res) => {
  res.type("text/xml").send(buildVoiceTwiml(req.body.To));
});

// Call status callback — set this as the TwiML App / <Dial> status
// callback URL to log ringing/in-progress/completed events against a
// lead's activity history.
app.post("/api/status", (req, res) => {
  console.log(
    "[twilio status]",
    req.body.CallStatus,
    "to:",
    req.body.To,
    "sid:",
    req.body.CallSid
  );
  res.sendStatus(204);
});

// ---------- SMS ----------

// Sends an outbound SMS and logs it onto the lead's conversation.
app.post(
  "/api/sms-send",
  dbRoute(async (req, res) => {
    const missing = missingTwilioEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
    }
    const { leadId, name, phone, text } = req.body || {};
    if (!phone || !text) return res.status(400).json({ error: "Missing phone or text" });
    await sendSms({ to: phone, body: text });
    const timeLabel = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    const conversationId = await logMessage({
      leadId: leadId || null,
      name: name || phone,
      text,
      time: timeLabel,
      type: "text",
      outgoing: true,
    });
    res.status(201).json({ conversationId });
  })
);

// Twilio's "A message comes in" webhook — set this as the number's
// Messaging webhook (POST http://<ngrok-url>/api/sms-inbound in dev).
// Deliberately NOT wrapped in dbRoute: Twilio gives up on this
// webhook after ~15s, and the database can be slower than that to
// wake up from idle. Respond with the TwiML immediately — it needs
// no database access — then do the contact-matching and logging
// after Twilio's already got its 200.
app.post("/api/sms-inbound", async (req, res) => {
  res.type("text/xml").send("<Response></Response>");
  try {
    await ensureSchema();
    const from = req.body?.From;
    const body = req.body?.Body || "";
    if (from) {
      const contact = await findContactByPhone(from);
      const timeLabel = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
      await logMessage({
        leadId: contact ? contact.id : null,
        name: contact ? contact.name : from,
        text: body,
        time: timeLabel,
        type: "text",
        outgoing: false,
      });
    }
  } catch (err) {
    console.error("[db] /api/sms-inbound", err);
  }
});

// ---------- Database ----------

app.get("/api/clients", dbRoute(async (req, res) => res.json(await getClients())));
app.post(
  "/api/clients",
  dbRoute(async (req, res) => res.status(201).json(await createClient(req.body || {})))
);
app.patch(
  "/api/clients",
  dbRoute(async (req, res) => {
    const { id, ...patch } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const client = await updateClient(id, patch);
    if (!client) return res.status(404).json({ error: "Client not found" });
    res.json(client);
  })
);
app.delete(
  "/api/clients",
  dbRoute(async (req, res) => {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "Missing ids" });
    await deleteClients(ids);
    res.status(204).end();
  })
);

app.get("/api/client-columns", dbRoute(async (req, res) => res.json(await getClientColumns())));
app.post(
  "/api/client-columns",
  dbRoute(async (req, res) => {
    const { label, type, options } = req.body || {};
    if (!label || !type) return res.status(400).json({ error: "Missing label or type" });
    res.status(201).json(await createClientColumn({ label, type, options }));
  })
);
app.delete(
  "/api/client-columns",
  dbRoute(async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });
    await deleteClientColumn(id);
    res.status(204).end();
  })
);

app.post(
  "/api/clients-import",
  dbRoute(async (req, res) => res.json(await importClientData()))
);

app.post(
  "/api/contacts-import",
  dbRoute(async (req, res) => res.json(await importContactData()))
);

app.get("/api/contacts", dbRoute(async (req, res) => res.json(await getContacts())));
app.post(
  "/api/contacts",
  dbRoute(async (req, res) => res.status(201).json(await createContact(req.body || {})))
);
app.patch(
  "/api/contacts",
  dbRoute(async (req, res) => {
    const { id, ...patch } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const contact = await updateContact(id, patch);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  })
);
app.delete(
  "/api/contacts",
  dbRoute(async (req, res) => {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "Missing ids" });
    await deleteContacts(ids);
    res.status(204).end();
  })
);

app.get("/api/contact-columns", dbRoute(async (req, res) => res.json(await getContactColumns())));
app.post(
  "/api/contact-columns",
  dbRoute(async (req, res) => {
    const { label, type, options } = req.body || {};
    if (!label || !type) return res.status(400).json({ error: "Missing label or type" });
    res.status(201).json(await createContactColumn({ label, type, options }));
  })
);
app.delete(
  "/api/contact-columns",
  dbRoute(async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });
    await deleteContactColumn(id);
    res.status(204).end();
  })
);

// Bulk-loads leads from an external source — see api/contacts-bulk-import.js.
app.post(
  "/api/contacts-bulk-import",
  dbRoute(async (req, res) => {
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: "Expected a non-empty array of contact records" });
    }
    res.json(await importContactsBulk(records));
  })
);

app.get("/api/conversations", dbRoute(async (req, res) => res.json(await getConversations())));
app.post(
  "/api/conversations",
  dbRoute(async (req, res) => {
    const { leadId, name, text, time } = req.body || {};
    if (!leadId || !text) return res.status(400).json({ error: "Missing leadId or text" });
    const conversationId = await logCall({ leadId, name, text, time });
    res.status(201).json({ conversationId });
  })
);
app.delete(
  "/api/conversations",
  dbRoute(async (req, res) => {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "Missing ids" });
    await deleteConversations(ids);
    res.status(204).end();
  })
);

app.get("/api/dial-lists", dbRoute(async (req, res) => res.json(await getDialLists())));
app.post(
  "/api/dial-lists",
  dbRoute(async (req, res) => {
    const { name, leadIds } = req.body || {};
    if (!name || !Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: "Missing name or leadIds" });
    }
    res.status(201).json(await createDialList(name, leadIds));
  })
);
app.delete(
  "/api/dial-lists",
  dbRoute(async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });
    await deleteDialList(id);
    res.status(204).end();
  })
);

app.get("/api/called-leads", dbRoute(async (req, res) => res.json(await getCalledLeadIds())));
app.post(
  "/api/called-leads",
  dbRoute(async (req, res) => {
    const { leadId } = req.body || {};
    if (!leadId) return res.status(400).json({ error: "Missing leadId" });
    await markLeadCalled(leadId);
    res.status(204).end();
  })
);

app.get("/api/call-log", dbRoute(async (req, res) => res.json(await getCallLog())));
app.post(
  "/api/call-log",
  dbRoute(async (req, res) => res.status(201).json(await addCallLogEntry(req.body || {})))
);

app.listen(PORT, () => {
  const missing = missingTwilioEnv();
  console.log(`Local backend listening on http://localhost:${PORT}`);
  if (missing.length) {
    console.warn(
      `⚠ Twilio env vars not set yet, calls will fail until you add them to .env: ${missing.join(", ")}`
    );
  }
  if (!isDbConfigured()) {
    console.warn(`⚠ POSTGRES_URL not set yet — database routes will fail until you add it to .env`);
  }
});
