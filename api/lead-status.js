// Public endpoint (no session cookie required) — reachable at
// /api/lead-status?token=<the CRM's one API key>, the same key and
// auth as /api/lead-webhook (an Authorization: Bearer / X-API-Key
// header works too). /api/lead-webhook only ever creates leads; this
// is its counterpart for changing an existing lead's status, found by
// its phone number and/or email rather than its CRM id — which is all
// an outside system like GHL or a Make scenario knows about it. E.g.
// a "booked" tag in GHL → POST here with { phone, email, status:
// "Booked" }. See PUBLIC_PATHS in server/index.js.
//
// Body (or query params on a GET), one lead or an array of them:
//   status  required — New Lead / No Answer / Booked / Not Interested
//   phone   and/or email (the usual aliases accepted), or id
//   tag     optional — only update the lead under this Contacts tag
//   notes   optional — appended to the lead's notes when it changes
import { ensureSchema, findApiKeyByHash, touchApiKeyLastUsed, setContactStatusByMatch } from "../server/db.js";
import { hashApiKey } from "../server/auth.js";

const ALIASES = {
  id: ["id", "contact_id", "contactId"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "mobile_number"],
  email: ["email", "email_address", "emailAddress"],
  status: ["status", "stage"],
  tag: ["tag", "client"],
  notes: ["notes", "note", "message"],
};

function pick(body, keys) {
  for (const key of keys) {
    const v = body?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function tokenFromRequest(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || "").trim());
  return String(req.query?.token || (bearer && bearer[1]) || req.headers?.["x-api-key"] || "").trim();
}

export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    await ensureSchema();

    const token = tokenFromRequest(req);
    if (!token) return res.status(401).json({ error: "Missing ?token= in the URL" });
    const keyRow = await findApiKeyByHash(hashApiKey(token));
    if (!keyRow) return res.status(401).json({ error: "Invalid or revoked API key" });
    touchApiKeyLastUsed(keyRow.id).catch(() => {});

    const payloads = req.method === "GET" ? [{ ...req.query }] : Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    for (const body of payloads) {
      const lookup = {
        id: pick(body, ALIASES.id),
        phone: pick(body, ALIASES.phone),
        email: pick(body, ALIASES.email),
      };
      const status = pick(body, ALIASES.status);
      if (!status) {
        results.push({ ...lookup, ok: false, error: "Missing status" });
        continue;
      }
      try {
        const { matched, updated } = await setContactStatusByMatch({
          ...lookup,
          status,
          tag: pick(body, ALIASES.tag),
          note: pick(body, ALIASES.notes),
        });
        results.push({ ...lookup, ok: true, matched, updated: updated.length, contacts: updated });
      } catch (err) {
        if (!err.statusCode) throw err;
        results.push({ ...lookup, ok: false, error: err.message });
      }
    }

    const updated = results.reduce((n, r) => n + (r.updated || 0), 0);
    const notFound = results.filter((r) => r.ok && r.matched === 0).length;
    const failed = results.filter((r) => !r.ok).length;
    // A single malformed request (one lead per call is the common case
    // from Make/GHL) gets a 400 so the caller sees it. No matching lead
    // is not an error — a GHL contact tagged "booked" may simply never
    // have been in the CRM — so it's a 200 with notFound counted, which
    // keeps a scheduled Make scenario from halting on it.
    if (payloads.length === 1 && failed) return res.status(400).json({ ok: false, error: results[0].error, results });
    return res.status(200).json({ ok: true, updated, notFound, failed, results });
  } catch (err) {
    console.error("[api/lead-status]", err);
    return res.status(500).json({ error: err.message || "Status update failed" });
  }
}
