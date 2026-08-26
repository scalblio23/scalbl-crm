// Local dev backend (used with `npm run dev:all`) — Twilio calling
// plus the database API. The deployed site uses the equivalent
// functions in /api instead; both paths share their logic from
// server/twilioCore.js and server/db.js.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { missingTwilioEnv, mintAccessToken, buildVoiceTwiml, getCallerIdPool, sendSms } from "./twilioCore.js";
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
  resetContactImport,
  importContactDataBatch,
  getContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContacts,
  getContactColumns,
  createContactColumn,
  deleteContactColumn,
  updateContactColumnByKey,
  importContactsBulk,
  getConversations,
  logCall,
  logMessage,
  findContactByPhone,
  deleteConversations,
  getDialLists,
  createDialList,
  addLeadsToDialList,
  deleteDialList,
  getCalledLeadIds,
  markLeadCalled,
  getCallLog,
  addCallLogEntry,
  getUserByEmail,
  claimUserPassword,
  createApiKey,
  getApiKeys,
  deleteApiKey,
  getUsers,
  getUserById,
  inviteUser,
  updateUser,
  deleteUserById,
  nextRotationIndex,
} from "./db.js";
import {
  getSessionUser,
  requireAuth,
  hashPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  generateApiKey,
  hashApiKey,
  scopeTagsForUser,
  canManageUsers,
  canDeleteUser,
  forbidClientRole,
  ROLES,
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

app.use(async (req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  const user = await requireAuth(req, res);
  if (!user) return; // requireAuth already sent the 401
  req.user = user;
  next();
});

// A client role has no business on these endpoints at all — not just
// data they can't see, but capability they don't have (client org
// management, dial lists, bulk/reset imports). Mirrors the same guard
// in the equivalent api/*.js files. contact-columns is handled
// separately just below since its GET must stay open for a client to
// render their own leads' criteria.
app.use(
  ["/api/clients", "/api/client-columns", "/api/clients-import", "/api/contacts-import", "/api/contacts-bulk-import", "/api/dial-lists"],
  (req, res, next) => {
    if (forbidClientRole(req.user, res)) return;
    next();
  }
);
app.use("/api/contact-columns", (req, res, next) => {
  if (req.method === "GET") return next();
  if (forbidClientRole(req.user, res)) return;
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

app.get(
  "/api/auth-me",
  dbRoute(async (req, res) => {
    res.json({ user: await getSessionUser(req) });
  })
);

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
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role || "admin",
      allowedTags: row.allowed_tags || [],
    };
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
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role || "admin",
      allowedTags: row.allowed_tags || [],
    };
    res.setHeader("Set-Cookie", createSessionCookie(user));
    res.json({ user });
  })
);

app.post("/api/auth-logout", (req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
});

// ---------- API keys (programmatic/agent access) ----------
// Session-only on purpose — a key should never be able to mint more
// keys or see/revoke anyone else's, so this checks getSessionUser
// directly rather than the global middleware's requireAuth (which
// also accepts a key). Also blocked for the client role — a key is
// equivalent to full admin access, so letting a tag-scoped client
// mint one would be a privilege escalation around their own scoping.
async function requireKeyManager(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Log in to manage API keys." });
    return null;
  }
  if (user.role === "client") {
    res.status(403).json({ error: "Not available on this account." });
    return null;
  }
  return user;
}
app.get(
  "/api/api-keys",
  dbRoute(async (req, res) => {
    const user = await requireKeyManager(req, res);
    if (!user) return;
    res.json(await getApiKeys());
  })
);
app.post(
  "/api/api-keys",
  dbRoute(async (req, res) => {
    const user = await requireKeyManager(req, res);
    if (!user) return;
    const label = String(req.body?.label || "").trim();
    if (!label) return res.status(400).json({ error: "Give the key a label (e.g. what agent it's for)." });
    const rawKey = generateApiKey();
    const row = await createApiKey({
      label,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 11),
      createdBy: user.id,
    });
    res.status(201).json({ id: row.id, label: row.label, key: rawKey, keyPrefix: row.key_prefix, createdAt: row.created_at });
  })
);
app.delete(
  "/api/api-keys",
  dbRoute(async (req, res) => {
    const user = await requireKeyManager(req, res);
    if (!user) return;
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });
    await deleteApiKey(id);
    res.status(204).end();
  })
);

