import {
  ensureSchema,
  getMultilineBatchById,
  getUnplacedMultilineBatchCalls,
  setMultilineBatchCallSid,
  setMultilineBatchCallFailed,
  mapWithConcurrency,
} from "../server/db.js";
import { missingTwilioEnv, placeConferenceLeg, publicBaseUrl } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/multiline-place-legs — body: { batchId }. Actually dials
// every lead reserved for this batch (see api/multiline-start.js),
// via the REST API, into the conference the rep's own browser leg
// already joined. Deliberately a separate step from multiline-start:
// the rep's own leg is what starts the conference (see
// buildConferenceTwiml's startConferenceOnEnter) — dialling a lead
// before that leg has actually connected drops the lead's call into
// the conference while it's still waiting to start, where it sits on
// hold hearing nothing until the rep catches up a moment later. A
// lead who answers fast enough to land in that window experiences
// exactly "I picked up and couldn't hear anyone." The frontend only
// calls this once its own conference leg has fired 'accept'.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const missing = missingTwilioEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
    }
    const base = publicBaseUrl();
    if (!base) {
      return res.status(500).json({
        error:
          "Multi-line dialling needs PUBLIC_URL set (or a Vercel deployment) so Twilio can reach the per-call callback URLs it uses.",
      });
    }

    const batchId = Number(req.body?.batchId);
    if (!batchId) return res.status(400).json({ error: "Missing batchId" });
    const batch = await getMultilineBatchById(batchId);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    // Rows already carrying a call_sid were already placed — calling
    // this twice for the same batch (shouldn't happen, but cheap to
    // guard) only ever dials whatever's left.
    const rows = await getUnplacedMultilineBatchCalls(batchId);

    await mapWithConcurrency(rows, rows.length, async (row) => {
      try {
        const call = await placeConferenceLeg({
          to: row.phone,
          from: row.from_number,
          url: `${base}/api/voice-multiline-leg?conf=${encodeURIComponent(batch.conference_name)}`,
          statusCallback: `${base}/api/multiline-status?rowId=${row.id}&batchId=${batchId}&leadId=${row.lead_id}`,
        });
        await setMultilineBatchCallSid(row.id, call.sid);
      } catch (err) {
        console.error("[api/multiline-place-legs] leg failed", row.lead_id, err.message);
        await setMultilineBatchCallFailed(row.id, err.message);
      }
    });

    return res.status(200).json({ ok: true, placed: rows.length });
  } catch (err) {
    console.error("[api/multiline-place-legs]", err);
    return res.status(500).json({ error: err.message || "Could not dial this batch's leads" });
  }
}
