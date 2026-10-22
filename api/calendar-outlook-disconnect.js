// POST /api/calendar-outlook-disconnect — { calendarId, connectionId }.
// Signs one Outlook account out of the calendar (connectionId defaults
// to the one bookings go to). Clears the stored tokens only — doesn't
// revoke the grant on Microsoft's side (that's done from the account's
// own "Apps and services" page).
import { ensureSchema, deleteCalendarConnection, getCalendarById, getCalendarConnection } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, canAccessCalendar } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { calendarId, connectionId } = req.body || {};
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId);
    if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });
    const connection = await getCalendarConnection(calendar.id, connectionId || calendar.outlookConnectionId);
    if (!connection || connection.provider !== "outlook") return res.status(404).json({ error: "Outlook account not found" });
    return res.status(200).json(await deleteCalendarConnection(calendar.id, connection.id));
  } catch (err) {
    console.error("[api/calendar-outlook-disconnect]", err);
    return res.status(500).json({ error: err.message || "Could not disconnect Outlook" });
  }
}
