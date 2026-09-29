// SIP voice gateway — a long-running process (npm run voice-gateway)
// that registers with the VoIPcloud/VoIPline SIP trunk and bridges
// browser softphones to it. It has to be its own always-on process:
// a SIP registration and RTP media need persistent sockets, which
// serverless functions (the /api/* Vercel deployment) can't hold.
//
// Browsers connect over WebSocket (see server/sip/gateway.js); the CRM
// backend's /api/token hands them the URL and a signed token.
import http from "http";
import dotenv from "dotenv";
import { loadSipConfig, missingSipEnv } from "./sip/config.js";
import { SipUserAgent } from "./sip/ua.js";
import { createVoiceGateway } from "./sip/gateway.js";
import { verifyGatewayToken, missingVoiceGatewayEnv } from "./voiceConfig.js";
import { isDbConfigured, ensureSchema, findContactByPhone, logMessage } from "./db.js";

dotenv.config();

const PORT = Number(process.env.VOICE_GATEWAY_PORT || 3002);

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

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    const status = ua.status();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: ua.isRegistered, ...status }));
    return;
  }
  res.writeHead(404).end();
});

createVoiceGateway({ ua, server, verifyToken: (t) => verifyGatewayToken(t), onMissedCall: logMissedCall });

server.listen(PORT, () => {
  console.log(`Voice gateway listening on :${PORT} (WebSocket path /voice, health /health)`);
  console.log(
    `[sip] trunk ${config.username}@${config.server}:${config.port}/${config.transport}, caller ID ${config.callerId}, ${config.maxChannels} channel(s)`
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
