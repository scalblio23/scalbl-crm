// SIP voice gateway — a long-running process (npm run voice-gateway)
// that registers with the VoIPcloud/VoIPline SIP trunk and bridges
// browser softphones to it. It has to be its own always-on process:
// a SIP registration and RTP media need persistent sockets, which
// serverless functions (the /api/* Vercel deployment) can't hold.
//
// Browsers connect over WebSocket (see server/sip/gateway.js); the CRM
// backend's /api/token hands them the URL and a signed token.
import fs from "fs";
import http from "http";
import path from "path";
import dotenv from "dotenv";
import { loadSipConfig, missingSipEnv } from "./sip/config.js";
import { SipUserAgent } from "./sip/ua.js";
import { createVoiceGateway } from "./sip/gateway.js";
import { CallRecorder, findRecordingFile, sweepRecordings } from "./sip/recorder.js";
import { verifyGatewayToken, verifyRecordingToken, missingVoiceGatewayEnv } from "./voiceConfig.js";
import {
  isDbConfigured,
  ensureSchema,
  findContactByPhone,
  getContactById,
  logMessage,
  logRecordingMessage,
  expireRecordingMessage,
} from "./db.js";

dotenv.config();

const PORT = Number(process.env.VOICE_GATEWAY_PORT || 3002);

// Call recording — on unless SIP_RECORDING=off. Files are kept on this
// machine for SIP_RECORDING_RETENTION_DAYS (45 by default), then
// deleted, and their conversation entries lose the player.
const RECORDING_ENABLED = !/^(off|false|0|no)$/i.test(process.env.SIP_RECORDING || "");
const RECORDINGS_DIR = path.resolve(process.env.SIP_RECORDINGS_DIR || "recordings");
const RETENTION_DAYS = Number(process.env.SIP_RECORDING_RETENTION_DAYS) || 45;
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";

const missing = [...missingSipEnv(), ...missingVoiceGatewayEnv().filter((m) => !m.startsWith("VOICE_GATEWAY_URL"))];
if (missing.length) {
  console.error(`✖ Voice gateway can't start — missing env: ${missing.join(", ")} (see .env.example)`);
  process.exit(1);
}

const config = loadSipConfig();
const ua = new SipUserAgent(config);

// A caller who rang and nobody picked up (or no rep was online) —
// logged onto their conversation so the callback isn't lost, the same
// way an inbound SMS is.
async function logMissedCall(call) {
  if (!isDbConfigured() || !call.remoteNumber) return;
  try {
    await ensureSchema();
    const contact = await findContactByPhone(call.remoteNumber);
    const time = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
    await logMessage({
      leadId: contact ? contact.id : null,
      name: contact ? contact.name : call.remoteNumber,
      text: `Missed call · ${time} · from ${call.remoteNumber}`,
      time,
      type: "call",
      outgoing: false,
    });
  } catch (err) {
    console.error("[gateway] could not log missed call:", err.message);
  }
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// A finished recording goes into the lead's conversation, where the
// same player as Twilio recordings plays it (via /api/recording-audio).
// One nobody can be matched to is deleted — nothing could ever show it.
async function saveRecording({ id, file, seconds, call }) {
  let lead = null;
  if (isDbConfigured()) {
    try {
      await ensureSchema();
      const contact =
        (call.leadId && (await getContactById(call.leadId))) ||
        (call.remoteNumber && (await findContactByPhone(call.remoteNumber)));
      if (contact) lead = { leadId: contact.id, name: contact.name };
      if (lead) {
        const time = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
        await logRecordingMessage({
          ...lead,
          text: `Call recording · ${formatDuration(seconds)}`,
          time,
          recordingSid: id,
        });
      }
    } catch (err) {
      console.error(`[recording] could not log ${id}:`, err.message);
      return; // keep the file; nothing references it, so the sweep clears it eventually
    }
  }
  if (!lead) {
    fs.rm(file, { force: true }, () => {});
    console.log(`[recording] ${id} (${call.remoteNumber}) matches no contact — not kept`);
    return;
  }
  console.log(`[recording] saved ${path.basename(file)} · ${seconds}s · lead ${lead.leadId}`);
}

async function sweep() {
  try {
    const removed = await sweepRecordings(RECORDINGS_DIR, RETENTION_DAYS);
    if (!removed.length) return;
    if (isDbConfigured()) {
      await ensureSchema();
      for (const id of removed) await expireRecordingMessage(id, RETENTION_DAYS);
    }
    console.log(`[recording] deleted ${removed.length} recording(s) older than ${RETENTION_DAYS} days`);
  } catch (err) {
    console.error("[recording] retention sweep failed:", err.message);
  }
}

// GET /recordings/<id> — the CRM backend fetching a recording for a
// logged-in user, with a token scoped to that one recording.
function serveRecording(req, res, id) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyRecordingToken(token, id)) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not authorised" }));
    return;
  }
  const found = findRecordingFile(RECORDINGS_DIR, id);
  if (!found) {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Recording not found" }));
    return;
  }
  const { size } = fs.statSync(found.file);
  res.writeHead(200, { "Content-Type": found.contentType, "Content-Length": String(size), "Cache-Control": "no-store" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(found.file).pipe(res);
}

const server = http.createServer((req, res) => {
  const recordingMatch = /^\/recordings\/([^/?]+)$/.exec(req.url.split("?")[0]);
  if (recordingMatch && (req.method === "GET" || req.method === "HEAD")) {
    serveRecording(req, res, recordingMatch[1]);
    return;
  }
  if (req.url === "/health" || req.url === "/") {
    const status = ua.status();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: ua.isRegistered, ...status }));
    return;
  }
  res.writeHead(404).end();
});

createVoiceGateway({
  ua,
  server,
  verifyToken: (t) => verifyGatewayToken(t),
  onMissedCall: logMissedCall,
  record: RECORDING_ENABLED ? () => new CallRecorder({ dir: RECORDINGS_DIR, ffmpegPath: FFMPEG_PATH }) : null,
  onRecording: saveRecording,
});

if (RECORDING_ENABLED) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

server.listen(PORT, () => {
  console.log(`Voice gateway listening on :${PORT} (WebSocket path /voice, health /health)`);
  console.log(
    `[sip] trunk ${config.username}@${config.server}:${config.port}/${config.transport}, caller ID ${config.callerId}, ${config.maxChannels} channel(s)`
  );
  console.log(
    RECORDING_ENABLED
      ? `[recording] on — ${RECORDINGS_DIR}, kept ${RETENTION_DAYS} days`
      : "[recording] off (SIP_RECORDING=off)"
  );
  ua.start();
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("Shutting down — hanging up calls and unregistering…");
  const timeout = setTimeout(() => process.exit(0), 3000);
  await ua.stop().catch(() => {});
  clearTimeout(timeout);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
