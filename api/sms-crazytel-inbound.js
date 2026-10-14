import { createHash, timingSafeEqual } from "node:crypto";
import { getSmsRuntime } from "../server/smsRuntime.js";
import { normalizeNumber, auToInternational } from "../server/smsPolicy.js";

// POST /api/sms-crazytel-inbound?key=<CRAZYTEL_SMS_WEBHOOK_SECRET>
//
// Where Crazytel forwards a reply to one of our numbers (Crazytel portal
// → Number Management → My Numbers → the number → Forward Inbound SMS →
// webhook to this URL). The reply goes into the same thread as the
// texts we sent that contact (Conversations → Crazytel SMS).
//
// Crazytel's forwarding payload isn't publicly documented, so the field
// names below cover the common spellings; anything we can't read is
// logged in full ("[sms-crazytel-inbound] unrecognized payload") so the
// mapping can be fixed from one real example.

function first(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function toE164(value) {
  try {
    return normalizeNumber(auToInternational(value));
  } catch {
    return null;
  }
}

function keyMatches(given, secret) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!["POST", "GET"].includes(req.method)) {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  let runtime;
  try {
    runtime = getSmsRuntime();
  } catch (err) {
    return res.status(503).json({ error: err.message || "SMS is not configured" });
  }
  if (!runtime.secret) return res.status(503).json({ error: "CRAZYTEL_SMS_WEBHOOK_SECRET is not set" });
  if (!keyMatches(req.query?.key, runtime.secret)) return res.status(401).json({ error: "Invalid key" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = Object.fromEntries(new URLSearchParams(body));
    }
  }
  const { key: _key, ...query } = req.query || {};
  const payload = { ...query, ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}) };
  // Some providers nest the message one level down.
  const msg = payload.data && typeof payload.data === "object" ? { ...payload, ...payload.data } : payload;

  const from = toE164(first(msg, ["from", "From", "source", "sender", "msisdn", "caller_id", "callerid", "src"]));
  const to = toE164(first(msg, ["to", "To", "destination", "did", "recipient", "dst", "number"]));
  const text = first(msg, ["text", "message", "body", "Body", "content", "msg"]);
  const did = to && runtime.dids.find((d) => d.number === to);

  if (!from || !did || !text) {
    console.warn(
      "[sms-crazytel-inbound] unrecognized payload",
      JSON.stringify({ payload: msg, parsed: { from, to, hasText: Boolean(text), knownNumber: Boolean(did) } })
    );
    // 200 so Crazytel doesn't keep retrying something we can't read;
    // the log line above is what to fix the mapping from.
    return res.status(200).json({ ok: false, ignored: true });
  }

  const providerId = first(msg, ["uuid", "id", "message_id", "messageId", "sms_id", "MessageSid"]);
  const receiptHash = createHash("sha256").update(JSON.stringify([from, to, text])).digest("hex");
  const eventId = providerId
    ? `crazytel:${providerId}`
    : `crazytel-hash:${createHash("sha256").update(JSON.stringify(msg)).digest("hex")}`;
  const ts = first(msg, ["timestamp", "received_at", "receivedAt", "date", "created_at"]);
  const parsedTs = ts ? new Date(/^\d+$/.test(ts) ? Number(ts) * (ts.length <= 10 ? 1000 : 1) : ts) : null;
  const receivedAt = parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : new Date();

  try {
    const result = await runtime.store.receive({ eventId, receiptHash, did, from, text, receivedAt });
    return res.status(200).json({ ok: true, duplicate: result.duplicate });
  } catch (err) {
    console.error("[sms-crazytel-inbound]", err);
    // Non-2xx so Crazytel retries; the receipt table makes a retry safe.
    return res.status(err.status && err.status < 500 ? 200 : 500).json({ error: "Could not save the SMS" });
  }
}
