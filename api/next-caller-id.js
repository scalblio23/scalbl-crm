// POST /api/next-caller-id — advances the same rotation counter
// /api/voice uses and returns the number it picked, so the browser
// can show "Calling from +61…" *before* the call connects (and pass
// that exact number along so /api/voice doesn't pick a second,
// different one for the same call — see placeCall() in
// src/lib/twilioDevice.js).
import { ensureSchema, nextRotationIndex } from "../server/db.js";
import { requireAuth } from "../server/auth.js";
import { getCallerIdPool } from "../server/twilioCore.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const pool = getCallerIdPool();
    if (!pool.length) {
      return res.status(500).json({ error: "No Twilio caller ID configured." });
    }
    let callerId = pool[0];
    if (pool.length > 1) {
      await ensureSchema();
      const counter = await nextRotationIndex();
      callerId = pool[counter % pool.length];
    }
    return res.status(200).json({ callerId });
  } catch (err) {
    console.error("[api/next-caller-id]", err);
    return res.status(500).json({ error: err.message || "Could not pick a caller ID" });
  }
}
