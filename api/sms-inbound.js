import { ensureSchema, findContactByPhone, logMessage } from "../server/db.js";

// POST /api/sms-inbound — Twilio's "A message comes in" webhook. Set
// this as the Messaging webhook on your Twilio number (Phone Numbers
// → your number → Messaging Configuration → A message comes in →
// POST https://<your-domain>/api/sms-inbound).
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).send("Method not allowed");
    }

    const from = req.body?.From;
    const body = req.body?.Body || "";
    if (from) {
      const contact = await findContactByPhone(from);
      const timeLabel = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
      await logMessage({
        leadId: contact ? contact.id : null,
        name: contact ? contact.name : from,
        text: body,
        time: timeLabel,
        type: "text",
        outgoing: false,
      });
    }

    // Empty TwiML = receive the message, don't auto-reply.
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send("<Response></Response>");
  } catch (err) {
    console.error("[api/sms-inbound]", err);
    // Still respond with valid TwiML so Twilio doesn't show the
    // sender an error or retry indefinitely.
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send("<Response></Response>");
  }
}
