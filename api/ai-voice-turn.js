import { requireAuth } from "../server/auth.js";
import {
  missingAiVoiceEnv,
  transcribeAudio,
  getAiReply,
  synthesizeSpeech,
  AI_VOICE_MAX_AUDIO_BYTES,
  AI_VOICE_MAX_HISTORY_TURNS,
} from "../server/aiVoiceCore.js";

// One turn of the "AI Voice" tab's push-to-talk loop: a base64
// recording in, a transcript + spoken reply out. See
// src/components/AIVoicePanel.jsx for the UI that calls this, and
// server/aiVoiceCore.js for the actual Deepgram → Claude → ElevenLabs
// pipeline this and server/index.js's equivalent route both share.
// Session/API-key only, same as every other authenticated tab — no
// client-role restriction, unlike Powerdialler/Multi Line/Soundboard.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === "GET") {
    // Lets the panel show "not configured, missing X" instead of
    // only discovering that after a caller's already recorded
    // something.
    return res.status(200).json({ missing: missingAiVoiceEnv() });
  }

  if (req.method === "POST") {
    try {
      const missing = missingAiVoiceEnv();
      if (missing.length) {
        return res.status(500).json({ error: `AI Voice is not configured. Missing: ${missing.join(", ")}` });
      }
      const { audioData, mimeType, history, systemPrompt } = req.body || {};
      if (!audioData || !mimeType) return res.status(400).json({ error: "Missing audio data" });
      if (audioData.length > AI_VOICE_MAX_AUDIO_BYTES * 1.4) {
        return res.status(400).json({ error: "That recording is too long — keep turns under ~30s." });
      }

      const audioBuffer = Buffer.from(audioData, "base64");
      const transcript = await transcribeAudio(audioBuffer, mimeType);
      if (!transcript.trim()) {
        // Silence, background noise, or a recording too short to
        // transcribe — not an error, just nothing to reply to.
        return res.status(200).json({ transcript: "", reply: "", audioData: null });
      }

      const safeHistory = Array.isArray(history) ? history.slice(-AI_VOICE_MAX_HISTORY_TURNS) : [];
      const reply = await getAiReply({ systemPrompt, history: safeHistory, userText: transcript });
      const replyAudio = await synthesizeSpeech(reply);

      return res.status(200).json({
        transcript,
        reply,
        audioData: replyAudio.toString("base64"),
        mimeType: "audio/mpeg",
      });
    } catch (err) {
      console.error("[api/ai-voice-turn]", err);
      return res.status(500).json({ error: err.message || "AI Voice turn failed" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
