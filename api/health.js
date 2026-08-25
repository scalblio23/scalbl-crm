// Vercel serverless function — visit https://<your-domain>/api/health
// to confirm the deployed site has both Twilio and the database
// configured.
import { missingTwilioEnv } from "../server/twilioCore.js";
import { isDbConfigured } from "../server/db.js";

export default function handler(req, res) {
  const missing = missingTwilioEnv();
  const dbConfigured = isDbConfigured();
  res.status(200).json({
    ok: missing.length === 0 && dbConfigured,
    missing,
    database: dbConfigured ? "connected" : "not configured — set POSTGRES_URL",
  });
}
