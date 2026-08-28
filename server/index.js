// Local dev backend (used with `npm run dev:all`) — Twilio calling
// plus the database API. The deployed site uses the equivalent
// functions in /api instead; both paths share their logic from
// server/twilioCore.js and server/db.js.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  missingTwilioEnv,
  mintAccessToken,
  buildVoiceTwiml,
  buildConferenceTwiml,
  getCallerIdPool,
  sendSms,
  generateMultilineConferenceName,
  placeConferenceLeg,
  endOrCancelCall,
  publicBaseUrl,
} from "./twilioCore.js";
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
  getContactsByIds,
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
  mapWithConcurrency,
  getDialLists,
  createDialList,
  addLeadsToDialList,
  removeLeadFromDialLists,
  deleteDialList,
  getCalledLeadIds,
  markLeadCalled,
  getCallLog,
  addCallLogEntry,
  getUserByEmail,
  claimUserPassword,
  getApiKey,
  regenerateApiKey,
  deleteApiKey,
  findApiKeyByHash,
  touchApiKeyLastUsed,
  createMultilineBatch,
  addMultilineBatchCall,
  setMultilineBatchCallSid,
  updateMultilineBatchCallStatusByRowId,
  claimMultilineWinner,
  getOtherPendingMultilineBatchCalls,
  getMultilineBatchWithCalls,
  getUsers,
  getUserById,
  inviteUser,
  updateUser,
  deleteUserById,
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
  // Auth here is the CRM's single API key, passed in the URL itself
  // (?token=) and checked inside the route below — see
  // api/lead-webhook.js.
  "/api/lead-webhook",
  // Multi-line dialling's per-lead-leg TwiML and status callback —
  // Twilio-only, identified by the batch/row ids baked into the URL
  // (see api/multiline-start.js), same trust model as /api/voice and
  // /api/sms-inbound above.
  "/api/voice-multiline-leg",
  "/api/multiline-status",
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
  [
    "/api/clients",
    "/api/client-columns",
    "/api/clients-import",
    "/api/contacts-import",
    "/api/contacts-bulk-import",
    "/api/dial-lists",
    "/api/sms-bulk-send",
    "/api/multiline-start",
    "/api/multiline-batch",
    "/api/multiline-cancel",
  ],
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

