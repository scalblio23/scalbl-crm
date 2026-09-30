// The one calling API the app uses — picks the voice transport the
// backend is configured for (VOICE_PROVIDER, see server/voiceConfig.js)
// and forwards to it:
//   - "sip":    VoIPcloud/VoIPline SIP trunk via the voice gateway (sipDevice.js)
//   - "twilio": Twilio Voice SDK (twilioDevice.js)
// Both hand back call objects with the same events, so the
// Powerdialler's call handling is identical either way.
import * as twilio from "./twilioDevice";
import * as sip from "./sipDevice";
import { getSoundboardProcessor } from "./soundboardProcessor";

// Same base-URL convention as api.js / twilioDevice.js.
const CALL_SERVER_URL = import.meta.env.VITE_CALL_SERVER_URL || "";

let providerPromise = null;
let provider = null; // resolved "sip" | "twilio", once known

async function fetchVoiceConfig() {
  let res;
  try {
    res = await fetch(`${CALL_SERVER_URL}/api/token?identity=rep`, { credentials: "include" });
  } catch {
    throw new Error(
      CALL_SERVER_URL
        ? `Can't reach the calling server at ${CALL_SERVER_URL}. Is \`npm run server\` running?`
        : "Can't reach /api/token on this deployment. Check the Vercel Functions logs."
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Token request failed (${res.status})`);
  return body;
}

function resolveProvider() {
  if (!providerPromise) {
    providerPromise = fetchVoiceConfig()
      .then((cfg) => {
        if (cfg.provider === "sip") {
          sip.configureSip(cfg, fetchVoiceConfig);
          provider = "sip";
        } else {
          // twilioDevice fetches its own (short-lived) token when it
          // first places a call, same as before.
          provider = "twilio";
        }
        return provider;
      })
      .catch((err) => {
        providerPromise = null; // retry on the next attempt
        throw err;
      });
  }
  return providerPromise;
}

// Called once after login so a SIP browser registers with the gateway
// straight away and can ring for inbound calls. Harmless for Twilio.
export function initVoice() {
  return resolveProvider().catch(() => null);
}

export function getVoiceProvider() {
  return provider;
}

// `opts.leadId` labels the call's recording with its contact (Twilio
// and the SIP gateway both record).
export async function placeCall(phoneNumber, identity = "rep", opts = {}) {
  return (await resolveProvider()) === "sip"
    ? sip.placeCall(phoneNumber, opts)
    : twilio.placeCall(phoneNumber, identity, opts);
}

// Twilio multi-line: the rep's leg joins a Twilio Conference.
// Also how a live transfer rejoins the rep (Twilio only).
export async function joinConference(conferenceName, identity = "rep", opts = {}) {
  return twilio.joinConference(conferenceName, identity, opts);
}

// SIP multi-line: the gateway rings every leg itself.
export async function placeMultilineCall(legs, opts) {
  return sip.placeMultilineCall(legs, opts);
}

export function hangUp() {
  if (provider === "sip") sip.hangUp();
  else twilio.hangUp();
}

export function sendDigits(digits) {
  if (provider === "sip") sip.sendDigits(digits);
  else twilio.sendDigits(digits);
}

// Both transports feed the mic through the same soundboard mixer.
export function playSoundboardClip(audioUrl) {
  return getSoundboardProcessor().playClip(audioUrl);
}

// Inbound calls (SIP only). listener(call) — call.from, call.name,
// call.accept(), call.reject(), and "cancel" if it stops ringing.
export function onIncomingCall(listener) {
  return sip.onIncomingCall(listener);
}

// SIP trunk status for the UI: { connected, registration: { state, error }, callerId }.
export function onVoiceStatus(listener) {
  return sip.onStatus(listener);
}
