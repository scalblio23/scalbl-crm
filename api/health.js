// Vercel serverless function — visit https://<your-domain>/api/health
// to confirm the deployed site actually has the Twilio env vars set.
import { missingTwilioEnv } from "../server/twilioCore.js";

export default function handler(req, res) {
  const missing = missingTwilioEnv();
  res.status(200).json({ ok: missing.length === 0, missing });
}
