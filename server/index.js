// Local dev backend (used with `npm run dev:all`) — Twilio calling
// plus the database API. The deployed site uses the equivalent
// functions in /api instead; both paths share their logic from
// server/twilioCore.js and server/db.js.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { missingTwilioEnv, mintAccessToken, buildVoiceTwiml } from "./twilioCore.js";
import {
  isDbConfigured,
  ensureSchema,
  getClients,
  getContacts,
  createContact,
  updateContact,
  deleteContacts,
  getConversations,
  logCall,
  getDialLists,
  createDialList,
  deleteDialList,
  getCalledLeadIds,
  markLeadCalled,
  getCallLog,
  addCallLogEntry,
} from "./db.js";

dotenv.config();

const { PORT = 3001 } = process.env;

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

// ---------- Database ----------

app.get("/api/clients", dbRoute(async (req, res) => res.json(await getClients())));

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
