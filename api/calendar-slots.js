// GET /api/calendar-slots?slug=...&from=YYYY-MM-DD&to=YYYY-MM-DD —
// public, unauthenticated. Returns the actual bookable UTC slots for
// that range: availability rules minus Google/Outlook busy time (if connected)
// minus the calendar's own existing confirmed bookings.
//
// Speed: no ensureSchema on the hot path (see withSchemaRetry), the
// Google/Outlook/CRM lookups run at the same time, and the result is
// cached at Vercel's edge for 15s (served while refreshing for up to a
// minute after). That can't double-book anyone: api/calendar-book.js
// re-checks the slot live before saving, and says "just booked" if it's
// gone.
import { withSchemaRetry, getCalendarBySlug, getConfirmedBookingsInRange } from "../server/db.js";
import { getCrmClashBusy, getExternalBusy } from "../server/calendarSync.js";
import { computeAvailableSlots } from "../server/calendarAvailability.js";

export default async function handler(req, res) {
  try {
    const { slug, from, to } = req.query || {};
    if (!slug || !from || !to) return res.status(400).json({ error: "Missing slug, from, or to" });

    const calendar = await withSchemaRetry(() => getCalendarBySlug(slug, { includeSecrets: true }));
    if (!calendar || !calendar.active) return res.status(404).json({ error: "Calendar not found" });

    const fromISO = `${from}T00:00:00.000Z`;
    const toISO = `${to}T23:59:59.999Z`;

    // Fails open per provider (no busy time applied) — safer for a
    // booking widget than failing the whole page over a token hiccup.
    const [providerBusy, crmBusy, existingBookings] = await Promise.all([
      getExternalBusy(calendar, fromISO, toISO, "[api/calendar-slots]"),
      withSchemaRetry(() => getCrmClashBusy(calendar, fromISO, toISO)),
      withSchemaRetry(() => getConfirmedBookingsInRange(calendar.id, fromISO, toISO)),
    ]);
    const externalBusy = [...providerBusy, ...crmBusy];

    const slots = computeAvailableSlots({ calendar, fromDate: from, toDate: to, googleBusy: externalBusy, existingBookings });
    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=45");
    return res.status(200).json({ slots });
  } catch (err) {
    console.error("[api/calendar-slots]", err);
    return res.status(500).json({ error: err.message || "Could not load availability" });
  }
}
