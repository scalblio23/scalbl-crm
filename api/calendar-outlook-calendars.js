// GET /api/calendar-outlook-calendars?calendarId=5&connectionId=9 — the
// calendars on one signed-in Outlook account, for the same pickers as
// api/calendar-google-calendars.js. connectionId defaults to the
// account bookings go to.
import { ensureSchema, getCalendarById, getCalendarConnection } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, canAccessCalendar } from "../server/auth.js";
import { getValidOutlookConnectionAccessToken, listOutlookCalendars } from "../server/outlookCalendar.js";

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
    const connection = await getCalendarConnection(calendar.id, req.query.connectionId || calendar.outlookConnectionId, {
      includeSecrets: true,
    });
    if (!connection || connection.provider !== "outlook") return res.status(409).json({ error: "Connect Outlook first" });

    const accessToken = await getValidOutlookConnectionAccessToken(connection);
    return res.status(200).json(await listOutlookCalendars({ accessToken, includeReadOnly: req.query.all === "1" }));
  } catch (err) {
    console.error("[api/calendar-outlook-calendars]", err);
    return res.status(500).json({ error: err.message || "Could not load Outlook calendars" });
  }
}
