import { requireAuth } from "../server/auth.js";
import { ensureSchema, getAiVoiceSettings } from "../server/db.js";
import {
  missingAiVoiceEnv,
  resolveAiVoiceEnv,
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
// client-role restriction, unlike Powerdialler/Multi Line/Soundboard
// (managing the API keys themselves is gated instead — see
// api/ai-voice-settings.js).
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    await ensureSchema();
    // A key saved in the Settings panel wins over the matching env
    // var — see aiVoiceCore.js's resolveAiVoiceEnv.
    const settings = await getAiVoiceSettings();
    const env = resolveAiVoiceEnv(settings);

    if (req.method === "GET") {
      // Lets the panel show "not configured, missing X" instead of
      // only discovering that after a caller's already recorded
      // something.
      return res.status(200).json({ missing: missingAiVoiceEnv(env) });
    }

    if (req.method === "POST") {
      const missing = missingAiVoiceEnv(env);
      if (missing.length) {
        return res.status(500).json({ error: `AI Voice is not configured. Missing: ${missing.join(", ")}` });
      }
      const { audioData, mimeType, history, systemPrompt } = req.body || {};
      if (!audioData || !mimeType) return res.status(400).json({ error: "Missing audio data" });
      if (audioData.length > AI_VOICE_MAX_AUDIO_BYTES * 1.4) {
        return res.status(400).json({ error: "That recording is too long — keep turns under ~30s." });
      }

      const audioBuffer = Buffer.from(audioData, "base64");
      const transcript = await transcribeAudio(audioBuffer, mimeType, env);
      if (!transcript.trim()) {
        // Silence, background noise, or a recording too short to
        // transcribe — not an error, just nothing to reply to.
        return res.status(200).json({ transcript: "", reply: "", audioData: null });
      }

      const safeHistory = Array.isArray(history) ? history.slice(-AI_VOICE_MAX_HISTORY_TURNS) : [];
      const reply = await getAiReply(
        { systemPrompt: systemPrompt || settings?.systemPrompt, history: safeHistory, userText: transcript },
        env
      );
      const replyAudio = await synthesizeSpeech(reply, env);

      return res.status(200).json({
        transcript,
        reply,
        audioData: replyAudio.toString("base64"),
        mimeType: "audio/mpeg",
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/ai-voice-turn]", err);
    return res.status(500).json({ error: err.message || "AI Voice turn failed" });
  }
}
