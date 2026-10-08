// GET /api/calendar-outlook-calendars?calendarId=5 — the calendars on
// the connected Outlook account that events can be added to, for the
// "Which Outlook calendar?" picker in Calendar settings.
import { ensureSchema, getCalendarById } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, canAccessCalendar } from "../server/auth.js";
import { getValidOutlookAccessToken, listOutlookCalendars } from "../server/outlookCalendar.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  try {
    await ensureSchema();
    const calendarId = req.query.calendarId;
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId, { includeSecrets: true });
    if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });
    if (!calendar.outlookConnected) return res.status(409).json({ error: "Connect Outlook first" });

    const accessToken = await getValidOutlookAccessToken(calendar);
    return res.status(200).json(await listOutlookCalendars({ accessToken }));
  } catch (err) {
    console.error("[api/calendar-outlook-calendars]", err);
    return res.status(500).json({ error: err.message || "Could not load Outlook calendars" });
  }
}
