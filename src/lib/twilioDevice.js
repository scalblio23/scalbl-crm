// Wraps the Twilio Voice SDK so the app can place real calls the same
// way GoHighLevel's power dialler does: the browser registers itself
// as a Twilio "device" (a softphone), and calls ring through the
// rep's mic/speakers instead of their actual phone. All it needs from
// the backend is a short-lived Access Token — no Twilio secrets ever
// reach the browser.
import { Device } from "@twilio/voice-sdk";

// Empty string = same-origin, i.e. /api/token — correct for the
// deployed site, where the /api functions live alongside the
// frontend. Local dev overrides this via VITE_CALL_SERVER_URL in
// .env to point at the separate Express server on :3001 instead.
const CALL_SERVER_URL = import.meta.env.VITE_CALL_SERVER_URL || "";

let device = null;
let deviceReady = null;

async function fetchToken(identity) {
  let res;
  try {
    res = await fetch(`${CALL_SERVER_URL}/api/token?identity=${encodeURIComponent(identity)}`);
  } catch {
    throw new Error(
      CALL_SERVER_URL
        ? `Can't reach the calling server at ${CALL_SERVER_URL}. Is \`npm run server\` running?`
        : "Can't reach /api/token on this deployment. Check the Vercel Functions logs."
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Token request failed (${res.status})`);
  }
  return body;
}

// Lazily creates and registers the Twilio Voice Device. Safe to call
// repeatedly — the same device is reused for every call.
async function getDevice(identity) {
  if (device) return device;
  if (!deviceReady) {
    deviceReady = fetchToken(identity)
      .then(({ token }) => {
        device = new Device(token, { logLevel: "warn" });
        return device.register().then(() => device);
      })
      .catch((err) => {
        deviceReady = null; // allow retrying on the next call attempt
        throw err;
      });
  }
  return deviceReady;
}

// Twilio requires E.164 (e.g. +61412334556) to actually route a call —
// a locally-formatted number like "0412 334 556" gets rejected almost
// instantly (the dial-on/dial-off sound with no ringing). Our sample
// data uses Australian local format, so normalize 0-prefixed numbers
// to +61 here rather than trusting every caller to pass E.164.
function toE164(rawPhone) {
  const cleaned = rawPhone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("0")) return `+61${cleaned.slice(1)}`;
  if (cleaned.startsWith("61")) return `+${cleaned}`;
  return cleaned;
}

// Places an outbound call to `phoneNumber` and returns the live Call
// object — attach 'accept' / 'disconnect' / 'cancel' / 'error'
// listeners to it to drive UI state.
export async function placeCall(phoneNumber, identity = "rep") {
  const dev = await getDevice(identity);
  return dev.connect({ params: { To: toE164(phoneNumber) } });
}

// Ends whatever call is currently in progress on this device, if any.
export function hangUp() {
  device?.disconnectAll();
}
