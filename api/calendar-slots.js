// GET /api/calendar-slots?slug=...&from=YYYY-MM-DD&to=YYYY-MM-DD —
// public, unauthenticated. Returns the actual bookable UTC slots for
// that range: availability rules minus Google freebusy (if connected)
// minus the calendar's own existing confirmed bookings.
import { ensureSchema, getCalendarBySlug, getConfirmedBookingsInRange } from "../server/db.js";
import { getValidAccessToken, getFreeBusy } from "../server/googleCalendar.js";
import { computeAvailableSlots } from "../server/calendarAvailability.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const { slug, from, to } = req.query || {};
    if (!slug || !from || !to) return res.status(400).json({ error: "Missing slug, from, or to" });

    const calendar = await getCalendarBySlug(slug, { includeSecrets: true });
    if (!calendar || !calendar.active) return res.status(404).json({ error: "Calendar not found" });

    const fromISO = `${from}T00:00:00.000Z`;
    const toISO = `${to}T23:59:59.999Z`;

    let googleBusy = [];
    if (calendar.googleConnected) {
      try {
        const accessToken = await getValidAccessToken(calendar);
        googleBusy = await getFreeBusy({ accessToken, timeMinISO: fromISO, timeMaxISO: toISO });
      } catch (err) {
        // Surface nothing extra to the visitor — an availability check
        // failing open (no Google busy applied) is safer for a booking
        // widget than failing the whole page over a token hiccup.
        console.error("[api/calendar-slots] freebusy lookup failed", err);
      }
    }
    const existingBookings = await getConfirmedBookingsInRange(calendar.id, fromISO, toISO);

    const slots = computeAvailableSlots({ calendar, fromDate: from, toDate: to, googleBusy, existingBookings });
    return res.status(200).json({ slots });
  } catch (err) {
    console.error("[api/calendar-slots]", err);
    return res.status(500).json({ error: err.message || "Could not load availability" });
  }
}
