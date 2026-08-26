// Vercel serverless function — this is the URL to paste into the
// TwiML App's Voice webhook once deployed:
// https://<your-domain>/api/voice
import { buildVoiceTwiml, getCallerIdPool } from "../server/twilioCore.js";
import { ensureSchema, nextRotationIndex } from "../server/db.js";

export default async function handler(req, res) {
  const to = req.body?.To;
  const pool = getCallerIdPool();

  // Only bother with the rotation counter (a DB round-trip) when
  // there's actually more than one number to rotate through.
  let callerId = pool[0];
  if (pool.length > 1) {
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
