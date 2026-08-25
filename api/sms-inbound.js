import { ensureSchema, findContactByPhone, logMessage } from "../server/db.js";

// POST /api/sms-inbound — Twilio's "A message comes in" webhook. Set
// this as the Messaging webhook on your Twilio number (Phone Numbers
// → your number → Messaging Configuration → A message comes in →
// POST https://<your-domain>/api/sms-inbound).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method not allowed");
  }

  // Twilio gives up on this webhook after ~15s (Error 11200 in the
  // Twilio logs if it does). Our database can occasionally take
  // longer than that to wake up from idle, so respond with the TwiML
  // immediately — it needs no database access — and only then do the
  // contact-matching and logging. Twilio's already got its 200 by the
  // time that runs, however long it takes.
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send("<Response></Response>");

  try {
    await ensureSchema();
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
  } catch (err) {
    // The response already went out — just log it. Twilio isn't
    // waiting on this, and there's no one left to tell.
    console.error("[api/sms-inbound]", err);
  }
}
