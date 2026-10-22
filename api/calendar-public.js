// GET /api/calendar-public?slug=sales-call-a1b2c3 — public, unauthenticated.
// The booking widget's first call: just enough info to render the
// page shell before it asks for available slots.
//
// Speed matters here (it's what a lead waits on): no ensureSchema on the
// hot path (see withSchemaRetry), and the answer is cached at Vercel's
// edge for a minute — a calendar's name/description rarely change.
import { withSchemaRetry, getCalendarBySlug } from "../server/db.js";

export default async function handler(req, res) {
  try {
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: "Missing slug" });
    const calendar = await withSchemaRetry(() => getCalendarBySlug(slug));
    if (!calendar || !calendar.active) return res.status(404).json({ error: "Calendar not found" });
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=3600");
    return res.status(200).json({
      name: calendar.name,
      description: calendar.description,
      timezone: calendar.timezone,
      eventLengthMinutes: calendar.eventLengthMinutes,
      bookingWindowDays: calendar.bookingWindowDays,
      metaPixelId: calendar.metaPixelId || null,
    });
  } catch (err) {
    console.error("[api/calendar-public]", err);
    return res.status(500).json({ error: err.message || "Could not load this calendar" });
  }
}
