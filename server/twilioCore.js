// Shared Twilio logic used by both the local Express server
// (server/index.js, for `npm run dev:all` + ngrok) and the Vercel
// serverless functions (/api/*.js, used on the deployed site). Keeping
// this in one place means the local and production calling paths can
// never drift apart.
import twilio from "twilio";

const REQUIRED_ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
];

export function missingTwilioEnv(env = process.env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (getCallerIdPool(env).length === 0) missing.push("TWILIO_CALLER_ID (or TWILIO_CALLER_IDS)");
  return missing;
}

// The pool of numbers outbound calls rotate through as their caller
// ID. Comma-separate several ("+618700001,+618700002,+618700003,
// +618700004") to rotate across them, spreading call volume so no
// single number gets flagged by carriers — or leave just one for a
// single-number setup. Reads TWILIO_CALLER_IDS (plural) if set,
// otherwise TWILIO_CALLER_ID (singular) — but either name is split
// the same way, since "the list ended up on the singularly-named var"
// is an easy mistake (that's exactly what happened once already) and
// there's no reason the app should break over which name it's under.
//
// Twilio also requires E.164 ("+61...") for a caller ID — missing the
// "+" makes the gateway reject the call outright, every single call,
// not intermittently (the Twilio Console's own phone number list
// shows each number twice, once with the "+" and once without, right
// underneath — an easy copy-paste trap). Normalized defensively
// rather than trusting the env var is exactly right.
function normalizeCallerId(raw) {
  const s = String(raw).trim();
  return s && !s.startsWith("+") ? `+${s}` : s;
}

export function getCallerIdPool(env = process.env) {
  const raw = env.TWILIO_CALLER_IDS || env.TWILIO_CALLER_ID || "";
  return raw
    .split(",")
    .map((s) => normalizeCallerId(s))
    .filter(Boolean);
}

// Mints a short-lived Access Token so the browser can register as a
// Twilio Voice device (the same softphone model GoHighLevel uses).
export function mintAccessToken(identity, env = process.env) {
  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: env.TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });

  const token = new AccessToken(
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_API_KEY_SID,
    env.TWILIO_API_KEY_SECRET,
    { identity, ttl: 3600 }
  );
  token.addGrant(voiceGrant);
  return token.toJwt();
}

// Builds the TwiML response for the voice webhook: who to dial and
// what caller ID to show. callerId is resolved by the caller (see
// api/voice.js) — usually the next number in TWILIO_CALLER_IDS'
// rotation — rather than read from env here, since picking it may
// require a database round-trip this function shouldn't need to know
// about.
export function buildVoiceTwiml(to, callerId) {
  const twiml = new twilio.twiml.VoiceResponse();

  if (to) {
    const dial = twiml.dial({ callerId });
    if (/^client:/.test(to)) {
      dial.client(to.replace(/^client:/, ""));
    } else {
      dial.number(to);
    }
  } else {
    twiml.say("Thanks for calling. No destination number was provided.");
  }

  return twiml.toString();
}

// Same API Key credentials used to mint Voice tokens also work as a
// REST client for sending SMS — no separate Twilio setup needed.
function restClient(env = process.env) {
  return twilio(env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, { accountSid: env.TWILIO_ACCOUNT_SID });
}

// Sends an outbound SMS. Uses TWILIO_MESSAGING_SERVICE_SID if set
// (recommended by Twilio — better deliverability, required for some
// inbound routing setups); otherwise falls back to sending straight
// from the first number in the caller ID pool. SMS doesn't rotate —
// only outbound calls do, per the caller-ID-flagging concern that
// rotation exists for.
export async function sendSms({ to, body }, env = process.env) {
  const client = restClient(env);
  const params = { to, body };
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    params.from = getCallerIdPool(env)[0];
  }
  const message = await client.messages.create(params);
  return { sid: message.sid, status: message.status };
}
