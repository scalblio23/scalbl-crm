// Vercel serverless function — this is the URL to paste into the
// TwiML App's Voice webhook once deployed:
// https://<your-domain>/api/voice
import { buildVoiceTwiml, getCallerIdPool } from "../server/twilioCore.js";

export default function handler(req, res) {
  const to = req.body?.To;
  const pool = getCallerIdPool();

  // The browser picks which number to rotate to itself (see
  // src/lib/twilioDevice.js) and passes it through as a custom
  // connect() param — trust it as long as it's actually one of our
  // own numbers, so a stale/tampered value can't set an arbitrary
  // caller ID. No database round-trip on the hot path: falling back
  // to the first configured number if the passed one is missing or
  // invalid is a plain, instant default, not a second rotation pick.
  const requested = req.body?.callerId;
  const callerId = requested && pool.includes(requested) ? requested : pool[0];

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(buildVoiceTwiml(to, callerId));
}
