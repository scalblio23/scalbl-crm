import { endOrCancelCall } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/transfer-drop — body: { callSids: string[] }. Hangs up (or
// cancels, if still ringing) the given legs of a live transfer: the
// added party when the rep drops them, or every parked/ringing leg when
// the rep hangs up while the lead is still on hold — which would
// otherwise leave the lead listening to hold music with nobody coming
// back. Best-effort by design: a leg that's already gone is a no-op.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const sids = (Array.isArray(req.body?.callSids) ? req.body.callSids : [req.body?.callSid])
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    if (!sids.length) return res.status(400).json({ error: "Missing callSids" });
    await Promise.all(sids.map((sid) => endOrCancelCall(sid)));
    return res.status(204).end();
  } catch (err) {
    console.error("[api/transfer-drop]", err);
    return res.status(500).json({ error: err.message || "Could not drop the call" });
  }
}
