import { ensureSchema, getContactsByIds, logMessage, mapWithConcurrency } from "../server/db.js";
import { sendSms, missingTwilioEnv } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// Cap on how many outbound sends run at once — Twilio will happily
// queue more, but firing hundreds of REST calls in one tick from a
// single serverless invocation risks both a Twilio rate-limit error
// and the function's own execution time limit. 5 is plenty faster
// than sequential without either.
const CONCURRENCY = 5;

// POST /api/sms-bulk-send — sends the same text to a batch of
// contacts (selected individually or by tag on the Bulk SMS tab) via
// the one wired-in Twilio number/messaging service, logging each as
// an outbound message on that lead's conversation, same as a single
// send. Body: { contactIds: number[], text }.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
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

    const results = await mapWithConcurrency(withPhone, CONCURRENCY, async (c) => {
      try {
        await sendSms({ to: c.phone, body: text });
        await logMessage({ leadId: c.id, name: c.name, text, time: timeLabel, type: "text", outgoing: true });
        return { id: c.id, name: c.name, ok: true };
      } catch (err) {
        return { id: c.id, name: c.name, ok: false, error: err.message || "Send failed" };
      }
    });

    const failed = results.filter((r) => !r.ok);
    return res.status(200).json({
      total: ids.length,
      sent: results.length - failed.length,
      failed,
      skipped,
    });
  } catch (err) {
    console.error("[api/sms-bulk-send]", err);
    return res.status(500).json({ error: err.message || "Could not send the bulk message" });
  }
}
