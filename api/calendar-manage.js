// POST /api/calendar-manage — public, unauthenticated; the patient's
// manage page (/book/<slug>#manage=<token>, see src/BookingWidget.jsx)
// for calendars with the patient confirmation workflow switched on
// (server/patientReminders.js). Body: { token, action, ... }.
//   action "view"       → the appointment, no contact details
//   action "confirm"    → mark attendance confirmed (same as replying Y)
//   action "cancel"     → cancel it (stops reminders, sends rebook link)
//   action "reschedule" → { startUTC, endUTC, timezone } move it
//   action "ics"        → the calendar invite, for "Add to calendar"
// The token is the booking's own cancel token — it only ever reaches
// that one booking, and is checked server-side on every call. It is
// taken from the body, never the URL, so it stays out of access logs.
import { ensureSchema } from "../server/db.js";
import {
  workflowFor,
  getBookingByToken,
  publicBookingView,
  confirmWorkflowAttendance,
  cancelWorkflowBooking,
  rescheduleWorkflowBooking,
  bookingIcs,
  BookingError,
} from "../server/patientReminders.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    await ensureSchema();
    const { token, action } = req.body || {};
    const found = await getBookingByToken(token);
    if (!found || !workflowFor(found.calendar)) return res.status(404).json({ error: "Booking not found" });
    const { booking, calendar } = found;

    if (action === "view") return res.status(200).json(publicBookingView(booking, calendar));

    if (action === "ics") {
      if (booking.status !== "confirmed") return res.status(409).json({ error: "This appointment is cancelled." });
      return res.status(200).json({ ics: bookingIcs(booking, calendar, workflowFor(calendar)) });
    }

    if (action === "confirm") {
      const result = await confirmWorkflowAttendance(booking.id, { source: "manage_link" });
      if (result === "not_active") return res.status(409).json({ error: "This appointment can no longer be confirmed." });
      const fresh = await getBookingByToken(token);
      return res.status(200).json(publicBookingView(fresh.booking, fresh.calendar));
    }

    if (action === "cancel") {
      if (new Date(booking.startTime) <= new Date() && booking.status === "confirmed") {
        return res.status(409).json({ error: "This appointment has already started." });
      }
      await cancelWorkflowBooking(booking.id, { reason: "cancelled_by_patient", source: "manage_link" });
      const fresh = await getBookingByToken(token);
      return res.status(200).json(publicBookingView(fresh.booking, fresh.calendar));
    }

    if (action === "reschedule") {
      const { startUTC, endUTC, timezone } = req.body || {};
      return res.status(200).json(await rescheduleWorkflowBooking({ token, startUTC, endUTC, timezone }));
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
    console.error("[api/calendar-manage]", err?.message || err);
    return res.status(500).json({ error: "Something went wrong — please try again." });
  }
}
