// Vercel serverless function — visit https://<your-domain>/api/health
// to confirm the deployed site has the voice gateway and the database
// configured.
import { getVoiceProvider, missingVoiceGatewayEnv } from "../server/voiceConfig.js";
import { isDbConfigured } from "../server/db.js";

export default function handler(req, res) {
  const missing = missingVoiceGatewayEnv();
  const dbConfigured = isDbConfigured();
  res.status(200).json({
    ok: missing.length === 0 && dbConfigured,
    voiceProvider: getVoiceProvider(),
    missing,
    database: dbConfigured ? "connected" : "not configured — set POSTGRES_URL",
  });
}
