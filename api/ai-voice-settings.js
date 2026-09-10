import { ensureSchema, getAiVoiceSettings, updateAiVoiceSettings } from "../server/db.js";
import { getSessionUser } from "../server/auth.js";
import { DEFAULT_SYSTEM_PROMPT } from "../server/aiVoiceCore.js";

const ENV_FALLBACK_KEYS = {
  anthropicApiKey: "ANTHROPIC_API_KEY",
  deepgramApiKey: "DEEPGRAM_API_KEY",
  elevenlabsApiKey: "ELEVENLABS_API_KEY",
  elevenlabsVoiceId: "ELEVENLABS_VOICE_ID",
};

// Whether a value is currently coming from process.env for each key,
// so the Settings panel can say "using the value from your server's
// .env" instead of just showing a blank box — without ever sending
// the env var's actual value to the browser. Only a value saved
// *through this same UI* (in the ai_voice_settings table) is ever
// echoed back in the clear, same as api_keys.raw_key.
function envFallbackFlags() {
  return Object.fromEntries(Object.entries(ENV_FALLBACK_KEYS).map(([key, envKey]) => [key, Boolean(process.env[envKey])]));
}

// The AI Voice tab's own Settings panel — lets the Anthropic/Deepgram/
// ElevenLabs API keys (and the default system prompt) be entered and
// changed in-app instead of requiring a .env edit + redeploy. See
// server/db.js's getAiVoiceSettings/updateAiVoiceSettings for the
// single-row storage and server/aiVoiceCore.js's resolveAiVoiceEnv for
// how a saved key takes priority over the matching env var.
//
// Session-only (not requireAuth, which also accepts an API key) and
// blocked for the client role — same reasoning as api/api-keys.js:
// these are billing-relevant third-party credentials, not something a
// tag-scoped client account should be able to read or rotate.
export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Log in to manage AI Voice settings." });
  }
  if (user.role === "client") {
    return res.status(403).json({ error: "Not available on this account." });
  }
  try {
    await ensureSchema();

    if (req.method === "GET") {
      const settings = (await getAiVoiceSettings()) || {
        anthropicApiKey: "",
        deepgramApiKey: "",
        elevenlabsApiKey: "",
        elevenlabsVoiceId: "",
        systemPrompt: "",
      };
      return res.status(200).json({
        ...settings,
        systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        envFallback: envFallbackFlags(),
      });
    }

    if (req.method === "PATCH") {
      const body = req.body || {};
      const patch = {};
      for (const key of ["anthropicApiKey", "deepgramApiKey", "elevenlabsApiKey", "elevenlabsVoiceId", "systemPrompt"]) {
        if (key in body) patch[key] = String(body[key] ?? "").trim();
      }
      const settings = await updateAiVoiceSettings(patch);
      return res.status(200).json({
        ...settings,
        systemPrompt: settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        envFallback: envFallbackFlags(),
      });
    }

    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/ai-voice-settings]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
