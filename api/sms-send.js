import { ensureSchema, logMessage } from "../server/db.js";
import { sendSms, missingTwilioEnv } from "../server/twilioCore.js";
import { requireAuth } from "../server/auth.js";

// POST /api/sms-send — sends an outbound SMS via Twilio and logs it
// onto the lead's conversation. Body: { leadId, name, phone, text }.
export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
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
    return res.status(201).json({ conversationId });
  } catch (err) {
    console.error("[api/sms-send]", err);
    return res.status(500).json({ error: err.message || "Could not send the message" });
  }
}
