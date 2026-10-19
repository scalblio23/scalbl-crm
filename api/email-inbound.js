import { timingSafeEqual } from "node:crypto";
import { ensureSchema, saveInboundEmail } from "../server/db.js";
import { fetchReceivedEmail, parseAddress } from "../server/email.js";

// POST /api/email-inbound?key=<RESEND_INBOUND_SECRET>
//
// Resend's "email.received" webhook (Resend → Webhooks → Add Webhook →
// this URL, event "email.received"). Emails to any address on the
// domain Resend receives for land in Conversations → Email.
//
// Nothing in the posted body is trusted: only its email id is used, and
// the email itself is fetched back from Resend with our own API key —
// so a forged request can't plant an email, at most make us re-fetch a
// real one. The ?key= just keeps strangers from hitting it at all.

function keyMatches(given, secret) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return res.status(503).json({ error: "RESEND_INBOUND_SECRET is not set" });
  if (!keyMatches(req.query?.key, secret)) return res.status(401).json({ error: "Invalid key" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (body?.type !== "email.received") return res.status(200).json({ ok: true, ignored: body?.type || "unknown" });
  const id = body?.data?.email_id;
  if (!id) return res.status(200).json({ ok: false, ignored: "no email_id" });

  try {
    await ensureSchema();
    const email = await fetchReceivedEmail(id);
    const from = parseAddress(email.from);
    const saved = await saveInboundEmail({
      resendId: email.id || id,
      fromEmail: from.email,
      fromName: from.name,
      to: email.to || [],
      subject: email.subject || "",
      text: email.text || "",
      html: email.html || "",
      receivedAt: email.created_at,
      messageId: email.message_id || "",
    });
    return res.status(200).json({ ok: true, stored: Boolean(saved) });
  } catch (err) {
    // 500 so Resend retries (it keeps the email either way).
    console.error("[api/email-inbound]", err);
    return res.status(500).json({ error: "Could not store the email" });
  }
}
