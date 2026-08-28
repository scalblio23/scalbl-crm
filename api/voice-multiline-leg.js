// Public endpoint — the TwiML URL each multi-line lead leg is placed
// with (see api/multiline-start.js). Twilio fetches this once the
// lead's phone answers, and joins them into the shared conference
// alongside the rep's own leg. No auth: the conference name is a
// random per-batch token, same trust model as a webhook URL, and
// nothing here is destructive.
import { buildConferenceTwiml } from "../server/twilioCore.js";

export default function handler(req, res) {
  const conferenceName = req.query?.conf;
  res.setHeader("Content-Type", "text/xml");
  if (!conferenceName) {
    res.status(400).send("<Response><Say>Missing conference.</Say></Response>");
    return;
  }
  res.status(200).send(buildConferenceTwiml({ conferenceName, isRep: false }));
}