// ---------- Users (roster + role management) ----------
// GET is open to anyone signed in (so an admin can see who has
// access); POST/PATCH/DELETE are gated by canManageUsers/canDeleteUser
// — see api/users.js for the full reasoning, mirrored here.
app.get("/api/users", dbRoute(async (req, res) => res.json(await getUsers())));
app.post(
  "/api/users",
  dbRoute(async (req, res) => {
    if (!canManageUsers(req.user.role)) {
      return res.status(403).json({ error: "Only an owner or super admin can invite users." });
    }
    const { name, email, role, allowedTags } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: "Missing name or email" });
    if (role && (role === "owner" || !ROLES.includes(role))) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const created = await inviteUser({ name, email, role, allowedTags });
    if (!created) return res.status(409).json({ error: "That email is already invited." });
    res.status(201).json(created);
  })
);
app.patch(
  "/api/users",
  dbRoute(async (req, res) => {
    if (!canManageUsers(req.user.role)) {
      return res.status(403).json({ error: "Only an owner or super admin can edit users." });
    }
    const { id, name, role, allowedTags } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    if (role && (role === "owner" || !ROLES.includes(role))) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "owner") {
      return res.status(403).json({ error: "The owner's account can't be edited." });
    }
    res.json(await updateUser(id, { name, role, allowedTags }));
  })
);
app.delete(
  "/api/users",
  dbRoute(async (req, res) => {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: "Missing id" });
    if (id === Number(req.user.id)) {
      return res.status(400).json({ error: "You can't delete your own account." });
    }
    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (!canDeleteUser(req.user.role, target.role)) {
      return res.status(403).json({ error: "Not allowed to delete this user." });
    }
    await deleteUserById(id);
    res.status(204).end();
  })
);

