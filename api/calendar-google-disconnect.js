// POST /api/calendar-google-disconnect — { calendarId, connectionId }.
// Signs one Google account out of the calendar (connectionId defaults
// to the one bookings go to). Just forgets the stored tokens; doesn't
// revoke Google's own grant (the user can do that from their Google
// Account's "Third-party access" page if they want to fully revoke
// rather than just unlink here).
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
    const connection = await getCalendarConnection(calendar.id, connectionId || calendar.googleConnectionId);
    if (!connection || connection.provider !== "google") return res.status(404).json({ error: "Google account not found" });
    return res.status(200).json(await deleteCalendarConnection(calendar.id, connection.id));
  } catch (err) {
    console.error("[api/calendar-google-disconnect]", err);
    return res.status(500).json({ error: err.message || "Could not disconnect Google" });
  }
}
