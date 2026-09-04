import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Mic, RefreshCw, Square, Volume2 } from "lucide-react";
import { api } from "../lib/api";

// Mirrors server/aiVoiceCore.js's DEFAULT_SYSTEM_PROMPT — shown as the
// starting point in the textarea below so what you see here is what
// actually runs until you change it.
const DEFAULT_SYSTEM_PROMPT =
  "You are a friendly, efficient AI voice assistant answering calls for a sales/CRM team. " +
  "Keep replies short and conversational — one or two sentences, like a real phone call, " +
  "never a bulleted list or a long paragraph. Ask one question at a time, and let the caller " +
  "drive rather than reciting information they didn't ask for.";

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

// The "AI Voice" tab: a push-to-talk MVP of a Vapi-style voice agent,
// built on this app's own infra instead of a third-party platform.
// One turn = one round trip (record → POST /api/ai-voice-turn →
// transcript + spoken reply back) rather than a live streaming phone
// call — see server/aiVoiceCore.js for why that's the right scope for
// a first version, and what a real-time upgrade (Twilio Media
// Streams, streaming STT/TTS, barge-in) would need on top of this.
export default function AIVoicePanel() {
  const [configMissing, setConfigMissing] = useState(null); // null = still loading
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
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
      .get("/api/ai-voice-turn")
      .then(({ missing }) => {
        if (!cancelled) setConfigMissing(missing || []);
      })
      .catch(() => {
        if (!cancelled) setConfigMissing([]); // fail open — a real attempt will surface the real error
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
      const data = await api.post("/api/ai-voice-turn", {
        audioData,
        mimeType: blob.type,
        history,
        systemPrompt,
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
        {configMissing === null && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Checking configuration…
          </div>
        )}

        {Array.isArray(configMissing) && configMissing.length > 0 && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              AI Voice isn't configured yet. Add these to your <code className="bg-amber-100 px-1 rounded">.env</code>{" "}
              (see <code className="bg-amber-100 px-1 rounded">.env.example</code>): {configMissing.join(", ")}.
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Agent settings — the system prompt is the whole personality/config surface for this MVP */}
        <div className="border border-gray-200 rounded-xl">
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
          >
            Agent settings
            <span className="text-xs text-gray-400">{showSettings ? "Hide" : "Show"}</span>
          </button>
          {showSettings && (
            <div className="px-4 pb-4">
              <label className="text-xs font-medium block mb-1.5 text-gray-500">System prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Applies to the next turn — changing it mid-conversation doesn't rewrite what's already been said.
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
            disabled={status === "processing" || status === "speaking" || (configMissing?.length ?? 0) > 0}
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
