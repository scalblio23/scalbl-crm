// SIP trunk configuration for the voice gateway (server/voiceGateway.js).
// Everything is env-driven so the same code runs against VoIPcloud's
// VoIPline trunk today and any other SIP-registration trunk later —
// nothing here is VoIPcloud-specific except the defaults.
import { normalizeCallerId } from "./phone.js";

const DEFAULT_SERVER = "sipm5.au.voipcloud.online";

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadSipConfig(env = process.env) {
  const server = env.SIP_SERVER || DEFAULT_SERVER;
  const username = env.SIP_USERNAME || "";
  const callerId = normalizeCallerId(env.SIP_CALLER_ID || "");
  const [rtpPortMin, rtpPortMax] = String(env.SIP_RTP_PORTS || "10000-10999")
    .split("-")
    .map((p) => Number(p));

  return {
    server,
    port: num(env.SIP_PORT, 7060),
    // "tcp" (VoIPcloud's setting for this trunk) or "tls".
    transport: (env.SIP_TRANSPORT || "tcp").toLowerCase(),
    // The SIP domain/realm used in From/To/Request-URIs — usually the
    // same host as the registrar.
    domain: env.SIP_DOMAIN || server,
    username,
    authUsername: env.SIP_AUTH_USERNAME || username,
    password: env.SIP_PASSWORD || "",
    callerId,
    // The user part of the From header. VoIPcloud identifies the trunk
    // by its SIP username and presents the trunk's configured Caller ID,
    // so the default is the username; the caller ID is still asserted
    // via the display name, P-Asserted-Identity and Remote-Party-ID.
    // Set SIP_FROM_USER=+61480851534 if your provider wants it in From.
    fromUser: env.SIP_FROM_USER || username,
    // How the destination is written into the INVITE's Request-URI:
    //   e164          +61412345678 (default)
    //   e164-no-plus  61412345678
    //   national      0412345678
    dialFormat: env.SIP_DIAL_FORMAT || "e164",
    // Simultaneous calls the trunk allows (VoIPcloud "SIP Line MAX 1ch"
    // = 1). Raise this when you add channels — nothing else changes.
    maxChannels: Math.floor(num(env.SIP_MAX_CHANNELS, 1)),
    ringTimeoutSeconds: num(env.SIP_RING_TIMEOUT, 60),
    registerExpires: num(env.SIP_REGISTER_EXPIRES, 300),
    // G.711 only: A-law first (the Australian network default), u-law as
    // a fallback. The trunk also supports Opus/G.722, but G.711 needs no
    // transcoding library and is universally accepted.
    codecs: String(env.SIP_CODECS || "PCMA,PCMU")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c === "PCMA" || c === "PCMU"),
    // Public IP to advertise in SDP/Contact. Leave unset to use what the
    // registrar reports back (Via received=) — works behind most NATs.
    publicIp: env.SIP_PUBLIC_IP || "",
    rtpPortMin: rtpPortMin || 10000,
    rtpPortMax: rtpPortMax || rtpPortMin + 999 || 10999,
    // Optional: also accept SIP over TCP on this local port, for
    // providers that open a fresh connection for inbound calls instead
    // of reusing the registration's connection.
    listenPort: Number(env.SIP_LISTEN_PORT) || 0,
    keepaliveSeconds: num(env.SIP_KEEPALIVE_SECONDS, 25),
    userAgent: env.SIP_USER_AGENT || "ScalblCRM-VoiceGateway/1.0",
  };
}

export function missingSipEnv(env = process.env) {
  const missing = [];
  if (!env.SIP_USERNAME) missing.push("SIP_USERNAME");
  if (!env.SIP_PASSWORD) missing.push("SIP_PASSWORD");
  if (!env.SIP_CALLER_ID) missing.push("SIP_CALLER_ID");
  return missing;
}
