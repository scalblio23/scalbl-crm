import { redirectCallToTwiml, buildConferenceTwiml } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/transfer-merge — body: { leadCallSid, conferenceName }.
// Takes the lead off hold and into the conference with the rep (and
// the added party, if they're still there). Used both for the actual
// "merge" and for bringing the lead straight back when the added
// party didn't answer or the rep changed their mind.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const leadCallSid = String(req.body?.leadCallSid || "").trim();
    const conferenceName = String(req.body?.conferenceName || "").trim();
    if (!leadCallSid || !conferenceName) return res.status(400).json({ error: "Missing leadCallSid or conferenceName" });
    try {
      await redirectCallToTwiml(leadCallSid, buildConferenceTwiml({ conferenceName, isRep: false }));
    } catch (err) {
      console.error("[api/transfer-merge] could not merge lead", err.message);
      return res.status(409).json({ error: "Couldn't bring the lead back in — they may have hung up while on hold." });
    }
    return res.status(204).end();
  } catch (err) {
    console.error("[api/transfer-merge]", err);
    return res.status(500).json({ error: err.message || "Could not merge the call" });
  }
}
