// Vercel serverless function — this is the URL to paste into the
// TwiML App's Voice webhook once deployed:
// https://<your-domain>/api/voice
import { buildVoiceTwiml } from "../server/twilioCore.js";

export default function handler(req, res) {
  const to = req.body?.To;
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(buildVoiceTwiml(to));
}
