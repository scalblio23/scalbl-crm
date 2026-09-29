import { startLiveTransfer } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/transfer-start — body: { conferenceName, to, callerId,
// moveLead, callSid }. Starts a live transfer of the rep's current
// call to `to` — see server/twilioCore.js's "Live transfer" section
// for the full choreography. For a Powerdialler call (moveLead:
// true) `callSid` is the rep's own browser leg, whose connected lead
// gets moved into the conference; a Multi Line call is already in
// its conference, so it just passes that conference's name.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const result = await startLiveTransfer(req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    console.error("[api/transfer-start]", err);
    return res.status(err.status || 500).json({ error: err.message || "Could not start the transfer" });
  }
}
