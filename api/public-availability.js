import { ensureSchema } from "../server/db.js";
import { handlePublicAvailability } from "../server/bookingApi.js";

// GET /api/public-availability?slug=... — public. Live free/busy pull
// from Google Calendar across the host's included calendars, turned
// into a flat list of offerable {start,end} slots (UTC ISO) — see
// server/bookingSlots.js. Computed fresh on every call, so it always
// reflects the calendar's current state.
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { status, body } = await handlePublicAvailability(String(req.query.slug || ""));
    return res.status(status).json(body);
  } catch (err) {
    console.error("[api/public-availability]", err);
    return res.status(500).json({ error: "Could not load availability." });
  }
}
