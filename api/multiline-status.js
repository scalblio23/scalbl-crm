// Public endpoint — Twilio's status callback for one multi-line lead
// leg (see api/multiline-start.js). No session/API key: Twilio is the
// only caller, identified by knowing the batch/row ids baked into the
// callback URL, same trust model as /api/sms-inbound.
//
// This is where "first to answer wins" actually gets decided: the
// instant a leg's status turns "in-progress" (Twilio's name for
// answered-and-connected), it races to atomically claim the batch's
// winner slot. Win it, and this leg is left alone — it's already
// joining the conference via its own TwiML (see
// api/voice-multiline-leg.js). Lose it (another leg claimed it a
// moment earlier), and it gets hung up right here.
import {
  ensureSchema,
  updateMultilineBatchCallStatusByRowId,
  claimMultilineWinner,
  getOtherPendingMultilineBatchCalls,
} from "../server/db.js";
import { endOrCancelCall } from "../server/twilioCore.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const rowId = Number(req.query?.rowId);
    const batchId = Number(req.query?.batchId);
    const leadId = Number(req.query?.leadId);
    const callSid = req.body?.CallSid;
    const callStatus = req.body?.CallStatus;
    if (!rowId || !batchId || !callSid || !callStatus) {
      res.status(400).end();
      return;
    }

    await updateMultilineBatchCallStatusByRowId(rowId, callStatus);

    if (callStatus === "in-progress") {
      const won = await claimMultilineWinner({ batchId, callSid, leadId });
      if (won) {
        // Won — drop every other still-live leg in this batch. Fire
        // these without waiting on all of them before responding;
        // Twilio doesn't need to wait on it and a slow straggler
        // shouldn't hold up this webhook's response.
        const others = await getOtherPendingMultilineBatchCalls(batchId, callSid);
        Promise.all(others.filter((o) => o.call_sid).map((o) => endOrCancelCall(o.call_sid))).catch(() => {});
      } else {
        // Lost — someone else already won this batch a moment ago.
        await endOrCancelCall(callSid);
      }
    }

    res.status(204).end();
  } catch (err) {
    console.error("[api/multiline-status]", err);
    res.status(204).end(); // still 2xx — this is a Twilio webhook, retries wouldn't help
  }
}
