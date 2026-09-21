// Shared AI Voice logic — the "AI Voice" tab's speech-in → Claude →
// speech-out turn loop. Same split as twilioCore.js: this file holds
// the actual provider calls, used by both the local Express server
// (server/index.js, for `npm run dev:all`) and the Vercel serverless
// function (api/ai-voice-turn.js), so the two paths can't drift apart.
//
// This is deliberately the *simple* half of a Vapi-style voice agent:
// one HTTP round trip per conversational turn (record → transcribe →
// think → speak → play back), not a live, streaming, interruptible
// phone call. That's the real engineering difference between this and
// something like Vapi — see the pipeline below for where a future
// upgrade (Twilio Media Streams + streaming STT/TTS + barge-in) would
// slot in. For an MVP you can actually talk to today, turn-based is
// the right tradeoff: no WebSocket audio plumbing, no turn-taking
// state machine, just three REST calls.
import Anthropic from "@anthropic-ai/sdk";

const REQUIRED_ENV_KEYS = ["ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"];

export function missingAiVoiceEnv(env = process.env) {
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]);
}

// Every function below takes an `env`-shaped object rather than
// reading process.env directly, so a key entered in the AI Voice tab's
// own Settings panel (stored in the ai_voice_settings table — see
// server/db.js) can take priority over the .env-configured one without
// each provider call needing to know two different places to look.
// Callers build that object once per request with this: a saved
// setting wins, an unset/blank one falls through to the env var.
export function resolveAiVoiceEnv(settings, env = process.env) {
  return {
    ANTHROPIC_API_KEY: settings?.anthropicApiKey || env.ANTHROPIC_API_KEY,
    DEEPGRAM_API_KEY: settings?.deepgramApiKey || env.DEEPGRAM_API_KEY,
    ELEVENLABS_API_KEY: settings?.elevenlabsApiKey || env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: settings?.elevenlabsVoiceId || env.ELEVENLABS_VOICE_ID,
  };
}

// A generic, neutral ElevenLabs voice ("Rachel") — good enough to
// prove the pipeline out. Override per-deployment via
// ELEVENLABS_VOICE_ID once you've picked/cloned a voice in the
// ElevenLabs dashboard.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

// Mirrored client-side as the default textarea value in
// src/components/AIVoicePanel.jsx — keep the two in sync if this
// changes. Kept short and call-shaped on purpose: this text becomes
// spoken audio, so a bulleted list or a wall of text is actively bad
// output here, not just a style nit.
export const DEFAULT_SYSTEM_PROMPT =
  "You are a friendly, efficient AI voice assistant answering calls for a sales/CRM team. " +
  "Keep replies short and conversational — one or two sentences, like a real phone call, " +
  "never a bulleted list or a long paragraph. Ask one question at a time, and let the caller " +
  "drive rather than reciting information they didn't ask for.";

// A phone call doesn't need — or want the latency of — the model
// re-reading an unbounded transcript every turn. Keeping only the
// last few exchanges is both cheaper and faster; older context has
// rarely changed what the next reply should be by the time a call's
// gone on that long.
export const AI_VOICE_MAX_HISTORY_TURNS = 12;

// Rough cap on one recorded utterance, base64-encoded. Generous for
// ~30s of webm/opus at a talk-radio bitrate; mirrors the same
// "audioData.length > MAX * 1.4" sanity check soundboard clips use
// (api/soundboard-clips.js) — base64 runs ~4/3 the size of the raw
// bytes, so 1.4x is a safe margin without needing an exact figure.
export const AI_VOICE_MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2MB

// ---------- Speech to text (Deepgram, prerecorded) ----------
// Prerecorded (not streaming) — matches the turn-based shape above.
// Deepgram infers the codec from the Content-Type header, so this
// must be the *actual* mimeType MediaRecorder produced client-side,
// not a guess.
export async function transcribeAudio(audioBuffer, mimeType, env = process.env) {
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": mimeType || "audio/webm",
    },
    body: audioBuffer,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram transcription failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
}

// ---------- LLM reply (Claude) ----------
// Built fresh per call rather than cached at module scope — the key
// can change at runtime now (edited in the Settings panel), and
// constructing the SDK client is cheap (no connection setup).
function getAnthropicClient(env = process.env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// history: [{role: "user"|"assistant", content: "..."}], already
// trimmed to AI_VOICE_MAX_HISTORY_TURNS by the caller. Non-streaming
// is fine here — max_tokens is small (a phone reply is a sentence or
// two), well under anywhere near a request timeout.
export async function getAiReply({ systemPrompt, history, userText }, env = process.env) {
  const client = getAnthropicClient(env);
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 300,
    system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    // This is a live call, not a coding task — depth loses to
    // latency here. Adaptive thinking stays on (disabling it on Opus
    // 5 has its own failure modes), effort just stays low.
    output_config: { effort: "low" },
    messages: [...history, { role: "user", content: userText }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text?.trim() || "";
}

// ---------- Text to speech (ElevenLabs) ----------
// eleven_turbo_v2_5 trades a little voice quality for meaningfully
// lower synthesis latency — right call for something you're about to
// sit and wait to hear.
export async function synthesizeSpeech(text, env = process.env) {
  const voiceId = env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs synthesis failed (${res.status}): ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
