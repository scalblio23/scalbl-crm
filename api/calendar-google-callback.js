// GET /api/calendar-google-callback — where Google redirects back to
// after the user consents (or cancels) on the "Integrate with Google"
// screen. Public: Google's redirect carries no CRM session, so this
// verifies the signed `state` from api/calendar-google-connect.js
// instead of requireAuth. Must be added to PUBLIC_PATHS in
// server/index.js and registered as the app's OAuth redirect URI in
// Google Cloud Console.
import jwt from "jsonwebtoken";
import { ensureSchema, getCalendarById, setCalendarGoogleTokens } from "../server/db.js";
import { publicBaseUrl } from "../server/twilioCore.js";
import { exchangeCodeForTokens, fetchGoogleEmail } from "../server/googleCalendar.js";

export default async function handler(req, res) {
  const baseUrl = publicBaseUrl() || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

  function redirectToCrm(query) {
    res.writeHead(302, { Location: `${baseUrl}/?${new URLSearchParams(query).toString()}` });
    return res.end();
  }

  try {
    await ensureSchema();
    const { code, state, error } = req.query || {};
    if (error) return redirectToCrm({ google: "error", reason: String(error) });
    if (!code || !state) return redirectToCrm({ google: "error", reason: "missing_code_or_state" });

    let calendarId;
    try {
      ({ calendarId } = jwt.verify(String(state), process.env.SESSION_SECRET));
    } catch {
      return redirectToCrm({ google: "error", reason: "invalid_state" });
    }

    const calendar = await getCalendarById(calendarId);
    if (!calendar) return redirectToCrm({ google: "error", reason: "calendar_not_found" });

    const { accessToken, refreshToken, expiresAt } = await exchangeCodeForTokens({ code: String(code), baseUrl });
    const googleEmail = await fetchGoogleEmail(accessToken);
    await setCalendarGoogleTokens(calendarId, { googleEmail, accessToken, refreshToken, expiry: expiresAt });

    return redirectToCrm({ calendar: calendarId, google: "connected" });
  } catch (err) {
    console.error("[api/calendar-google-callback]", err);
    return redirectToCrm({ google: "error", reason: "server_error" });
  }
}
