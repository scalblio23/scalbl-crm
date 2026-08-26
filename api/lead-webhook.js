// Public endpoint (no session cookie or API key) — reachable at
// /api/lead-webhook?token=<per-tag token>. The token in the URL *is*
// the auth: paste this one URL into whatever a lead comes from (a
// form's webhook, Zapier/Make, GoHighLevel, Meta Lead Ads via
// Zapier, …) and every new lead it posts lands in Contacts already
// on that tag's tab — see PUBLIC_PATHS in server/index.js, and the
// "Webhooks" panel on the Contacts sidebar for each tag's URL.
import { ensureSchema, findTagByWebhookToken, importContactsBulk } from "../server/db.js";

// Lead-gen platforms don't agree on field names, so accept the common
// spellings for each core field rather than forcing every integrator
// to remap in Zapier/Make first.
const CORE_ALIASES = {
  name: ["name", "full_name", "fullName", "fullname"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "mobile_number"],
  email: ["email", "email_address", "emailAddress"],
  notes: ["notes", "message", "comment", "comments"],
};
const OTHER_RECOGNIZED_KEYS = ["first_name", "firstName", "last_name", "lastName", "tag", "client", "status", "lead_date", "leadDate"];
const RECOGNIZED_KEYS = new Set(Object.values(CORE_ALIASES).flat().concat(OTHER_RECOGNIZED_KEYS));

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
function leadFromBody(body, tag) {
  const fields = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (RECOGNIZED_KEYS.has(key)) continue;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    fields[key] = value;
  }
  return {
    name: nameFromBody(body) || "Unknown",
    email: pick(body, CORE_ALIASES.email),
    phone: pick(body, CORE_ALIASES.phone),
    notes: pick(body, CORE_ALIASES.notes),
    status: (body?.status && String(body.status).trim()) || "New Lead",
    lastContact: "Today",
    leadDate: body?.lead_date || body?.leadDate || new Date().toISOString().slice(0, 10),
    // Which Contacts tab this lands on — fixed by the token, never
    // taken from the request body, so one webhook can't post leads
    // onto a different tag's tab.
    tag,
    client: tag,
    fields,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    await ensureSchema();

    const token = req.query?.token;
    if (!token) return res.status(401).json({ error: "Missing ?token= in the webhook URL" });
    const webhook = await findTagByWebhookToken(String(token));
    if (!webhook) return res.status(401).json({ error: "Invalid or revoked webhook token" });

    const payloads = Array.isArray(req.body) ? req.body : [req.body];
    const withPhone = payloads.filter((b) => b && pick(b, CORE_ALIASES.phone));
    const skipped = payloads.length - withPhone.length;
    if (!withPhone.length) {
      return res.status(400).json({ error: "No phone number found in the request body" });
    }

    const records = withPhone.map((b) => leadFromBody(b, webhook.tag));
    const result = await importContactsBulk(records);
    return res.status(200).json({ ok: true, tag: webhook.tag, ...result, skipped });
  } catch (err) {
    console.error("[api/lead-webhook]", err);
    return res.status(500).json({ error: err.message || "Webhook failed" });
  }
}
