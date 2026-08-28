import { ensureSchema, getSoundboardClips, createSoundboardClip, deleteSoundboardClip } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// Base64 audio, so this is roughly what actually lands in the
// database per clip — generous for a spoken clip of a few seconds to
// half a minute, small enough not to bloat every GET.
const MAX_CLIP_BYTES = 2 * 1024 * 1024; // 2MB

// Quick-play clips for a live call — see src/lib/soundboardProcessor.js
// for how a clip actually gets mixed into the call's outgoing audio
// once played. Session/API-key only, same tier as Powerdialler/Multi
// Line themselves (a client role never reaches those tabs anyway).
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getSoundboardClips());
    }

    if (req.method === "POST") {
      const label = String(req.body?.label || "").trim();
      const audioData = String(req.body?.audioData || "");
      const mimeType = String(req.body?.mimeType || "").trim();
      if (!label) return res.status(400).json({ error: "Give the clip a label" });
      if (!audioData || !mimeType) return res.status(400).json({ error: "Missing audio data" });
      // Rough size check on the base64 itself (base64 runs ~4/3 the
      // size of the raw bytes, close enough for a sanity cap).
      if (audioData.length > MAX_CLIP_BYTES * 1.4) {
        return res.status(400).json({ error: "That clip is too long — keep it short." });
      }
      const created = await createSoundboardClip({ label, audioData, mimeType, createdBy: String(user.id) });
      return res.status(201).json(created);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteSoundboardClip(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/soundboard-clips]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
