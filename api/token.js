// GET /api/token — hands a logged-in browser the SIP voice gateway's
// WebSocket URL and a short-lived signed token (see server/voiceConfig.js).
import { missingVoiceGatewayEnv, sipTokenResponse } from "../server/voiceConfig.js";
import { requireAuth } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const missing = missingVoiceGatewayEnv();
  if (missing.length) {
    res.status(500).json({ error: `Calling is not configured. Missing: ${missing.join(", ")}` });
    return;
  }
  res.status(200).json(sipTokenResponse(user));
}
