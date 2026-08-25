// Minimal calling backend for the Powerdialler, built the same way
// GoHighLevel's own dialler is: a browser-based Twilio "softphone"
// (Voice SDK) backed by a server that (1) mints short-lived Access
// Tokens so the browser can register as a calling device, and (2)
// answers Twilio's TwiML webhook to say who the device should be
// connected to. Twilio credentials never touch the frontend.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
  TWILIO_TWIML_APP_SID,
  TWILIO_CALLER_ID,
  PORT = 3001,
} = process.env;

const REQUIRED_ENV = {
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
  TWILIO_TWIML_APP_SID,
  TWILIO_CALLER_ID,
};

function missingEnvVars() {
  return Object.entries(REQUIRED_ENV)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  const missing = missingEnvVars();
  res.json({ ok: missing.length === 0, missing });
});

// Mints a short-lived Access Token so the browser can register as a
// Twilio Voice device (the same softphone model GoHighLevel uses),
// scoped to place outgoing calls through our TwiML App.
app.get("/api/token", (req, res) => {
  const missing = missingEnvVars();
  if (missing.length) {
    return res.status(500).json({
      error: `Twilio is not configured. Missing: ${missing.join(", ")}`,
    });
  }

  const identity = req.query.identity || "rep";
  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });

  const token = new AccessToken(
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
    { identity, ttl: 3600 }
  );
  token.addGrant(voiceGrant);

  res.json({ token: token.toJwt(), identity });
});

// TwiML voice webhook. This is the URL you paste into the TwiML App's
// "Voice" config in the Twilio Console. Twilio hits this once the
// browser device places a call, and we tell it who to actually dial
// and what caller ID to show — mirroring GHL's "call bridges through
// our number" behaviour.
app.post("/api/voice", (req, res) => {
  const to = req.body.To;
  const twiml = new twilio.twiml.VoiceResponse();

  if (to) {
    const dial = twiml.dial({ callerId: TWILIO_CALLER_ID });
    if (/^client:/.test(to)) {
      dial.client(to.replace(/^client:/, ""));
    } else {
      dial.number(to);
    }
  } else {
    twiml.say("Thanks for calling. No destination number was provided.");
  }

  res.type("text/xml").send(twiml.toString());
});

// Call status callback — set this as the TwiML App / <Dial> status
// callback URL to log ringing/in-progress/completed events against a
// lead's activity history.
app.post("/api/status", (req, res) => {
  console.log(
    "[twilio status]",
    req.body.CallStatus,
    "to:",
    req.body.To,
    "sid:",
    req.body.CallSid
  );
  res.sendStatus(204);
});

app.listen(PORT, () => {
  const missing = missingEnvVars();
  console.log(`Twilio calling server listening on http://localhost:${PORT}`);
  if (missing.length) {
    console.warn(
      `⚠ Twilio env vars not set yet, calls will fail until you add them to .env: ${missing.join(", ")}`
    );
  }
});
