// Vercel serverless function — GET /api/call-recording?id=<call log
// id> streams that call's Twilio recording back as an MP3 download.
// See server/callRecording.js for the shared logic.
import { ensureSchema } from "../server/db.js";
import { requireAuth } from "../server/auth.js";
import { handleCallRecordingDownload } from "../server/callRecording.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    await ensureSchema();
    await handleCallRecordingDownload(req, res, user);
  } catch (err) {
    console.error("[api/call-recording]", err);
    if (!res.headersSent) res.status(500).json({ error: err.message || "Could not fetch the recording" });
    else res.destroy(err);
  }
}
