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
  "TWILIO_CALLER_ID",
];

export function missingTwilioEnv(env = process.env) {
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]);
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
// what caller ID to show.
export function buildVoiceTwiml(to, env = process.env) {
  const twiml = new twilio.twiml.VoiceResponse();

  if (to) {
    const dial = twiml.dial({ callerId: env.TWILIO_CALLER_ID });
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
// from TWILIO_CALLER_ID.
export async function sendSms({ to, body }, env = process.env) {
  const client = restClient(env);
  const params = { to, body };
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    params.from = env.TWILIO_CALLER_ID;
  }
  const message = await client.messages.create(params);
  return { sid: message.sid, status: message.status };
}
