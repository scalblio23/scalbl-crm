// GET /api/calendar-google-calendars?calendarId=5 — authenticated.
// Lists every calendar the connected Google account can see, for the
// "Which calendar?" picker in Calendar settings' Integrate section.
// Requires that calendarId's Google connection to already be live —
// there's nothing to list before "Connect with Google" has run.
import { ensureSchema, getCalendarById } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { getValidAccessToken, listGoogleCalendars } from "../server/googleCalendar.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    const calendarId = req.query.calendarId;
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId, { includeSecrets: true });
    if (!calendar) return res.status(404).json({ error: "Calendar not found" });
    if (!calendar.googleConnected) return res.status(409).json({ error: "Connect Google first" });

    const accessToken = await getValidAccessToken(calendar);
    const googleCalendars = await listGoogleCalendars({ accessToken });
    return res.status(200).json(googleCalendars);
  } catch (err) {
    console.error("[api/calendar-google-calendars]", err);
    return res.status(500).json({ error: err.message || "Could not load Google calendars" });
  }
}
