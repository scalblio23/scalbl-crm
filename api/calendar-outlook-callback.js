// GET /api/calendar-outlook-callback — where Microsoft redirects back
// to after sign-in/consent. Public (no CRM session on the redirect),
// so it verifies the signed `state` from
// api/calendar-outlook-connect.js instead. Must be in PUBLIC_PATHS in
// server/index.js and registered as a Web redirect URI on the app in
// Microsoft Entra (Azure) → App registrations.
import jwt from "jsonwebtoken";
import { ensureSchema, getCalendarById, setCalendarOutlookTokens } from "../server/db.js";
import { requestBaseUrl } from "../server/googleCalendar.js";
import { exchangeOutlookCode, fetchOutlookEmail, hasOutlookWriteScope } from "../server/outlookCalendar.js";

export default async function handler(req, res) {
  const baseUrl = requestBaseUrl(req);

  function redirectToCrm(query) {
    res.writeHead(302, { Location: `${baseUrl}/?${new URLSearchParams(query).toString()}` });
    return res.end();
  }

  try {
    await ensureSchema();
    const { code, state, error } = req.query || {};
    if (error) return redirectToCrm({ outlook: "error", reason: String(error) });
    if (!code || !state) return redirectToCrm({ outlook: "error", reason: "missing_code_or_state" });

    let calendarId;
    try {
      const payload = jwt.verify(String(state), process.env.SESSION_SECRET);
      if (payload.provider !== "outlook") throw new Error("wrong provider");
      calendarId = payload.calendarId;
    } catch {
      return redirectToCrm({ outlook: "error", reason: "invalid_state" });
    }

    const calendar = await getCalendarById(calendarId);
    if (!calendar) return redirectToCrm({ outlook: "error", reason: "calendar_not_found" });

    const { accessToken, refreshToken, expiresAt, scope } = await exchangeOutlookCode({ code: String(code), baseUrl });
    if (!hasOutlookWriteScope(scope)) {
      return redirectToCrm({ calendar: calendarId, outlook: "error", reason: "missing_events_permission" });
    }
    const outlookEmail = await fetchOutlookEmail(accessToken);
    await setCalendarOutlookTokens(calendarId, { outlookEmail, accessToken, refreshToken, expiry: expiresAt });

    return redirectToCrm({ calendar: calendarId, outlook: "connected" });
  } catch (err) {
    console.error("[api/calendar-outlook-callback]", err);
    return redirectToCrm({ outlook: "error", reason: "server_error" });
  }
}
