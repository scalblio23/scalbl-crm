import { ensureSchema } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { handleGetGoogleCalendars, handlePatchGoogleCalendar } from "../server/bookingApi.js";

// GET /api/google-calendars — live-fetches the connected account's
// calendar list from Google and re-syncs the cached copy (preserving
// each calendar's included/excluded flag).
// PATCH /api/google-calendars — body { calendarId, included }: toggles
// whether one calendar feeds into availability (see the ask: choosing
// which calendars to pull availability from, and excluding the main one).
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method === "GET") {
      const { status, body } = await handleGetGoogleCalendars(user);
      return res.status(status).json(body);
    }
    if (req.method === "PATCH") {
      const { status, body } = await handlePatchGoogleCalendar(user, req.body || {});
      return res.status(status).json(body);
    }
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/google-calendars]", err);
    return res.status(500).json({ error: err.message || "Could not load calendars." });
  }
}
