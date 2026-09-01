import { ensureSchema } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { handleGetBookings, handleCancelBooking } from "../server/bookingApi.js";

// GET /api/bookings — the logged-in user's bookings (most recent first).
// PATCH /api/bookings — body { id, status: "cancelled" }: cancels a
// booking and its Google Calendar event.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method === "GET") {
      const { status, body } = await handleGetBookings(user);
      return res.status(status).json(body);
    }
    if (req.method === "PATCH") {
      const { id, status: newStatus } = req.body || {};
      if (!id || newStatus !== "cancelled") {
        return res.status(400).json({ error: "Missing id, or unsupported status." });
      }
      const { status, body } = await handleCancelBooking(user, id);
      return res.status(status).json(body);
    }
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/bookings]", err);
    return res.status(500).json({ error: err.message || "Could not load bookings." });
  }
}
