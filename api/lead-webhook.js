// Public endpoint (no session cookie required) — reachable at
// /api/lead-webhook?token=<the CRM's one API key>. The token in the
// URL is the same single API key shown in Settings (see
// api/api-keys.js) — there's no per-tag token anymore, so which
// Contacts tab a lead lands on comes from a "tag" (or "client") field
// in the posted data instead of from which URL was used. Paste this
// one URL into whatever a lead comes from (a form's webhook, Zapier/
// Make, GoHighLevel, Meta Lead Ads via Zapier, …) and map its tag
// field to whichever Contacts tag it should land on — see
// PUBLIC_PATHS in server/index.js.
import { ensureSchema, findApiKeyByHash, touchApiKeyLastUsed, importContactsBulk } from "../server/db.js";
import { hashApiKey } from "../server/auth.js";

// Lead-gen platforms don't agree on field names, so accept the common
// spellings for each core field rather than forcing every integrator
// to remap in Zapier/Make first.
const CORE_ALIASES = {
  name: ["name", "full_name", "fullName", "fullname"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "mobile_number"],
  email: ["email", "email_address", "emailAddress"],
  notes: ["notes", "message", "comment", "comments"],
};
const OTHER_RECOGNIZED_KEYS = [
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
];
const RECOGNIZED_KEYS = new Set(Object.values(CORE_ALIASES).flat().concat(OTHER_RECOGNIZED_KEYS));
const FALLBACK_TAG = "Uncategorized";

function pick(body, keys) {
  for (const key of keys) {
    const v = body?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function nameFromBody(body) {
  const direct = pick(body, CORE_ALIASES.name);
  if (direct) return direct;
  const first = pick(body, ["first_name", "firstName"]);
  const last = pick(body, ["last_name", "lastName"]);
  return [first, last].filter(Boolean).join(" ").trim();
}

// Everything not recognized as a core field becomes a custom Contacts
// column, same as a bulk sheet import — a lead source can ask
// whatever extra questions it wants and they still show up on the lead.
function leadFromBody(body) {
  const fields = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (RECOGNIZED_KEYS.has(key)) continue;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    fields[key] = value;
  }
  // Which Contacts tab this lands on — one shared webhook URL now
  // covers every tag, so the tag has to come from the posted data
  // itself (map it to whichever field the source platform sends).
  const tag = pick(body, ["tag", "client"]) || FALLBACK_TAG;
  return {
    name: nameFromBody(body) || "Unknown",
    email: pick(body, CORE_ALIASES.email),
    phone: pick(body, CORE_ALIASES.phone),
    notes: pick(body, CORE_ALIASES.notes),
    status: (body?.status && String(body.status).trim()) || "New Lead",
    lastContact: "Today",
    leadDate: body?.lead_date || body?.leadDate || new Date().toISOString().slice(0, 10),
    tag,
    client: tag,
    fields,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
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
    const payloads =
      req.method === "GET" ? [{ ...req.query }] : Array.isArray(req.body) ? req.body : [req.body];
    const withPhone = payloads.filter((b) => b && pick(b, CORE_ALIASES.phone));
    const skipped = payloads.length - withPhone.length;
    if (!withPhone.length) {
      return res.status(400).json({ error: "No phone number found in the request body" });
    }

    const records = withPhone.map((b) => leadFromBody(b));
    const result = await importContactsBulk(records);
    return res.status(200).json({ ok: true, ...result, skipped });
  } catch (err) {
    console.error("[api/lead-webhook]", err);
    return res.status(500).json({ error: err.message || "Webhook failed" });
  }
}
