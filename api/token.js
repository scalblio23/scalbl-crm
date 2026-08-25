// Vercel serverless function — deployed automatically alongside the
// frontend at /api/token. Requires the same TWILIO_* env vars as
// local dev, set instead in the Vercel project's Environment Variables.
import { missingTwilioEnv, mintAccessToken } from "../server/twilioCore.js";

export default function handler(req, res) {
  const missing = missingTwilioEnv();
  if (missing.length) {
    res.status(500).json({
      error: `Twilio is not configured. Missing: ${missing.join(", ")}`,
    });
    return;
  }

  const identity = req.query.identity || "rep";
  res.status(200).json({ token: mintAccessToken(identity), identity });
}
