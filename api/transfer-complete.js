import { handOffConference } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/transfer-complete — body: { conferenceName, repCallSid,
// targetCallSid }. The rep is about to drop off and leave the lead
// talking to the transfer target: hands conference ownership over so
// the rep hanging up no longer ends it (see handOffConference). The
// browser hangs the rep's leg up itself once this succeeds.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const result = await handOffConference(req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/transfer-complete]", err);
    return res.status(err.status || 500).json({ error: err.message || "Could not complete the transfer" });
  }
}
