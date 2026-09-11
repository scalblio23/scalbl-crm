// Shared handler for GET /api/call-recording?id=<call log id> — used
// by both the Vercel function (api/call-recording.js) and the local
// Express server (server/index.js), so the two can't drift apart.
//
// Looks up the logged call, finds its Twilio recording (caching the
// recording SID on the entry the first time), and streams the MP3
// back as a file download. Twilio's media URLs need account
// credentials, so the browser can never be pointed at them directly.
import { getCallLogEntry, setCallLogRecordingSid } from "./db.js";
import { scopeTagsForUser } from "./auth.js";
import { missingTwilioEnv, findRecordingForCall, fetchRecordingAudio } from "./twilioCore.js";

function safeFilename(entry) {
  const who = String(entry.name || entry.phone || "call")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const when = entry.calledAt ? new Date(entry.calledAt).toISOString().slice(0, 16).replace(/[T:]/g, "-") : "";
  return `recording-${who || "call"}${when ? `-${when}` : ""}.mp3`;
}

// `user` is the already-authenticated caller. Sends the full response
// itself (JSON error or the audio stream).
export async function handleCallRecordingDownload(req, res, user) {
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Missing call log id" });
  }
  const missing = missingTwilioEnv();
  if (missing.length) {
    return res.status(500).json({ error: `Twilio is not configured. Missing: ${missing.join(", ")}` });
  }

  const entry = await getCallLogEntry(id);
  if (!entry) return res.status(404).json({ error: "Call not found" });

  // Same tag scoping as GET /api/call-log — a client-role account can
  // only pull recordings for calls it's allowed to see in the log.
  const allowedTags = scopeTagsForUser(user);
  if (allowedTags && !allowedTags.includes(entry.tag)) {
    return res.status(404).json({ error: "Call not found" });
  }

  if (!entry.hasRecording) {
    return res.status(404).json({ error: "This call was logged before call recording was enabled." });
  }

  let recordingSid = entry.recordingSid;
  if (!recordingSid) {
    const found = await findRecordingForCall({ callSid: entry.callSid, conferenceName: entry.conferenceName });
    if (!found) {
      return res.status(404).json({
        error:
          "No recording is available for this call yet. Twilio takes a little while after a call ends to process it — try again shortly.",
      });
    }
    recordingSid = found.sid;
    await setCallLogRecordingSid(id, recordingSid);
  }

  const { stream, contentLength } = await fetchRecordingAudio(recordingSid);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(entry)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  if (contentLength) res.setHeader("Content-Length", contentLength);
  res.status(200);
  stream.on("error", (err) => {
    console.error("[call-recording] stream error", err);
    res.destroy(err);
  });
  stream.pipe(res);
}
