// GET /api/calendar-outlook-connect?calendarId=5 — the "Connect with
// Outlook" button in Calendar settings links straight here. Same flow
// as api/calendar-google-connect.js: sign a short-lived state token
// and 302 to Microsoft's sign-in/consent screen;
// api/calendar-outlook-callback.js verifies it on the way back.
import jwt from "jsonwebtoken";
import { ensureSchema, getCalendarById } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, canAccessCalendar } from "../server/auth.js";
import { requestBaseUrl } from "../server/googleCalendar.js";
import { buildOutlookAuthUrl, missingOutlookEnv } from "../server/outlookCalendar.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  try {
    await ensureSchema();
    const missing = missingOutlookEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Outlook integration is not configured. Missing: ${missing.join(", ")}` });
    }
    const calendarId = req.query.calendarId;
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId);
    if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });

    const baseUrl = requestBaseUrl(req);
    const state = jwt.sign({ calendarId: String(calendarId), provider: "outlook" }, process.env.SESSION_SECRET, {
      expiresIn: "10m",
    });
    res.writeHead(302, { Location: buildOutlookAuthUrl({ baseUrl, state }) });
    return res.end();
  } catch (err) {
    console.error("[api/calendar-outlook-connect]", err);
    return res.status(500).json({ error: err.message || "Could not start the Outlook connection" });
  }
}
