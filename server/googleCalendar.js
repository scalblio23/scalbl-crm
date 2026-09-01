// Google OAuth + Calendar API — used by the Calendars feature's
// "Integrate with Google" flow (api/calendar-google-connect.js,
// api/calendar-google-callback.js) and by every endpoint that needs
// to read/write the connected Google Calendar (api/calendar-slots.js,
// api/calendar-book.js, api/calendar-cancel.js). Same shared-module
// pattern as server/twilioCore.js — no separate googleapis dependency;
// this is a handful of plain REST calls, made with the runtime's
// built-in fetch (Node 18+, same assumption the rest of the app makes).
import { updateCalendarGoogleAccessToken } from "./db.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// Requested once, at connect time: write access to events (so a
// booking can create/delete an event), read access to the calendar
// list (so Calendar settings can offer a "which calendar?" picker
// instead of always using "primary" — calendar.events alone does not
// reliably cover CalendarList.list), plus just enough profile scope
// to show which Google account is connected. A calendar connected
// before calendar.readonly was added here only has the older, smaller
// scope grant on file — it needs to be reconnected (disconnect +
// "Connect with Google" again) to pick up the wider one; there's no
// way to add a scope to an already-issued token after the fact.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function missingGoogleEnv(env = process.env) {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((key) => !env[key]);
}

export function googleRedirectUri(baseUrl) {
  return `${baseUrl}/api/calendar-google-callback`;
}

// The base URL used to build the OAuth redirect_uri — Google rejects
// the whole flow with "Error 400: redirect_uri_mismatch" unless this
// exactly matches an Authorized redirect URI registered in Google
// Cloud Console. Deliberately NOT server/twilioCore.js's
// publicBaseUrl() here: that prefers VERCEL_URL, which on Vercel is
// the deployment's own unique hash URL (e.g.
// "my-app-git-branch-hash.vercel.app"), not the custom/production
// domain a deployment is aliased to — even for a deployment currently
// serving production traffic. Using the incoming request's own Host
// header instead always matches whatever domain the browser is
// actually on, which is exactly what needs to match Google Cloud
// Console's registered URI. PUBLIC_URL (e.g. an ngrok tunnel in local
// dev) still overrides when set, same convention as publicBaseUrl().
export function requestBaseUrl(req, env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  return `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
}

// Builds the "Connect with Google" URL — clicking it is the entire
// integration flow from the user's side, same as any other "Sign in
// with Google" button. `state` carries which calendar/user this
// consent is for (signed JWT — see api/calendar-google-connect.js) so
// the callback can pick up where this left off without needing a
// session of its own.
export function buildGoogleAuthUrl({ baseUrl, state }, env = process.env) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(baseUrl),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function googleFetch(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error_description || body?.error?.message || body?.error || res.statusText;
    throw new Error(`Google API error (${res.status}): ${message}`);
  }
  return body;
}

// Exchanges the one-time `code` from the OAuth redirect for an
// access/refresh token pair. Google only ever returns refresh_token
// on the first consent (or a re-consent forced by prompt=consent) —
// callers should keep the old one on file if this response omits it.
export async function exchangeCodeForTokens({ code, baseUrl }, env = process.env) {
  const body = await googleFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(baseUrl),
      grant_type: "authorization_code",
    }),
  });
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
}

export async function fetchGoogleEmail(accessToken) {
  const body = await googleFetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return body.email || null;
}

async function refreshAccessToken(refreshToken, env = process.env) {
  const body = await googleFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
}

// Returns a definitely-valid access token for a calendar row (as
// returned by getCalendarById(id, { includeSecrets: true })),
// refreshing and persisting a new one first if the current one is
// within 5 minutes of expiring. Every call site that talks to the
// Calendar API should go through this rather than reading
// googleAccessToken off the row directly.
export async function getValidAccessToken(calendar, env = process.env) {
  const expiresAt = calendar.googleTokenExpiry ? new Date(calendar.googleTokenExpiry).getTime() : 0;
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return calendar.googleAccessToken;
  }
  if (!calendar.googleRefreshToken) {
    throw new Error("Google Calendar is connected but has no refresh token on file — reconnect it.");
  }
  const { accessToken, expiresAt: newExpiresAt } = await refreshAccessToken(calendar.googleRefreshToken, env);
  await updateCalendarGoogleAccessToken(calendar.id, { accessToken, expiry: newExpiresAt });
  return accessToken;
}

// Every calendar (not just "primary") the connected account can see —
// powers the "Which calendar?" picker in Calendar settings once
// Google's connected. calendar.events (the only scope this app
// requests) covers CalendarList.list per Google's own scope-to-method
// mapping, so no extra/broader scope is needed just to enumerate
// calendars. Sorted primary-first, then alphabetically, since that's
// the calendar someone's most likely to want.
export async function listGoogleCalendars({ accessToken }) {
  const body = await googleFetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const items = body.items || [];
  return items
    .map((c) => ({ id: c.id, summary: c.summary || c.id, primary: Boolean(c.primary) }))
    .sort((a, b) => (a.primary === b.primary ? a.summary.localeCompare(b.summary) : a.primary ? -1 : 1));
}

// Free/busy blocks on the connected calendar between two ISO
// timestamps — used to keep the booking widget from ever offering a
// slot the owner is already busy for on their real Google Calendar.
// `calendarId` is whichever calendar was picked in Calendar settings
// (defaults to "primary" — see server/db.js's google_calendar_id
// column default).
export async function getFreeBusy({ accessToken, calendarId = "primary", timeMinISO, timeMaxISO }) {
  const body = await googleFetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] }),
  });
  return body.calendars?.[calendarId]?.busy || [];
}

// Creates the event on the booker's behalf as an attendee.
// sendUpdates: "none" — the app's own SendGrid email is the
// confirmation the booker sees, not Google's default invite email, so
// there's exactly one confirmation rather than two different-looking
// ones landing seconds apart.
export async function createGoogleEvent({
  accessToken,
  calendarId = "primary",
  summary,
  description,
  startISO,
  endISO,
  timezone,
  attendeeEmail,
}) {
  const body = await googleFetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: startISO, timeZone: timezone },
        end: { dateTime: endISO, timeZone: timezone },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
      }),
    }
  );
  return body.id;
}

export async function deleteGoogleEvent({ accessToken, calendarId = "primary", eventId }) {
  if (!eventId) return;
  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  // 410 Gone = already deleted on the Google side — not an error here.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Google API error (${res.status}): ${body?.error?.message || res.statusText}`);
  }
}
