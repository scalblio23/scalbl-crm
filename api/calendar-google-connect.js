// GET /api/calendar-google-connect?calendarId=5 — the "Integrate with
// Google" button in Calendar settings just links straight here. Signs
// a short-lived state token (who's connecting which calendar) and
// 302s to Google's consent screen; api/calendar-google-callback.js
// verifies that same token when Google redirects back. Requires a
// logged-in CRM session (this is an authenticated user connecting
// *their* calendar, not a public endpoint).
import jwt from "jsonwebtoken";
import { ensureSchema, getCalendarById } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { buildGoogleAuthUrl, missingGoogleEnv, requestBaseUrl } from "../server/googleCalendar.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    const missing = missingGoogleEnv();
    if (missing.length) {
      return res.status(500).json({ error: `Google integration is not configured. Missing: ${missing.join(", ")}` });
    }
    const calendarId = req.query.calendarId;
    if (!calendarId) return res.status(400).json({ error: "Missing calendarId" });
    const calendar = await getCalendarById(calendarId);
    if (!calendar) return res.status(404).json({ error: "Calendar not found" });

    const baseUrl = requestBaseUrl(req);
    const state = jwt.sign({ calendarId: String(calendarId) }, process.env.SESSION_SECRET, { expiresIn: "10m" });
    const url = buildGoogleAuthUrl({ baseUrl, state });
    res.writeHead(302, { Location: url });
    return res.end();
  } catch (err) {
    console.error("[api/calendar-google-connect]", err);
    return res.status(500).json({ error: err.message || "Could not start the Google connection" });
  }
}
