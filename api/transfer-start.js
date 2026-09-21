import {
  missingTwilioEnv,
  getCallerIdPool,
  findBridgedLeadLeg,
  redirectCallToTwiml,
  buildHoldTwiml,
  placeTransferLeg,
  endOrCancelCall,
  transferConferenceName,
  TRANSFER_RING_SECONDS,
} from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/transfer-start — body: { to, callerId?, parentCallSid?,
// leadCallSid?, conferenceName? }. Puts the lead on hold and rings
// `to` into a conference the rep is (about to be) in — see the "Live
// transfer" section of server/twilioCore.js for the whole picture.
//
// Two ways to say which call this is about: a plain single-line call
// passes the rep's own browser call SID (`parentCallSid`) and the
// lead's leg is looked up from it; a rep who's already in a
// conference (Multi Line, or a second transfer on the same call)
// passes the lead's leg (`leadCallSid`) and the conference directly.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const missing = missingTwilioEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
    }

    const to = String(req.body?.to || "").trim();
    if (!to) return res.status(400).json({ error: "Enter a number to add to the call" });

    const parentCallSid = String(req.body?.parentCallSid || "").trim();
    let leadCallSid = String(req.body?.leadCallSid || "").trim();
    let conferenceName = String(req.body?.conferenceName || "").trim();
    if (!leadCallSid) {
      if (!parentCallSid) return res.status(400).json({ error: "Missing parentCallSid" });
      const lead = await findBridgedLeadLeg(parentCallSid);
      if (!lead) return res.status(409).json({ error: "There's no live call with the lead to add anyone to." });
      leadCallSid = lead.sid;
      conferenceName = transferConferenceName(parentCallSid);
    }
    if (!conferenceName) return res.status(400).json({ error: "Missing conferenceName" });

    // Show the same number the lead's call is coming from — whichever
    // of our rotated caller IDs the browser said it used — as long as
    // it really is one of ours.
    const pool = getCallerIdPool();
    const requested = String(req.body?.callerId || "").trim();
    const from = requested && pool.includes(requested) ? requested : pool[0];

    // Ring the added party first: if Twilio rejects the number, nothing
    // has been touched yet and the rep is still talking to the lead.
    const added = await placeTransferLeg({ to, from, conferenceName });

    try {
      await redirectCallToTwiml(leadCallSid, buildHoldTwiml());
    } catch (err) {
      // Almost always "the lead hung up in the meantime" — undo the
      // one thing that did happen so a stranger doesn't get a ghost call.
      await endOrCancelCall(added.sid);
      console.error("[api/transfer-start] could not hold lead", err.message);
      return res.status(409).json({ error: "Couldn't put the lead on hold — did they just hang up?" });
    }

    return res.status(201).json({
      conferenceName,
      leadCallSid,
      addedCallSid: added.sid,
      to: added.to,
      from,
      ringSeconds: TRANSFER_RING_SECONDS,
    });
  } catch (err) {
    console.error("[api/transfer-start]", err);
    return res.status(500).json({ error: err.message || "Could not start the transfer" });
  }
}
