import { endOrCancelCall } from "../server/twilioCore.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/transfer-cancel — body: { targetCallSid }. Drops the
// transfer target (still ringing, or already on the line) and leaves
// the rep and lead talking as before. Also fired best-effort when the
// rep ends the whole call mid-transfer, so a still-ringing target
// doesn't keep ringing on its own.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const sid = String(req.body?.targetCallSid || "");
  if (!/^CA[a-f0-9]{32}$/.test(sid)) return res.status(400).json({ error: "Missing targetCallSid" });
  try {
    await endOrCancelCall(sid);
    return res.status(204).end();
  } catch (err) {
    console.error("[api/transfer-cancel]", err);
    return res.status(500).json({ error: err.message || "Could not cancel the transfer" });
  }
}
