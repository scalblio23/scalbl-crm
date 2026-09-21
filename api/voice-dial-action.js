// Public endpoint — the `action` of the single-line <Dial> (see
// server/twilioCore.js's buildVoiceTwiml). Twilio posts here once the
// rep's <Dial> to a lead ends, and the response decides what the rep's
// own leg does next: join the live-transfer conference if a transfer
// just pulled the lead out of the bridge, or hang up because the call
// is simply over. No auth: Twilio is the only caller, same trust
// model as /api/voice, and the worst a stray request can get back is
// a <Hangup/>.
import { buildDialActionTwiml } from "../server/twilioCore.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/xml");
  try {
    res.status(200).send(await buildDialActionTwiml(req.body || {}));
  } catch (err) {
    console.error("[api/voice-dial-action]", err);
    res.status(200).send("<Response><Hangup/></Response>");
  }
}