// Everything the app needs on first load, in one request — see
// api/bootstrap.js for why this matters more than it might look.
app.get(
  "/api/bootstrap",
  dbRoute(async (req, res) => {
    const allowedTags = scopeTagsForUser(req.user);
    const scoped = allowedTags !== null;
    const [clients, clientColumnsData, contacts, contactColumnsData, conversations, dialLists, calledLeadIds, callLog] =
      await Promise.all([
        scoped ? [] : getClients(),
        scoped ? [] : getClientColumns(),
        getContacts(allowedTags),
        getContactColumns(),
        getConversations(allowedTags),
        scoped ? [] : getDialLists(),
        getCalledLeadIds(),
        getCallLog(allowedTags),
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
app.post("/api/voice", async (req, res) => {
  const pool = getCallerIdPool();
  // Trust the browser's already-picked/displayed caller ID (see
  // /api/next-caller-id) as long as it's one of ours, so the number
  // shown in the UI matches the one Twilio actually dials from.
  const requested = req.body?.callerId;
  let callerId = requested && pool.includes(requested) ? requested : pool[0];
  if (!(requested && pool.includes(requested)) && pool.length > 1) {
    try {
      await ensureSchema();
      const counter = await nextRotationIndex();
      callerId = pool[counter % pool.length];
    } catch (err) {
      console.error("[api/voice] rotation lookup failed, using the first caller ID", err);
    }
  }
  res.type("text/xml").send(buildVoiceTwiml(req.body.To, callerId));
});

// Lets the browser know — and show — which number is about to place
// the call, before it actually dials. See api/next-caller-id.js.
app.post(
  "/api/next-caller-id",
  dbRoute(async (req, res) => {
    const pool = getCallerIdPool();
    if (!pool.length) return res.status(500).json({ error: "No Twilio caller ID configured." });
    let callerId = pool[0];
    if (pool.length > 1) {
      const counter = await nextRotationIndex();
      callerId = pool[counter % pool.length];
    }
    res.json({ callerId });
  })
);

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
  dbRoute(async (req, res) => {
    const { reset, offset, limit } = req.body || {};
    if (reset) return res.json(await resetContactImport());
    res.json(
      await importContactDataBatch({
        offset: Number.isFinite(offset) ? offset : 0,
        limit: Number.isFinite(limit) ? limit : 500,
      })
    );
  })
);

app.get(
  "/api/contacts",
  dbRoute(async (req, res) => res.json(await getContacts(scopeTagsForUser(req.user))))
);
app.post(
  "/api/contacts",
  dbRoute(async (req, res) => {
    const allowedTags = scopeTagsForUser(req.user);
    const body = req.body || {};
    if (allowedTags && (!body.tag || !allowedTags.includes(body.tag))) {
      return res.status(403).json({ error: "You can only add leads under your own tag." });
    }
    res.status(201).json(await createContact(body));
  })
);
app.patch(
  "/api/contacts",
  dbRoute(async (req, res) => {
    const { id, ...patch } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });
    const allowedTags = scopeTagsForUser(req.user);
    if (allowedTags) {
      const existing = await getContactById(id);
      if (!existing || !allowedTags.includes(existing.tag)) {
        return res.status(403).json({ error: "Not found" });
      }
      delete patch.tag;
    }
    const contact = await updateContact(id, patch);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  })
);
app.delete(
  "/api/contacts",
  dbRoute(async (req, res) => {
    if (scopeTagsForUser(req.user)) {
      return res.status(403).json({ error: "Not allowed to delete leads." });
    }
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
app.patch(
  "/api/contact-columns",
  dbRoute(async (req, res) => {
    const { key, label, type, options } = req.body || {};
    if (!key) return res.status(400).json({ error: "Missing key" });
    const column = await updateContactColumnByKey(key, { label, type, options });
    if (!column) return res.status(404).json({ error: `No column with key "${key}"` });
    res.json(column);
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

app.get(
  "/api/conversations",
  dbRoute(async (req, res) => res.json(await getConversations(scopeTagsForUser(req.user))))
);
app.post(
  "/api/conversations",
  dbRoute(async (req, res) => {
    const { leadId, name, text, time, type } = req.body || {};
    if (!leadId || !text) return res.status(400).json({ error: "Missing leadId or text" });
    const allowedTags = scopeTagsForUser(req.user);
    if (allowedTags) {
      const lead = await getContactById(leadId);
      if (!lead || !allowedTags.includes(lead.tag)) {
        return res.status(403).json({ error: "Not found" });
      }
    }
    const conversationId = await logCall({ leadId, name, text, time, type });
    res.status(201).json({ conversationId });
  })
);
app.delete(
  "/api/conversations",
  dbRoute(async (req, res) => {
    if (scopeTagsForUser(req.user)) {
      return res.status(403).json({ error: "Not allowed to delete conversations." });
    }
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
app.patch(
  "/api/dial-lists",
  dbRoute(async (req, res) => {
    const { id, leadIds } = req.body || {};
    if (!id || !Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: "Missing id or leadIds" });
    }
    const list = await addLeadsToDialList(id, leadIds);
    if (!list) return res.status(404).json({ error: "Powerlist not found" });
    res.json(list);
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

app.get("/api/call-log", dbRoute(async (req, res) => res.json(await getCallLog(scopeTagsForUser(req.user)))));
app.post(
  "/api/call-log",
  dbRoute(async (req, res) =>
    res.status(201).json(
      await addCallLogEntry({
        ...(req.body || {}),
        userId: String(req.user.id),
        userName: req.user.name || req.user.email || "Unknown",
      })
    )
  )
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
