import { useEffect, useRef, useState } from "react";
import { Play, Loader2, AlertTriangle, RefreshCw, Download } from "lucide-react";
import { api } from "../lib/api";

// Inline player for a 'recording' message in the Conversation tab.
//
// Deliberately not a bare <audio src="/api/recording-audio?sid=…">.
// When the audio element fetches the file itself and anything goes
// wrong — a 401 because the session expired, a 502 because Twilio
// refused the media request, a body mangled on its way through the
// serverless streaming bridge — all the rep sees is a greyed-out play
// button and 0:00 / 0:00, with no way to tell which it was. Fetching
// the MP3 explicitly means:
//   - a failure shows up as a readable message with the server's
//     reason and a Retry button, instead of a dead control;
//   - the player is fed from an in-memory Blob, so playback never
//     depends on the proxy honouring Range requests or on how a
//     streamed response was framed — seeking and duration work
//     whatever route the bytes took;
//   - the same bytes back a Download link, so a recording can still
//     be saved and listened to elsewhere if the browser's player
//     won't decode it.
// Nothing is downloaded until Play is pressed (same as the old
// preload="none"), so a thread with many recordings stays cheap.
export default function RecordingPlayer({ recordingSid }) {
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState("");
  const [blobUrl, setBlobUrl] = useState("");
  const audioRef = useRef(null);

  // Release the object URL when the message unmounts or is reloaded.
  useEffect(() => {
    if (!blobUrl) return undefined;
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  // Start playing as soon as the bytes are in — Play was already
  // pressed, so this is the continuation of a user gesture; if the
  // browser still refuses, the controls are right there.
  useEffect(() => {
    if (state === "ready" && audioRef.current) audioRef.current.play().catch(() => {});
  }, [state, blobUrl]);

  const load = async () => {
    setState("loading");
    setError("");
    try {
      const raw = await api.blob(`/api/recording-audio?sid=${encodeURIComponent(recordingSid)}`);
      if (!raw.size) throw new Error("The recording came back empty.");
      // Pin the type: the browser picks its decoder from the Blob's
      // type, not from sniffing, and a proxy hop can lose the header.
      const blob = raw.type === "audio/mpeg" ? raw : new Blob([raw], { type: "audio/mpeg" });
      setBlobUrl(URL.createObjectURL(blob));
      setState("ready");
    } catch (err) {
      setError(err.message || "Could not load the recording.");
      setState("error");
    }
  };

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={load}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 text-xs font-medium"
      >
        <Play size={12} /> Play recording
      </button>
    );
  }

  if (state === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 size={12} className="animate-spin" /> Loading recording…
      </span>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-1.5 max-w-xs text-center">
        <span className="flex items-start gap-1.5 text-xs text-red-600">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </span>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 text-xs"
        >
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 max-w-full">
      <audio
        ref={audioRef}
        controls
        src={blobUrl}
        className="h-8 max-w-full"
        onError={() => {
          setError("Your browser couldn't play this file. Use Download to listen to it elsewhere.");
          setState("error");
        }}
      />
      <a
        href={blobUrl}
        download={`recording-${recordingSid}.mp3`}
        title="Download recording"
        className="p-1.5 rounded-full text-gray-500 hover:text-gray-800 hover:bg-white"
      >
        <Download size={14} />
      </a>
    </div>
  );
}
