// GET /api/calendar-google-calendars?calendarId=5&connectionId=9 —
// authenticated. Lists every calendar one signed-in Google account can
// see, for Calendar settings' Integrate section (the "Add calls to
// calendar" picker and that account's clash checklist). connectionId
// defaults to the account bookings go to.
import { ensureSchema, getCalendarById, getCalendarConnection } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, canAccessCalendar } from "../server/auth.js";
import { getValidConnectionAccessToken, listGoogleCalendars } from "../server/googleCalendar.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  try {
    await ensureSchema();
    const calendarId = req.query.calendarId;
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId);
    if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });
    const connection = await getCalendarConnection(calendar.id, req.query.connectionId || calendar.googleConnectionId, {
      includeSecrets: true,
    });
    if (!connection || connection.provider !== "google") return res.status(409).json({ error: "Connect Google first" });

    const accessToken = await getValidConnectionAccessToken(connection);
    const googleCalendars = await listGoogleCalendars({ accessToken, includeReadOnly: req.query.all === "1" });
    return res.status(200).json(googleCalendars);
  } catch (err) {
    console.error("[api/calendar-google-calendars]", err);
    return res.status(500).json({ error: err.message || "Could not load Google calendars" });
  }
}
