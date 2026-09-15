import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Mic, RefreshCw, Square, Volume2 } from "lucide-react";
import { api } from "../lib/api";

// Picks the best mimeType the browser's MediaRecorder actually
// supports — Chrome/Firefox do webm/opus, Safari doesn't, and
// recording with an unsupported type fails silently rather than
// throwing. Deepgram is told this exact value as the Content-Type of
// what it's transcribing (see api/ai-voice-turn.js), so guessing
// wrong here breaks transcription, not just playback.
function pickRecorderMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return "";
}

// Reads a Blob into a base64 string (no data: URL prefix) — what the
// turn endpoint expects on the wire, same shape soundboard clips use
// (see src/SimpleCRM.jsx's soundboard recorder).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read the recording."));
    reader.readAsDataURL(blob);
  });
}

const STATUS_LABEL = {
  idle: "Tap the mic and talk",
  recording: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
};

// The three keys a turn can't run without — matched against
// api/ai-voice-settings.js's GET response (a saved value or an env
// fallback either one counts as "configured"). elevenlabsVoiceId is
// deliberately not in this list — it has a working built-in default.
const REQUIRED_KEY_LABELS = {
  anthropicApiKey: "Anthropic API key",
  deepgramApiKey: "Deepgram API key",
  elevenlabsApiKey: "ElevenLabs API key",
};
function missingRequiredKeys(settings) {
  if (!settings) return [];
  return Object.entries(REQUIRED_KEY_LABELS)
    .filter(([key]) => !settings[key] && !settings.envFallback?.[key])
    .map(([, label]) => label);
}

const EMPTY_DRAFT = {
  anthropicApiKey: "",
  deepgramApiKey: "",
  elevenlabsApiKey: "",
  elevenlabsVoiceId: "",
  systemPrompt: "",
};

// One password-style credential input with a show/hide toggle, plus
// an "using your .env" hint when the field is blank but the matching
// env var is set — see envFallback in api/ai-voice-settings.js. The
// env var's actual value is never sent to the browser, only whether
// one exists.
function KeyField({ label, hint, value, onChange, placeholder, usingEnvFallback }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5 text-gray-500">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full border border-gray-200 rounded-lg pl-3 pr-9 py-2 text-sm outline-none focus:border-gray-400 font-mono"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {value.trim() === "" && usingEnvFallback ? (
        <p className="text-xs text-blue-500 mt-1">Currently using the value from your server's .env.</p>
      ) : (
        hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>
      )}
    </div>
  );
}

