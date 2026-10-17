// POST /api/booking-sms-status — Twilio's delivery status callback for
// patient reminder SMS (server/patientReminders.js passes this URL as
// each send's statusCallback, only when TWILIO_AUTH_TOKEN is set).
// Rejected unless Twilio's signature verifies.
import { ensureSchema } from "../server/db.js";
import { verifyTwilioSignature, candidateWebhookUrls, handleSmsStatusCallback } from "../server/patientReminders.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }
  const params = req.body || {};
  const verified = verifyTwilioSignature({
    signature: req.headers["x-twilio-signature"],
    urls: candidateWebhookUrls(req, "/api/booking-sms-status"),
    params,
  });
  if (!verified) return res.status(403).send("Invalid signature");
  try {
    await ensureSchema();
    await handleSmsStatusCallback({
      messageSid: params.MessageSid,
      status: params.MessageStatus,
      errorCode: params.ErrorCode,
    });
    return res.status(204).end();
  } catch (err) {
    console.error("[api/booking-sms-status]", err?.message || err);
    return res.status(500).end();
  }
}
