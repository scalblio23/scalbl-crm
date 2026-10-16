// GET or POST /api/calendar-cancel?token=... — public, unauthenticated.
// The cancel link in older booking confirmation emails (new emails link
// straight to the manage page instead, see api/calendar-book.js).
//
// A GET never cancels anything: email security scanners (Safe Links,
// Mimecast, Gmail) and chat link previews fetch URLs without a person
// clicking them, and would silently cancel real appointments. A GET
// redirects to the manage page (/book/<slug>#manage=<token>&action=cancel,
// src/BookingWidget.jsx), where cancelling is an explicit button that
// POSTs to api/calendar-manage.js. The token moves into the URL
// fragment there, which browsers never send to the server.
//
// A POST still cancels: through the workflow for calendars with the
// patient confirmation workflow (server/patientReminders.js), so its
// reminders stop and the patient is told; otherwise the Google event is
// deleted and the booking marked cancelled, as before.
import { ensureSchema, getCalendarBookingByCancelToken, getCalendarById } from "../server/db.js";
import { cancelWorkflowBooking } from "../server/patientReminders.js";
import { publicBaseUrl } from "../server/twilioCore.js";

function notFound(req, res) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    return res.status(404).send("<p>We couldn't find this booking. The link may be incomplete.</p>");
  }
  return res.status(404).json({ error: "Booking not found" });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    res.setHeader("Allow", "GET, HEAD, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    await ensureSchema();
    const isPost = req.method === "POST";
    const token = isPost ? req.body?.token || req.query?.token : req.query?.token;
    if (!token) return res.status(400).json({ error: "Missing token" });

    const booking = await getCalendarBookingByCancelToken(String(token));
    if (!booking) return notFound(req, res);
    const calendar = await getCalendarById(booking.calendarId);
    if (!calendar) return notFound(req, res);

    if (!isPost) {
      // Already-cancelled bookings land on the same page, which says so.
      res.setHeader("Location", `${publicBaseUrl() || ""}/book/${calendar.slug}#manage=${booking.cancelToken}&action=cancel`);
      return res.status(302).end();
    }

    if (booking.status === "cancelled") return res.status(200).json({ ok: true, alreadyCancelled: true });
    await cancelWorkflowBooking(booking.id, { reason: "cancelled_by_patient", source: "cancel_link" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[api/calendar-cancel]", err);
    return res.status(500).json({ error: "Could not cancel the booking" });
  }
}
