// POST /api/calendar-google-disconnect — { calendarId }. Just clears
// the stored tokens; doesn't revoke Google's own grant (the user can
// do that from their Google Account's "Third-party access" page if
// they want to fully revoke rather than just unlink here).
import { ensureSchema, clearCalendarGoogleTokens, getCalendarById } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { calendarId } = req.body || {};
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId);
    if (!calendar) return res.status(404).json({ error: "Calendar not found" });
    const updated = await clearCalendarGoogleTokens(calendarId);
    return res.status(200).json(updated);
  } catch (err) {
    console.error("[api/calendar-google-disconnect]", err);
    return res.status(500).json({ error: err.message || "Could not disconnect Google" });
  }
}
