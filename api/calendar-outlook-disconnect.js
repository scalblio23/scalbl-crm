// POST /api/calendar-outlook-disconnect — { calendarId }. Clears the
// stored Outlook tokens (doesn't revoke the grant on Microsoft's side —
// that's done from the account's own "Apps and services" page).
import { ensureSchema, clearCalendarOutlookTokens, getCalendarById } from "../server/db.js";
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
    const { calendarId } = req.body || {};
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId);
    if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });
    return res.status(200).json(await clearCalendarOutlookTokens(calendarId));
  } catch (err) {
    console.error("[api/calendar-outlook-disconnect]", err);
    return res.status(500).json({ error: err.message || "Could not disconnect Outlook" });
  }
}
