// Public endpoint — Twilio's status callback for one multi-line lead
// leg (see api/multiline-start.js). No session/API key: Twilio is the
// only caller, identified by knowing the batch/row ids baked into the
// callback URL, same trust model as /api/sms-inbound.
//
// This is where "first to answer wins" actually gets decided: the
// instant a leg's status turns "in-progress" (Twilio's name for
// answered-and-connected), it races to atomically claim the batch's
// winner slot. Every leg joins its conference muted (see
// buildConferenceTwiml) — winning is what unmutes this leg so the rep
// can actually hear it; losing (another leg claimed it a moment
// earlier) hangs it up right here. Until one of those happens, a leg
// sitting in the conference is silent to the rep either way, which is
// what actually prevents cross-talk between two leads answering close
// together (as opposed to just racing to hang up the loser fast
// enough — hanging up is still a REST round trip, but a muted leg
// mid-hangup was never audible in the first place).
import {
  ensureSchema,
  updateMultilineBatchCallStatusByRowId,
  claimMultilineWinner,
  getOtherPendingMultilineBatchCalls,
} from "../server/db.js";
import { endOrCancelCall, unmuteConferenceParticipant } from "../server/twilioCore.js";

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
        // Won — unmute this leg (the only thing that makes it audible
        // to the rep at all) and drop every other still-live leg,
        // concurrently. Genuinely awaited, not fire-and-forget: Twilio
        // webhooks have no tight response-time requirement that
        // needs it, and unawaited work here is exactly the kind that
        // can get cut off if the platform freezes the function right
        // after an early response (see the Automations fix earlier —
        // same underlying caveat with @vercel/functions' waitUntil()
        // applies to any unawaited async work, not just that one).
        const others = await getOtherPendingMultilineBatchCalls(batchId, callSid);
        await Promise.all([
          unmuteConferenceParticipant({ conferenceName: won.conference_name, callSid }).catch((err) =>
            console.error("[api/multiline-status] failed to unmute the winner", err)
          ),
          ...others
            .filter((o) => o.call_sid)
            .map((o) =>
              endOrCancelCall(o.call_sid).catch((err) =>
                console.error("[api/multiline-status] failed to hang up a losing leg", err)
              )
            ),
        ]);
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