// The "AI Voice" tab: a push-to-talk MVP of a Vapi-style voice agent,
// built on this app's own infra instead of a third-party platform.
// One turn = one round trip (record → POST /api/ai-voice-turn →
// transcript + spoken reply back) rather than a live streaming phone
// call — see server/aiVoiceCore.js for why that's the right scope for
// a first version, and what a real-time upgrade (Twilio Media
// Streams, streaming STT/TTS, barge-in) would need on top of this.
export default function AIVoicePanel() {
  // `settings` is the last-saved-and-fetched state (what actually
  // governs turns); `draft` is what's currently typed in the form.
  // Kept separate so editing a field doesn't change behavior until
  // "Save settings" is clicked — one predictable place instead of
  // some fields applying live and others needing a save.
  const [settings, setSettings] = useState(null); // null = still loading
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [settingsError, setSettingsError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [messages, setMessages] = useState([]); // [{role: "user"|"assistant", text}]
  const [status, setStatus] = useState("idle"); // idle | recording | processing | speaking
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioElRef = useRef(null);
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/ai-voice-settings")
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setDraft({
          anthropicApiKey: data.anthropicApiKey || "",
          deepgramApiKey: data.deepgramApiKey || "",
          elevenlabsApiKey: data.elevenlabsApiKey || "",
          elevenlabsVoiceId: data.elevenlabsVoiceId || "",
          systemPrompt: data.systemPrompt || "",
        });
      })
      .catch((err) => {
        if (!cancelled) setSettingsError(err.message || "Couldn't load AI Voice settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Stops the mic stream's tracks — separate from stopping the
  // MediaRecorder itself, since letting go of the stream is what
  // actually turns off the browser's "recording" indicator.
  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => releaseMic, []); // release the mic if the tab unmounts mid-recording

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsError("");
    try {
      const data = await api.patch("/api/ai-voice-settings", draft);
      setSettings(data);
      setDraft({
        anthropicApiKey: data.anthropicApiKey || "",
        deepgramApiKey: data.deepgramApiKey || "",
        elevenlabsApiKey: data.elevenlabsApiKey || "",
        elevenlabsVoiceId: data.elevenlabsVoiceId || "",
        systemPrompt: data.systemPrompt || "",
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setSettingsError(err.message || "Couldn't save AI Voice settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        sendTurn(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch {
      setError("Couldn't access your microphone — check the browser's permission prompt.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const sendTurn = async (blob) => {
    setStatus("processing");
    try {
      const audioData = await blobToBase64(blob);
      const history = messages.map((m) => ({ role: m.role, content: m.text }));
      // Uses the last-*saved* system prompt (settings, not draft) —
      // same "Save settings" applies everything at once" rule as the
      // API keys, rather than some fields going live as you type.
      const data = await api.post("/api/ai-voice-turn", {
        audioData,
        mimeType: blob.type,
        history,
        systemPrompt: settings?.systemPrompt,
      });

      if (!data.transcript) {
        setError("Didn't catch that — try talking a bit longer or closer to the mic.");
        setStatus("idle");
        return;
      }

      setMessages((prev) => [...prev, { role: "user", text: data.transcript }, { role: "assistant", text: data.reply }]);

      if (data.audioData) {
        setStatus("speaking");
        const el = audioElRef.current || new Audio();
        audioElRef.current = el;
        el.src = `data:${data.mimeType || "audio/mpeg"};base64,${data.audioData}`;
        el.onended = () => setStatus("idle");
        el.onerror = () => setStatus("idle");
        await el.play().catch(() => setStatus("idle"));
      } else {
        setStatus("idle");
      }
    } catch (err) {
      setError(err.message || "That turn failed — try again.");
      setStatus("idle");
    }
  };

  const handleMicClick = () => {
    if (status === "recording") stopRecording();
    else if (status === "idle") startRecording();
    // processing/speaking: ignore clicks — nothing useful to interrupt yet in this MVP
  };

  const resetConversation = () => {
    setMessages([]);
    setError("");
  };

  const missing = missingRequiredKeys(settings);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AI Voice</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Talk to an AI assistant built into the CRM — no third-party voice platform.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={resetConversation}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <RefreshCw size={14} />
            New conversation
          </button>
        )}
      </div>

      <div className="p-8 max-w-2xl mx-auto space-y-5">
        {settings === null && !settingsError && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Checking configuration…
          </div>
        )}

        {missing.length > 0 && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              AI Voice isn't configured yet — add these below under Settings (or to your{" "}
              <code className="bg-amber-100 px-1 rounded">.env</code>): {missing.join(", ")}.
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Settings — API keys + the agent's system prompt, saved to the DB so no .env edit/redeploy is needed */}
        <div className="border border-gray-200 rounded-xl">
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
          >
            Settings
            <span className="text-xs text-gray-400">{showSettings ? "Hide" : "Show"}</span>
          </button>
          {showSettings && (
            <div className="px-4 pb-4 space-y-4">
              {settingsError && (
                <div className="flex items-start gap-2 text-xs text-red-600">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {settingsError}
                </div>
              )}

              <KeyField
                label="Anthropic API key"
                hint="Powers the assistant's replies (Claude). console.anthropic.com → Settings → API Keys."
                value={draft.anthropicApiKey}
                onChange={(v) => setDraft((d) => ({ ...d, anthropicApiKey: v }))}
                placeholder="sk-ant-…"
                usingEnvFallback={settings?.envFallback?.anthropicApiKey}
              />
              <KeyField
                label="Deepgram API key"
                hint="Powers speech-to-text. console.deepgram.com → API Keys."
                value={draft.deepgramApiKey}
                onChange={(v) => setDraft((d) => ({ ...d, deepgramApiKey: v }))}
                placeholder="Deepgram API key"
                usingEnvFallback={settings?.envFallback?.deepgramApiKey}
              />
              <KeyField
                label="ElevenLabs API key"
                hint="Powers text-to-speech. elevenlabs.io → Profile → API Keys."
                value={draft.elevenlabsApiKey}
                onChange={(v) => setDraft((d) => ({ ...d, elevenlabsApiKey: v }))}
                placeholder="ElevenLabs API key"
                usingEnvFallback={settings?.envFallback?.elevenlabsApiKey}
              />
              <KeyField
                label="ElevenLabs voice ID (optional)"
                hint="Leave blank for a generic default voice — pick one from your Voice Library and copy its ID to override."
                value={draft.elevenlabsVoiceId}
                onChange={(v) => setDraft((d) => ({ ...d, elevenlabsVoiceId: v }))}
                placeholder="21m00Tcm4TlvDq8ikWAM"
                usingEnvFallback={settings?.envFallback?.elevenlabsVoiceId}
              />

              <div>
                <label className="text-xs font-medium block mb-1.5 text-gray-500">System prompt</label>
                <textarea
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
                  rows={4}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveSettings}
                  disabled={savingSettings || settings === null}
                  className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:bg-gray-300 flex items-center gap-1.5"
                >
                  {savingSettings && <Loader2 size={14} className="animate-spin" />}
                  Save settings
                </button>
                {justSaved && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <Check size={13} />
                    Saved
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">
                Applies once saved — including to the next turn of a conversation already in progress.
              </p>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="border border-gray-200 rounded-xl min-h-[220px] max-h-[420px] overflow-y-auto p-4 space-y-3 bg-gray-50">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 py-16">
              Nothing said yet — tap the mic to start.
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-800"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Mic control */}
        <div className="flex flex-col items-center gap-3 py-4">
          <button
            onClick={handleMicClick}
            disabled={status === "processing" || status === "speaking" || missing.length > 0}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
              status === "recording"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300"
            } text-white`}
          >
            {status === "recording" ? (
              <Square size={22} />
            ) : status === "processing" ? (
              <Loader2 size={22} className="animate-spin" />
            ) : status === "speaking" ? (
              <Volume2 size={22} />
            ) : (
              <Mic size={22} />
            )}
          </button>
          <div className="text-sm text-gray-500">{STATUS_LABEL[status]}</div>
        </div>
      </div>
    </div>
  );
}
