// Which voice transport the Powerdialler uses, and the handshake
// between the CRM backend (Express locally / Vercel in production)
// and the SIP voice gateway (server/voiceGateway.js).
//
// With VOICE_PROVIDER=sip, /api/token no longer mints a Twilio Access
// Token — it hands the browser the gateway's WebSocket URL and a
// short-lived token signed with VOICE_GATEWAY_SECRET, which the
// gateway checks before letting that browser place or answer calls.
// The SIP credentials themselves only ever live on the gateway.
import jwt from "jsonwebtoken";

const AUDIENCE = "voice-gateway";

// "sip" or "twilio". Explicit VOICE_PROVIDER wins; otherwise SIP is
// used as soon as SIP credentials are configured.
export function getVoiceProvider(env = process.env) {
  const explicit = String(env.VOICE_PROVIDER || "").toLowerCase();
  if (explicit === "sip" || explicit === "twilio") return explicit;
  return env.SIP_USERNAME ? "sip" : "twilio";
}

function gatewaySecret(env = process.env) {
  return env.VOICE_GATEWAY_SECRET || env.SESSION_SECRET || "";
}

// Where browsers reach the gateway. Defaults to the local dev gateway
// (npm run voice-gateway) when not deployed.
export function voiceGatewayUrl(env = process.env) {
  if (env.VOICE_GATEWAY_URL) return env.VOICE_GATEWAY_URL.replace(/\/+$/, "");
  if (env.VERCEL) return "";
  return `ws://localhost:${env.VOICE_GATEWAY_PORT || 3002}/voice`;
}

// Env the CRM backend needs to hand out gateway tokens (the gateway
// has its own checks for the SIP credentials — see sip/config.js).
export function missingVoiceGatewayEnv(env = process.env) {
  const missing = [];
  if (!voiceGatewayUrl(env)) missing.push("VOICE_GATEWAY_URL");
  if (!gatewaySecret(env)) missing.push("VOICE_GATEWAY_SECRET (or SESSION_SECRET)");
  return missing;
}

export function mintGatewayToken(user, env = process.env) {
  return jwt.sign(
    { sub: String(user?.id ?? "rep"), name: user?.name || user?.email || "Rep", role: user?.role || "" },
    gatewaySecret(env),
    { audience: AUDIENCE, expiresIn: "10m" }
  );
}

// Returns the token's claims, or null if it's invalid/expired.
export function verifyGatewayToken(token, env = process.env) {
  try {
    return jwt.verify(String(token || ""), gatewaySecret(env), { audience: AUDIENCE });
  } catch {
    return null;
  }
}

// ---------- recordings ----------
// SIP call recordings live on the gateway (see server/sip/recorder.js).
// The CRM backend fetches them on a logged-in user's behalf with a
// short-lived token scoped to one recording, signed with the same
// shared secret.
const RECORDING_AUDIENCE = "voice-recording";

export function mintRecordingToken(recordingId, env = process.env) {
  return jwt.sign({ sub: String(recordingId) }, gatewaySecret(env), { audience: RECORDING_AUDIENCE, expiresIn: "2m" });
}

// True if `token` grants access to `recordingId`.
export function verifyRecordingToken(token, recordingId, env = process.env) {
  try {
    const claims = jwt.verify(String(token || ""), gatewaySecret(env), { audience: RECORDING_AUDIENCE });
    return claims.sub === String(recordingId);
  } catch {
    return false;
  }
}

// The gateway's HTTP(S) base, from its WebSocket URL:
// wss://voice.example.com/voice → https://voice.example.com
export function voiceGatewayHttpUrl(env = process.env) {
  const wsUrl = voiceGatewayUrl(env);
  if (!wsUrl) return "";
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

// Body for GET /api/token when the SIP provider is active.
export function sipTokenResponse(user, env = process.env) {
  const callerIds = String(env.SIP_CALLER_IDS || env.SIP_CALLER_ID || "")
    .split(",")
    .map((n) => n.replace(/[^\d+]/g, ""))
    .filter(Boolean);
  return {
    provider: "sip",
    gatewayUrl: voiceGatewayUrl(env),
    token: mintGatewayToken(user, env),
    callerIds,
  };
}

// ---------- WhatsApp service (server/whatsappGateway.js) ----------
// Runs next to the voice gateway on the same server, reached at
// <gateway origin>/whatsapp/* (Caddy routes that path to it). The CRM
// backend calls it with short-lived tokens signed with the same secret.
const WHATSAPP_AUDIENCE = "whatsapp";

export function whatsappGatewayUrl(env = process.env) {
  if (env.WHATSAPP_GATEWAY_URL) return env.WHATSAPP_GATEWAY_URL.replace(/\/+$/, "");
  if (env.VOICE_GATEWAY_URL) return voiceGatewayHttpUrl(env);
  if (env.VERCEL) return "";
  return `http://localhost:${env.WHATSAPP_GATEWAY_PORT || 3003}`;
}

export function mintWhatsAppToken(env = process.env) {
  return jwt.sign({}, gatewaySecret(env), { audience: WHATSAPP_AUDIENCE, expiresIn: "2m" });
}

export function verifyWhatsAppToken(token, env = process.env) {
  try {
    jwt.verify(String(token || ""), gatewaySecret(env), { audience: WHATSAPP_AUDIENCE });
    return true;
  } catch {
    return false;
  }
}

// Calls the WhatsApp service; resolves to its JSON, or throws with its
// error message (or a plain one if it can't be reached).
export async function callWhatsAppGateway(pathname, { method = "GET", body } = {}, env = process.env) {
  const base = whatsappGatewayUrl(env);
  if (!base) throw new Error("The WhatsApp service isn't set up (VOICE_GATEWAY_URL is missing).");
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${mintWhatsAppToken(env)}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Can't reach the WhatsApp service on the voice server — is it running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `The WhatsApp service returned ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}
