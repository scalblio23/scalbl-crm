import { fetchCallStatus } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// GET /api/transfer-status?leadCallSid=…&addedCallSid=… — polled by
// the browser during (and after) a live transfer to learn whether the
// added party has answered, and whether either leg has hung up.
// Nothing's stored server-side for transfers (see server/twilioCore.js),
// so this just asks Twilio about each leg directly. A leg Twilio no
// longer knows about (or a transient API error) reads as "unknown"
// rather than failing the poll — the next tick will try again.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const leadCallSid = String(req.query?.leadCallSid || "").trim();
    const addedCallSid = String(req.query?.addedCallSid || "").trim();
    if (!leadCallSid && !addedCallSid) return res.status(400).json({ error: "Missing call SIDs" });
    const lookup = (sid) => (sid ? fetchCallStatus(sid).catch(() => "unknown") : Promise.resolve(null));
    const [lead, added] = await Promise.all([lookup(leadCallSid), lookup(addedCallSid)]);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ lead, added });
  } catch (err) {
    console.error("[api/transfer-status]", err);
    return res.status(500).json({ error: err.message || "Could not check the transfer" });
  }
}
