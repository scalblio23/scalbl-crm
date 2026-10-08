// GET /api/calendar-bookings?calendarId=5 — bookings list for the CRM
// side of a calendar. DELETE ?id=12 cancels one (same effect a booker
// clicking their own cancel link has — see api/calendar-cancel.js).
// POST ?id=12&action=resync retries pushing a booking out to the
// calendar's connected Google/Outlook calendars after a failed sync.
// Full-access roles see every calendar's bookings; a client_team user
// only those on calendars assigned to them.
import {
  ensureSchema,
  getCalendarBookings,
  getCalendarBookingById,
  cancelCalendarBooking,
  getCalendarById,
} from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, canAccessCalendar } from "../server/auth.js";
import { pushBookingToCalendars, removeBookingFromCalendars } from "../server/calendarSync.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      const calendarId = req.query.calendarId;
      if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
      const calendar = await getCalendarById(calendarId);
      if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });
      return res.status(200).json(await getCalendarBookings(calendarId));
    }

    if (req.method === "DELETE" || req.method === "POST") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const booking = await getCalendarBookingById(id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      const calendar = await getCalendarById(booking.calendarId, { includeSecrets: true });
      if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Booking not found" });

      if (req.method === "POST") {
        if (req.query.action !== "resync") return res.status(400).json({ error: "Unknown action" });
        if (booking.status !== "confirmed") return res.status(409).json({ error: "This booking was cancelled." });
        if (!calendar.googleConnected && !calendar.outlookConnected) {
          return res.status(409).json({ error: "Connect Google or Outlook on this calendar first." });
        }
        const result = await pushBookingToCalendars(calendar, booking);
        return res.status(result.ok ? 200 : 502).json(result.ok ? booking : { error: result.errors.join(" · "), booking });
      }

      // Don't block cancelling the booking in our own system over a
      // Google/Outlook hiccup — the CRM's record is authoritative.
      await removeBookingFromCalendars(calendar, booking, "[api/calendar-bookings]");
      const cancelled = await cancelCalendarBooking(id);
      return res.status(200).json(cancelled);
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/calendar-bookings]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