// ---------- API key (single global credential) ----------
// Session-only on purpose — a key should never be able to regenerate
// itself, so this checks getSessionUser directly rather than the
// global middleware's requireAuth (which also accepts a key). Also
// blocked for the client role — a key is equivalent to full admin
// access, so letting a tag-scoped client mint one would be a
// privilege escalation around their own scoping. There's only ever
// at most one key (see server/db.js) — it doubles as the token on
// /api/lead-webhook, replacing the old per-tag webhook tokens.
async function requireKeyManager(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Log in to manage the API key." });
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
    res.json(await getApiKey());
  })
);
app.post(
  "/api/api-keys",
  dbRoute(async (req, res) => {
    const user = await requireKeyManager(req, res);
    if (!user) return;
    const rawKey = generateApiKey();
    const row = await regenerateApiKey({
      key: rawKey,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 11),
      createdBy: user.id,
    });
    res.status(201).json(row);
  })
);
app.delete(
  "/api/api-keys",
  dbRoute(async (req, res) => {
    const user = await requireKeyManager(req, res);
    if (!user) return;
    await deleteApiKey();
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
    const [clients, clientColumnsData, contacts, contactColumnsData, conversations, dialLists, callLog] =
      await Promise.all([
        scoped ? [] : getClients(),
        scoped ? [] : getClientColumns(),
        getContacts(allowedTags),
        getContactColumns(),
        getConversations(allowedTags),
        scoped ? [] : getDialLists(),
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
  res.json({ token: mintAccessToken(identity), identity, callerIds: getCallerIdPool() });
});

// TwiML voice webhook. This is the URL you paste into the TwiML App's
// "Voice" config in the Twilio Console. Twilio hits this once the
// browser device places a call, and we tell it who to actually dial
// and what caller ID to show — mirroring GHL's "call bridges through
// our number" behaviour.
app.post("/api/voice", (req, res) => {
  res.type("text/xml");

  // Multi-line dialling: the rep's own browser leg connects here with
  // a Conference param (see src/lib/twilioDevice.js's joinConference)
  // instead of a To number — join them into that conference rather
  // than dialing out. See "Multi-line dialling" below.
  const conferenceName = req.body?.Conference;
  if (conferenceName) {
    return res.send(buildConferenceTwiml({ conferenceName, isRep: true }));
  }

  const pool = getCallerIdPool();
  // The browser picks which number to rotate to itself (see
  // src/lib/twilioDevice.js) and passes it through as a custom
  // connect() param — trust it as long as it's actually one of our
  // own numbers. No database round-trip on the hot path: falling back
  // to the first configured number if the passed one is missing or
  // invalid is a plain, instant default, not a second rotation pick.
  const requested = req.body?.callerId;
  const callerId = requested && pool.includes(requested) ? requested : pool[0];
  res.send(buildVoiceTwiml(req.body.To, callerId));
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

// ---------- Multi-line dialling ----------
// "Dial N leads at once, whoever answers first gets bridged to the
// rep, the rest get hung up" — see server/twilioCore.js's conference
// helpers and the matching api/multiline-*.js files, which this
// mirrors route-for-route.
const MULTILINE_MAX_LINES = 6;

app.post(
  "/api/multiline-start",
  dbRoute(async (req, res) => {
    const missing = missingTwilioEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
    }
    const base = publicBaseUrl();
    if (!base) {
      return res.status(500).json({
        error:
          "Multi-line dialling needs PUBLIC_URL set (or a Vercel deployment) so Twilio can reach the per-call callback URLs it uses.",
      });
    }
    const ids = Array.isArray(req.body?.leadIds) ? req.body.leadIds.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: "Select at least one lead to dial" });

    const contacts = await getContactsByIds(ids);
    const withPhone = contacts.filter((c) => c.phone).slice(0, MULTILINE_MAX_LINES);
    if (!withPhone.length) {
      return res.status(400).json({ error: "None of the selected leads have a phone number" });
    }

    const conferenceName = generateMultilineConferenceName();
    const batch = await createMultilineBatch({ conferenceName, createdBy: String(req.user.id) });
    const pool = getCallerIdPool();

    const candidates = await mapWithConcurrency(withPhone, withPhone.length, async (contact, i) => {
      const fromNumber = pool[i % pool.length];
      const row = await addMultilineBatchCall({
        batchId: batch.id,
        leadId: contact.id,
        name: contact.name,
        phone: contact.phone,
        fromNumber,
      });
      try {
        const call = await placeConferenceLeg({
          to: contact.phone,
          from: fromNumber,
          url: `${base}/api/voice-multiline-leg?conf=${encodeURIComponent(conferenceName)}`,
          statusCallback: `${base}/api/multiline-status?rowId=${row.id}&batchId=${batch.id}&leadId=${contact.id}`,
        });
        await setMultilineBatchCallSid(row.id, call.sid);
      } catch (err) {
        console.error("[multiline-start] leg failed", contact.id, err.message);
        await updateMultilineBatchCallStatusByRowId(row.id, "failed");
      }
      return { leadId: contact.id, name: contact.name, phone: contact.phone, fromNumber };
    });

    res.status(201).json({ batchId: batch.id, conferenceName, candidates });
  })
);

// Public — TwiML for one lead leg, joining it into the conference.
app.post("/api/voice-multiline-leg", (req, res) => {
  const conferenceName = req.query?.conf;
  res.type("text/xml");
  if (!conferenceName) return res.status(400).send("<Response><Say>Missing conference.</Say></Response>");
  res.send(buildConferenceTwiml({ conferenceName, isRep: false }));
});

// Public — Twilio's status callback for one lead leg. Decides the
// winner the instant a leg turns "in-progress" (answered) — see
// api/multiline-status.js for the full reasoning.
app.post("/api/multiline-status", async (req, res) => {
  try {
    await ensureSchema();
    const rowId = Number(req.query?.rowId);
    const batchId = Number(req.query?.batchId);
    const leadId = Number(req.query?.leadId);
    const callSid = req.body?.CallSid;
    const callStatus = req.body?.CallStatus;
    if (!rowId || !batchId || !callSid || !callStatus) return res.status(400).end();

    await updateMultilineBatchCallStatusByRowId(rowId, callStatus);

    if (callStatus === "in-progress") {
      const won = await claimMultilineWinner({ batchId, callSid, leadId });
      if (won) {
        const others = await getOtherPendingMultilineBatchCalls(batchId, callSid);
        Promise.all(others.filter((o) => o.call_sid).map((o) => endOrCancelCall(o.call_sid))).catch(() => {});
      } else {
        await endOrCancelCall(callSid);
      }
    }
    res.status(204).end();
  } catch (err) {
    console.error("[db] /api/multiline-status", err);
    res.status(204).end();
  }
});

app.get(
  "/api/multiline-batch",
  dbRoute(async (req, res) => {
    const id = Number(req.query?.id);
    if (!id) return res.status(400).json({ error: "Missing id" });
    const batch = await getMultilineBatchWithCalls(id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.setHeader("Cache-Control", "no-store");
    res.json(batch);
  })
);

app.post(
  "/api/multiline-cancel",
  dbRoute(async (req, res) => {
    const batchId = Number(req.body?.batchId);
    if (!batchId) return res.status(400).json({ error: "Missing batchId" });
    const pending = await getOtherPendingMultilineBatchCalls(batchId, null);
    await Promise.all(pending.filter((c) => c.call_sid).map((c) => endOrCancelCall(c.call_sid)));
    res.status(204).end();
  })
);

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

// Sends the same text to a batch of contacts (Bulk SMS tab — selected
// individually or by tag) via the one wired-in Twilio number/
// messaging service, logging each as an outbound message same as a
// single send. Mirrors api/sms-bulk-send.js.
const BULK_SMS_CONCURRENCY = 5;
app.post(
  "/api/sms-bulk-send",
  dbRoute(async (req, res) => {
    const missing = missingTwilioEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
    }
    const text = String(req.body?.text || "").trim();
    const ids = Array.isArray(req.body?.contactIds)
      ? Array.from(new Set(req.body.contactIds.map(Number).filter(Boolean)))
      : [];
    if (!text) return res.status(400).json({ error: "Missing message text" });
    if (!ids.length) return res.status(400).json({ error: "Select at least one contact" });

    const contacts = await getContactsByIds(ids);
    const withPhone = contacts.filter((c) => c.phone);
    const skipped = contacts.length - withPhone.length;
    const timeLabel = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });

    const results = await mapWithConcurrency(withPhone, BULK_SMS_CONCURRENCY, async (c) => {
      try {
        await sendSms({ to: c.phone, body: text });
        await logMessage({ leadId: c.id, name: c.name, text, time: timeLabel, type: "text", outgoing: true });
        return { id: c.id, name: c.name, ok: true };
      } catch (err) {
        return { id: c.id, name: c.name, ok: false, error: err.message || "Send failed" };
      }
    });

    const failed = results.filter((r) => !r.ok);
    res.status(200).json({ total: ids.length, sent: results.length - failed.length, failed, skipped });
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

// ---------- Lead webhook ----------
// Public — auth is the CRM's single API key in ?token=, not the
// session cookie (see PUBLIC_PATHS above and api/lead-webhook.js,
// which this mirrors). One shared URL for every source; which
// Contacts tag a lead lands on comes from a "tag"/"client" field in
// the posted data instead of from which URL was used.
const LEAD_WEBHOOK_CORE_ALIASES = {
  name: ["name", "full_name", "fullName", "fullname"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "mobile_number"],
  email: ["email", "email_address", "emailAddress"],
  notes: ["notes", "message", "comment", "comments"],
};
const LEAD_WEBHOOK_RECOGNIZED_KEYS = new Set(
  Object.values(LEAD_WEBHOOK_CORE_ALIASES)
    .flat()
    .concat([
      "first_name",
      "firstName",
      "last_name",
      "lastName",
      "tag",
      "client",
      "status",
      "lead_date",
      "leadDate",
      "token", // the auth token itself, present alongside lead data on a GET request
    ])
);
const LEAD_WEBHOOK_FALLBACK_TAG = "Uncategorized";

function leadWebhookPick(body, keys) {
  for (const key of keys) {
    const v = body?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function leadWebhookName(body) {
  const direct = leadWebhookPick(body, LEAD_WEBHOOK_CORE_ALIASES.name);
  if (direct) return direct;
  const first = leadWebhookPick(body, ["first_name", "firstName"]);
  const last = leadWebhookPick(body, ["last_name", "lastName"]);
  return [first, last].filter(Boolean).join(" ").trim();
}

function leadWebhookRecordFromBody(body) {
  const fields = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (LEAD_WEBHOOK_RECOGNIZED_KEYS.has(key)) continue;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    fields[key] = value;
  }
  const tag = leadWebhookPick(body, ["tag", "client"]) || LEAD_WEBHOOK_FALLBACK_TAG;
  return {
    name: leadWebhookName(body) || "Unknown",
    email: leadWebhookPick(body, LEAD_WEBHOOK_CORE_ALIASES.email),
    phone: leadWebhookPick(body, LEAD_WEBHOOK_CORE_ALIASES.phone),
    notes: leadWebhookPick(body, LEAD_WEBHOOK_CORE_ALIASES.notes),
    status: (body?.status && String(body.status).trim()) || "New Lead",
    lastContact: "Today",
    leadDate: body?.lead_date || body?.leadDate || new Date().toISOString().slice(0, 10),
    tag,
    client: tag,
    fields,
  };
}

async function handleLeadWebhook(req, res) {
  try {
    await ensureSchema();
    const token = req.query?.token;
    if (!token) return res.status(401).json({ error: "Missing ?token= in the webhook URL" });
    const keyRow = await findApiKeyByHash(hashApiKey(String(token)));
    if (!keyRow) return res.status(401).json({ error: "Invalid or revoked API key" });
    touchApiKeyLastUsed(keyRow.id).catch(() => {});

    // GET has no body — some simpler lead-gen platforms (and a quick
    // browser/curl test) can only fire a plain GET with the lead's
    // data as query params, so read from there instead. Only ever one
    // lead per GET, since there's no clean way to send an array of
    // leads in a query string.
    const payloads = req.method === "GET" ? [{ ...req.query }] : Array.isArray(req.body) ? req.body : [req.body];
    const withPhone = payloads.filter((b) => b && leadWebhookPick(b, LEAD_WEBHOOK_CORE_ALIASES.phone));
    const skipped = payloads.length - withPhone.length;
    if (!withPhone.length) return res.status(400).json({ error: "No phone number found in the request body" });

    const records = withPhone.map((b) => leadWebhookRecordFromBody(b));
    const result = await importContactsBulk(records);
    res.status(200).json({ ok: true, ...result, skipped });
  } catch (err) {
    console.error("[db] /api/lead-webhook", err);
    res.status(500).json({ error: err.message || "Webhook failed" });
  }
}
app.post("/api/lead-webhook", handleLeadWebhook);
app.get("/api/lead-webhook", handleLeadWebhook);

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
    const { id, leadIds, removeLeadId } = req.body || {};

    if (removeLeadId) {
      await removeLeadFromDialLists(removeLeadId);
      return res.json(await getDialLists());
    }

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
