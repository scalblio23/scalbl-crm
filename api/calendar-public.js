// GET /api/calendar-public?slug=sales-call-a1b2c3 — public, unauthenticated.
// The booking widget's first call: just enough info to render the
// page shell before it asks for available slots.
import { ensureSchema, getCalendarBySlug } from "../server/db.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: "Missing slug" });
    const calendar = await getCalendarBySlug(slug);
    if (!calendar || !calendar.active) return res.status(404).json({ error: "Calendar not found" });
    return res.status(200).json({
      name: calendar.name,
      description: calendar.description,
      timezone: calendar.timezone,
      eventLengthMinutes: calendar.eventLengthMinutes,
      bookingWindowDays: calendar.bookingWindowDays,
    });
  } catch (err) {
    console.error("[api/calendar-public]", err);
    return res.status(500).json({ error: err.message || "Could not load this calendar" });
  }
}
