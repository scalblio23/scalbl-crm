// The one calling API the app uses. Calls go over the SIP voice gateway
// (server/voiceGateway.js, on the DigitalOcean droplet) via sipDevice.js;
// /api/token hands the browser the gateway's URL and a signed token.
import * as sip from "./sipDevice";
import { getSoundboardProcessor } from "./soundboardProcessor";

// Same base-URL convention as api.js.
const CALL_SERVER_URL = import.meta.env.VITE_CALL_SERVER_URL || "";

let providerPromise = null;
let provider = null; // "sip" once the gateway config has been fetched

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
        sip.configureSip(cfg, fetchVoiceConfig);
        provider = "sip";
        return provider;
      })
      .catch((err) => {
        providerPromise = null; // retry on the next attempt
        throw err;
      });
  }
  return providerPromise;
}

// Called once after login so the browser registers with the gateway
// straight away and can ring for inbound calls.
export function initVoice() {
  return resolveProvider().catch(() => null);
}

export function getVoiceProvider() {
  return provider;
}

// `opts.leadId` labels the call's recording with its contact.
export async function placeCall(phoneNumber, identity = "rep", opts = {}) {
  await resolveProvider();
  return sip.placeCall(phoneNumber, opts);
}

// Multi Line: the gateway rings every leg itself.
export async function placeMultilineCall(legs, opts) {
  await resolveProvider();
  return sip.placeMultilineCall(legs, opts);
}

export function hangUp() {
  sip.hangUp();
}

export function sendDigits(digits) {
  sip.sendDigits(digits);
}

// Plays a clip into the outgoing call audio (see soundboardProcessor.js).
export function playSoundboardClip(audioUrl) {
  return getSoundboardProcessor().playClip(audioUrl);
}

// Inbound calls. listener(call) — call.from, call.name,
// call.accept(), call.reject(), and "cancel" if it stops ringing.
export function onIncomingCall(listener) {
  return sip.onIncomingCall(listener);
}

// Trunk status for the UI: { connected, registration: { state, error }, callerId }.
export function onVoiceStatus(listener) {
  return sip.onStatus(listener);
}

// Live transfer — the gateway rings the third party and does the bridging.
export function startSipTransfer(to) {
  sip.startTransfer(to);
}

export function cancelSipTransfer() {
  sip.cancelTransfer();
}

export function completeSipTransfer() {
  sip.completeTransfer();
}

export function onSipTransferState(listener) {
  return sip.onTransferState(listener);
}
