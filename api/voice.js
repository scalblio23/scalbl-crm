// Vercel serverless function — this is the URL to paste into the
// TwiML App's Voice webhook once deployed:
// https://<your-domain>/api/voice
import { buildVoiceTwiml, getCallerIdPool } from "../server/twilioCore.js";
import { ensureSchema, nextRotationIndex } from "../server/db.js";

export default async function handler(req, res) {
  const to = req.body?.To;
  const pool = getCallerIdPool();

  // The browser normally already picked (and is displaying) the
  // caller ID via /api/next-caller-id before placing this call, and
  // passes it through as a custom connect() param — trust it as long
  // as it's actually one of our own numbers, so the number shown in
  // the UI is guaranteed to be the exact one Twilio dials from
  // (rather than each independently consuming a turn of the rotation
  // and landing on two different numbers for the same call).
  const requested = req.body?.callerId;
  let callerId = requested && pool.includes(requested) ? requested : pool[0];

  // Fallback path: no valid caller ID was passed (e.g. an older
  // client, or the /api/next-caller-id call failed) — pick one here
  // instead, the same way that endpoint does.
  if (!(requested && pool.includes(requested)) && pool.length > 1) {
    try {
      await ensureSchema();
      const counter = await nextRotationIndex();
      callerId = pool[counter % pool.length];
    } catch (err) {
      console.error("[api/voice] rotation lookup failed, using the first caller ID", err);
    }
  }

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(buildVoiceTwiml(to, callerId));
}
