// GET /api/calendar-bookings?calendarId=5 — bookings list for the CRM
// side of a calendar. DELETE ?id=12 cancels one (same effect a booker
// clicking their own cancel link has — see api/calendar-cancel.js).
import {
  ensureSchema,
  getCalendarBookings,
  getCalendarBookingById,
  cancelCalendarBooking,
  getCalendarById,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { getValidAccessToken, deleteGoogleEvent } from "../server/googleCalendar.js";
import { workflowFor, cancelWorkflowBooking, getBookingTimeline } from "../server/patientReminders.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    // Reminder/reply audit trail for one booking (the booking list's
    // "History" view). Same full-access roles as the list itself.
    if (req.method === "GET" && req.query.timelineFor) {
      return res.status(200).json(await getBookingTimeline(req.query.timelineFor));
    }

    if (req.method === "GET") {
      const calendarId = req.query.calendarId;
      if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
      return res.status(200).json(await getCalendarBookings(calendarId));
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const booking = await getCalendarBookingById(id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });

      // On a patient-confirmation-workflow calendar, a setter's cancel
      // also stops every pending reminder (otherwise the patient would
      // still get "join now" texts). The patient isn't messaged — same
      // as a staff cancel has always been.
      const bookingCalendar = await getCalendarById(booking.calendarId);
      if (workflowFor(bookingCalendar)) {
        const result = await cancelWorkflowBooking(booking.id, {
          reason: "cancelled_by_staff",
          source: `crm_user_${user.id ?? "api"}`,
          notifyPatient: false,
        });
        return res.status(200).json(result.booking);
      }

      if (booking.googleEventId) {
        const calendar = await getCalendarById(booking.calendarId, { includeSecrets: true });
        if (calendar?.googleConnected) {
          try {
            const accessToken = await getValidAccessToken(calendar);
            await deleteGoogleEvent({ accessToken, calendarId: calendar.googleCalendarId, eventId: booking.googleEventId });
          } catch (err) {
            // Don't block cancelling the booking in our own system over
            // a Google-side hiccup — the CRM's record is authoritative.
            console.error("[api/calendar-bookings] failed to delete Google event", err);
          }
        }
      }
      const cancelled = await cancelCalendarBooking(id);
      return res.status(200).json(cancelled);
    }

    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/calendar-bookings]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
