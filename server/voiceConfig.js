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
