// Public endpoint (no session cookie or API key) — reachable at
// /api/lead-webhook?token=<per-client token>. The token in the URL
// *is* the auth: paste this one URL into whatever a client's leads
// come from (a form's webhook, Zapier/Make, GoHighLevel, Meta Lead
// Ads via Zapier, …) and every new lead it posts lands in Contacts
// already tagged into that client's tab — see PUBLIC_PATHS in
// server/index.js and the Clients tab in the app for each client's URL.
import { ensureSchema, findClientByWebhookToken, importContactsBulk } from "../server/db.js";

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
// column, same as a bulk sheet import — a client's form can ask
// whatever extra questions it wants and they still show up on the lead.
function leadFromBody(body, client) {
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
    // Which Contacts tab this lands on — a client's row name rarely
    // matches their actual tag naming (e.g. "2. Wilco Rel..."), so
    // this is whatever tag was picked for the webhook in the Clients
    // tab (client.fields.webhook_tag), falling back to the client's
    // name only if that was never set. Deliberately never taken from
    // the request body, so one client's webhook can't land leads on
    // another client's tab. `client` stays the client's real name
    // regardless, so Reports-by-client stays accurate even when the
    // tag has been pointed somewhere else.
    tag: client.fields?.webhook_tag || client.name,
    client: client.name,
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
    const client = await findClientByWebhookToken(String(token));
    if (!client) return res.status(401).json({ error: "Invalid or revoked webhook token" });

    const payloads = Array.isArray(req.body) ? req.body : [req.body];
    const withPhone = payloads.filter((b) => b && pick(b, CORE_ALIASES.phone));
    const skipped = payloads.length - withPhone.length;
    if (!withPhone.length) {
      return res.status(400).json({ error: "No phone number found in the request body" });
    }

    const records = withPhone.map((b) => leadFromBody(b, client));
    const result = await importContactsBulk(records);
    return res.status(200).json({ ok: true, client: client.name, ...result, skipped });
  } catch (err) {
    console.error("[api/lead-webhook]", err);
    return res.status(500).json({ error: err.message || "Webhook failed" });
  }
}
