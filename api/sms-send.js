import { ensureSchema, logMessage, getContactById } from "../server/db.js";
import { sendSms, recordSentSms, missingSmsEnv } from "../server/sms.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";

// POST /api/sms-send — sends an outbound SMS via Crazytel and logs it
// onto the lead's conversation. Body: { leadId, name, phone, text }.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const missing = missingSmsEnv();
    if (missing.length) {
      return res.status(500).json({ error: `SMS is not configured. Missing: ${missing.join(", ")}` });
    }
    const { leadId, name, phone, text } = req.body || {};
    if (!phone || !text) return res.status(400).json({ error: "Missing phone or text" });

    // A client may only text leads under their own tags — never an
    // arbitrary number. Mirrors server/index.js.
    const allowedTags = scopeTagsForUser(user);
    const lead = leadId ? await getContactById(leadId) : null;
    if (allowedTags && (!lead || !allowedTags.includes(lead.tag))) {
      return res.status(403).json({ error: "You can only message your own leads." });
    }

    const sent = await sendSms({ to: phone, body: text, tag: lead?.tag });
    await recordSentSms(sent, phone, text);

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
