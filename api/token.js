// Vercel serverless function — deployed automatically alongside the
// frontend at /api/token. Requires the same TWILIO_* env vars as
// local dev, set instead in the Vercel project's Environment Variables.
import { missingTwilioEnv, mintAccessToken, getCallerIdPool } from "../server/twilioCore.js";
import { requireAuth } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const missing = missingTwilioEnv();
  if (missing.length) {
    res.status(500).json({
      error: `Twilio is not configured. Missing: ${missing.join(", ")}`,
    });
    return;
  }

  const identity = req.query.identity || "rep";
  // Sent once per device registration (not per call) so the browser
  // can rotate through caller IDs itself — see src/lib/twilioDevice.js
  // — rather than asking the backend to pick one on every single call,
  // which meant every call waited on a database round-trip first.
  res.status(200).json({ token: mintAccessToken(identity), identity, callerIds: getCallerIdPool() });
}
