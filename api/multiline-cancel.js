import { ensureSchema, getOtherPendingMultilineBatchCalls } from "../server/db.js";
import { endOrCancelCall } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/multiline-cancel — body: { batchId }. Called when the rep
// hangs up (or their own leg fails to connect) before any line in the
// batch has answered, so every still-ringing/placed leg gets dropped
// instead of continuing to ring out on its own. Safe to call even
// after a winner's already been decided — there's simply nothing left
// pending to cancel at that point.
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
    const batchId = Number(req.body?.batchId);
    if (!batchId) return res.status(400).json({ error: "Missing batchId" });
    const pending = await getOtherPendingMultilineBatchCalls(batchId, null);
    await Promise.all(pending.filter((c) => c.call_sid).map((c) => endOrCancelCall(c.call_sid)));
    return res.status(204).end();
  } catch (err) {
    console.error("[api/multiline-cancel]", err);
    return res.status(500).json({ error: err.message || "Could not cancel the batch" });
  }
}
