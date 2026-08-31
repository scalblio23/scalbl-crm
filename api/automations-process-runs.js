// GET /api/automations-process-runs — advances whatever automation
// runs are currently due (i.e. past a "wait" step's target time).
// Called on a schedule: Vercel Cron in production (see the `crons`
// entry in vercel.json) and a setInterval poller in server/index.js
// for local dev, which has no cron of its own.
//
// Public in the sense that it needs no CRM login — it's not a user
// action — but it's not meant to be reachable by just anyone either.
// Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when
// it invokes a configured Cron Job, if a CRON_SECRET env var is set on
// the project; checking for that here is what actually locks this
// down. Without CRON_SECRET set, this runs unauthenticated — fine for
// local dev, but set it in Vercel before relying on this in production.
import { ensureSchema, reapStuckAutomationRuns } from "../server/db.js";
import { processDueAutomationRuns } from "../server/automations.js";

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  try {
    await ensureSchema();
    // Runs before claiming new work so a run stuck from a previous,
    // now-fixed bug (or any future one) doesn't sit invisible forever —
    // see reapStuckAutomationRuns' own comment in server/db.js.
    await reapStuckAutomationRuns();
    const processed = await processDueAutomationRuns();
    return res.status(200).json({ processed });
  } catch (err) {
    console.error("[api/automations-process-runs]", err);
    return res.status(500).json({ error: err.message || "Failed to process automation runs" });
  }
}
