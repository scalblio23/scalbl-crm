// Local dev calling backend for the Powerdialler (used with
// `npm run dev:all` + ngrok). The deployed site uses the equivalent
// functions in /api instead — see server/twilioCore.js for the
// shared Twilio logic both paths call into.
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { missingTwilioEnv, mintAccessToken, buildVoiceTwiml } from "./twilioCore.js";

dotenv.config();

const { PORT = 3001 } = process.env;

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  const missing = missingTwilioEnv();
  res.json({ ok: missing.length === 0, missing });
});

// Mints a short-lived Access Token so the browser can register as a
// Twilio Voice device (the same softphone model GoHighLevel uses),
// scoped to place outgoing calls through our TwiML App.
app.get("/api/token", (req, res) => {
  const missing = missingTwilioEnv();
  if (missing.length) {
    return res.status(500).json({
      error: `Twilio is not configured. Missing: ${missing.join(", ")}`,
    });
  }
  const identity = req.query.identity || "rep";
  res.json({ token: mintAccessToken(identity), identity });
});

// TwiML voice webhook. This is the URL you paste into the TwiML App's
// "Voice" config in the Twilio Console. Twilio hits this once the
// browser device places a call, and we tell it who to actually dial
// and what caller ID to show — mirroring GHL's "call bridges through
// our number" behaviour.
app.post("/api/voice", (req, res) => {
  res.type("text/xml").send(buildVoiceTwiml(req.body.To));
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
  const missing = missingTwilioEnv();
  console.log(`Twilio calling server listening on http://localhost:${PORT}`);
  if (missing.length) {
    console.warn(
      `⚠ Twilio env vars not set yet, calls will fail until you add them to .env: ${missing.join(", ")}`
    );
  }
});
