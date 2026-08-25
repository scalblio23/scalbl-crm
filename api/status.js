// Vercel serverless function — call status callback. Logs
// ringing/in-progress/completed events (visible in the Vercel
// Functions logs) so they can later be attached to a lead's activity
// history.
export default function handler(req, res) {
  console.log(
    "[twilio status]",
    req.body?.CallStatus,
    "to:",
    req.body?.To,
    "sid:",
    req.body?.CallSid
  );
  res.status(204).end();
}
