import { getCallStatus } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// GET /api/transfer-status?callSid=<target call> — polled by the
// browser every couple of seconds while a live transfer is up, to
// find out once the person being transferred to has answered
// ("in-progress"), didn't ("no-answer" / "busy" / "failed"), or has
// since hung up ("completed").
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const status = await getCallStatus(req.query?.callSid);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ status });
  } catch (err) {
    console.error("[api/transfer-status]", err);
    return res.status(err.status || 500).json({ error: err.message || "Could not read the transfer's status" });
  }
}
