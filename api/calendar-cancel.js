// GET or POST /api/calendar-cancel?token=... — public, unauthenticated.
// The link in a booking confirmation email. GET renders a plain
// confirmation-of-cancellation response (so clicking the email link
// alone is enough — no separate "are you sure" page/form needed for
// v1); returns the same result either way.
import { ensureSchema, getCalendarBookingByCancelToken, cancelCalendarBooking, getCalendarById } from "../server/db.js";
import { removeBookingFromCalendars } from "../server/calendarSync.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const token = req.method === "GET" ? req.query?.token : req.body?.token || req.query?.token;
    if (!token) return res.status(400).json({ error: "Missing token" });

    const booking = await getCalendarBookingByCancelToken(String(token));
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status === "cancelled") {
      return res.status(200).send("<p>This booking is already cancelled.</p>");
    }

    if (booking.googleEventId || booking.outlookEventId) {
      const calendar = await getCalendarById(booking.calendarId, { includeSecrets: true });
      await removeBookingFromCalendars(calendar, booking, "[api/calendar-cancel]");
    }
    await cancelCalendarBooking(booking.id);

    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send("<p>Your booking has been cancelled.</p>");
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[api/calendar-cancel]", err);
    return res.status(500).json({ error: err.message || "Could not cancel the booking" });
  }
}
