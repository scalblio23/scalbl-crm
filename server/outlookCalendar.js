// Microsoft OAuth + Graph Calendar API — the Outlook side of the
// Calendars feature's "Integrate" section, mirroring
// server/googleCalendar.js call for call: connect
// (api/calendar-outlook-connect.js → api/calendar-outlook-callback.js),
// read busy time for the booking widget, and create/delete the event
// when a slot is booked or cancelled. Works for both work/school
// (Microsoft 365) and personal (outlook.com / hotmail) accounts —
// the "common" tenant accepts either. Plain REST calls over the
// runtime's fetch, no Graph SDK dependency.
import { updateCalendarOutlookAccessToken } from "./db.js";

const MS_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH_API = "https://graph.microsoft.com/v1.0";

// offline_access is what makes Microsoft return a refresh token;
// Calendars.ReadWrite covers reading busy time, listing calendars and
// creating/deleting events; User.Read is just enough to show which
// account is connected.
const SCOPES = ["offline_access", "User.Read", "Calendars.ReadWrite"].join(" ");

export function missingOutlookEnv(env = process.env) {
  return ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"].filter((key) => !env[key]);
}

export function outlookRedirectUri(baseUrl) {
  return `${baseUrl}/api/calendar-outlook-callback`;
}

export function buildOutlookAuthUrl({ baseUrl, state }, env = process.env) {
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    redirect_uri: outlookRedirectUri(baseUrl),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES,
    prompt: "select_account",
    state,
  });
  return `${MS_AUTHORITY}/authorize?${params.toString()}`;
}

async function msFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error === "invalid_grant") {
      throw new Error("Outlook access has expired or was revoked — disconnect and reconnect Outlook on this calendar.");
    }
    const message = body?.error_description || body?.error?.message || body?.error || res.statusText;
    throw new Error(`Microsoft API error (${res.status}): ${message}`);
  }
  return body;
}

async function tokenRequest(params, env = process.env) {
  const body = await msFetch(`${MS_AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      scope: SCOPES,
      ...params,
    }),
  });
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    scope: body.scope || "",
  };
}

export function exchangeOutlookCode({ code, baseUrl }, env = process.env) {
  return tokenRequest({ code, redirect_uri: outlookRedirectUri(baseUrl), grant_type: "authorization_code" }, env);
}

export function hasOutlookWriteScope(grantedScope) {
  return String(grantedScope || "")
    .toLowerCase()
    .split(/\s+/)
    .some((s) => s === "calendars.readwrite" || s.endsWith("/calendars.readwrite"));
}

export async function fetchOutlookEmail(accessToken) {
  const body = await msFetch(`${GRAPH_API}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return body.mail || body.userPrincipalName || null;
}

// Same contract as googleCalendar.js's getValidAccessToken. Microsoft
// rotates refresh tokens, so a refresh also persists the new one.
export async function getValidOutlookAccessToken(calendar, env = process.env) {
  const expiresAt = calendar.outlookTokenExpiry ? new Date(calendar.outlookTokenExpiry).getTime() : 0;
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return calendar.outlookAccessToken;
  }
  if (!calendar.outlookRefreshToken) {
    throw new Error("Outlook is connected but has no refresh token on file — reconnect it.");
  }
  const { accessToken, refreshToken, expiresAt: newExpiresAt } = await tokenRequest(
    { refresh_token: calendar.outlookRefreshToken, grant_type: "refresh_token" },
    env
  );
  await updateCalendarOutlookAccessToken(calendar.id, { accessToken, refreshToken, expiry: newExpiresAt });
  calendar.outlookAccessToken = accessToken;
  calendar.outlookTokenExpiry = newExpiresAt;
  if (refreshToken) calendar.outlookRefreshToken = refreshToken;
  return accessToken;
}

// Path prefix for one calendar on the account — null means the
// account's default calendar.
function calendarPath(calendarId) {
  return calendarId ? `/me/calendars/${encodeURIComponent(calendarId)}` : "/me/calendar";
}

// Calendars on the account that events can be added to, default first.
export async function listOutlookCalendars({ accessToken }) {
  const body = await msFetch(`${GRAPH_API}/me/calendars?$select=id,name,isDefaultCalendar,canEdit&$top=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (body.value || [])
    .filter((c) => c.canEdit !== false)
    .map((c) => ({ id: c.id, summary: c.name || c.id, primary: Boolean(c.isDefaultCalendar) }))
    .sort((a, b) => (a.primary === b.primary ? a.summary.localeCompare(b.summary) : a.primary ? -1 : 1));
}

// Graph returns dateTimes without an offset ("2026-10-07T09:00:00.0000000")
// in whatever zone the Prefer header asked for — UTC here.
function graphUtcToISO(dt) {
  return new Date(`${String(dt).replace(/Z$/, "")}Z`).toISOString();
}

// Busy blocks between two ISO timestamps, same shape as
// googleCalendar.js's getFreeBusy ([{ start, end }]). Uses calendarView
// rather than getSchedule because getSchedule isn't available on
// personal Microsoft accounts. Events marked "free" or cancelled don't
// block time.
export async function getOutlookBusy({ accessToken, calendarId = null, timeMinISO, timeMaxISO }) {
  const params = new URLSearchParams({
    startDateTime: timeMinISO,
    endDateTime: timeMaxISO,
    $select: "start,end,showAs,isCancelled",
    $top: "250",
  });
  let url = `${GRAPH_API}${calendarPath(calendarId)}/calendarView?${params.toString()}`;
  const busy = [];
  // Bounded paging — a booking window's worth of events is normally a
  // single page; the cap just stops a runaway loop.
  for (let page = 0; url && page < 10; page++) {
    const body = await msFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    for (const e of body.value || []) {
      if (e.isCancelled || e.showAs === "free") continue;
      busy.push({ start: graphUtcToISO(e.start.dateTime), end: graphUtcToISO(e.end.dateTime) });
    }
    url = body["@odata.nextLink"] || null;
  }
  return busy;
}

// Creates the event on the connected calendar. Unlike Google, Graph
// can't add an attendee without emailing them an invite, and the
// booker already gets the app's own confirmation — so the booker's
// details go in the event body instead of the attendee list.
export async function createOutlookEvent({
  accessToken,
  calendarId = null,
  summary,
  description,
  location,
  startISO,
  endISO,
}) {
  const body = await msFetch(`${GRAPH_API}${calendarPath(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: summary,
      body: { contentType: "text", content: description || "" },
      start: { dateTime: new Date(startISO).toISOString().replace(/Z$/, ""), timeZone: "UTC" },
      end: { dateTime: new Date(endISO).toISOString().replace(/Z$/, ""), timeZone: "UTC" },
      location: location ? { displayName: location } : undefined,
      showAs: "busy",
    }),
  });
  return body.id;
}

export async function deleteOutlookEvent({ accessToken, eventId }) {
  if (!eventId) return;
  const res = await fetch(`${GRAPH_API}/me/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404 = already deleted on the Outlook side — not an error here.
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Microsoft API error (${res.status}): ${body?.error?.message || res.statusText}`);
  }
}
