// Wraps the Twilio Voice SDK so the app can place real calls the same
// way GoHighLevel's power dialler does: the browser registers itself
// as a Twilio "device" (a softphone), and calls ring through the
// rep's mic/speakers instead of their actual phone. All it needs from
// the backend is a short-lived Access Token — no Twilio secrets ever
// reach the browser.
import { Device } from "@twilio/voice-sdk";

const CALL_SERVER_URL = import.meta.env.VITE_CALL_SERVER_URL || "http://localhost:3001";

let device = null;
let deviceReady = null;

async function fetchToken(identity) {
  let res;
  try {
    res = await fetch(`${CALL_SERVER_URL}/api/token?identity=${encodeURIComponent(identity)}`);
  } catch {
    throw new Error(
      `Can't reach the calling server at ${CALL_SERVER_URL}. Is \`npm run server\` running?`
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

// Places an outbound call to `phoneNumber` and returns the live Call
// object — attach 'accept' / 'disconnect' / 'cancel' / 'error'
// listeners to it to drive UI state.
export async function placeCall(phoneNumber, identity = "rep") {
  const dev = await getDevice(identity);
  return dev.connect({ params: { To: phoneNumber } });
}

// Ends whatever call is currently in progress on this device, if any.
export function hangUp() {
  device?.disconnectAll();
}
