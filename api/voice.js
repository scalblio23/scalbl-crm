// Vercel serverless function — this is the URL to paste into the
// TwiML App's Voice webhook once deployed:
// https://<your-domain>/api/voice
import { buildVoiceTwiml, buildConferenceTwiml, getCallerIdPool } from "../server/twilioCore.js";

export default function handler(req, res) {
  res.setHeader("Content-Type", "text/xml");

  // Multi-line dialling: the rep's own browser leg connects here with
  // a Conference param (see src/lib/twilioDevice.js's joinConference)
  // instead of a To number — join them into that conference rather
  // than dialing out, so whichever lead's leg (placed separately via
  // the REST API — see api/multiline-start.js) answers first can be
  // bridged to them.
  const conferenceName = req.body?.Conference;
  if (conferenceName) {
    return res.status(200).send(buildConferenceTwiml({ conferenceName, isRep: true }));
  }

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

  res.status(200).send(buildVoiceTwiml(to, callerId));
}
