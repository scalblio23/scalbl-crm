import { ensureSchema } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { handleGetBookingSettings, handlePatchBookingSettings } from "../server/bookingApi.js";

// GET /api/booking-settings — the logged-in user's booking page config
// (creating a default one with a fresh slug on first call), connection
// status, and cached calendar list.
// PATCH /api/booking-settings — partial update: title, description,
// location, slotMinutes, minNoticeHours, daysAhead, timezone,
// destinationCalendarId, workingHours.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method === "GET") {
      const { status, body } = await handleGetBookingSettings(user);
      return res.status(status).json(body);
    }
    if (req.method === "PATCH") {
      const { status, body } = await handlePatchBookingSettings(user, req.body || {});
      return res.status(status).json(body);
    }
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/booking-settings]", err);
    return res.status(500).json({ error: err.message || "Could not load booking settings." });
  }
}
