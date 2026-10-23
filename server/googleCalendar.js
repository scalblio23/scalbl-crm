// Google OAuth + Calendar API — used by the Calendars feature's
// "Integrate with Google" flow (api/calendar-google-connect.js,
// api/calendar-google-callback.js) and by every endpoint that needs
// to read/write the connected Google Calendar (api/calendar-slots.js,
// api/calendar-book.js, api/calendar-cancel.js). Same shared-module
// pattern as server/twilioCore.js — no separate googleapis dependency;
// this is a handful of plain REST calls, made with the runtime's
// built-in fetch (Node 18+, same assumption the rest of the app makes).
import { updateCalendarConnectionTokens } from "./db.js";

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

// Google's consent screen shows each permission as its own checkbox,
// and a user can untick "View and edit events" while still finishing
// the flow. The connection then looked fine (free/busy still worked
// through calendar.readonly) but every booking's event insert came
// back 403 and was only ever logged — appointments silently never
// reached Google Calendar. The callback now checks the granted scopes
// against this and refuses a connection that can't create events.
export const GOOGLE_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function hasGoogleEventsScope(grantedScope) {
  const granted = String(grantedScope || "").split(/\s+/);
  return granted.includes(GOOGLE_EVENTS_SCOPE) || granted.includes("https://www.googleapis.com/auth/calendar");
}

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
    // select_account: always show the account chooser, so signing in a
    // second Google account doesn't silently reuse the first.
    prompt: "select_account consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function googleFetch(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant = the refresh token is dead: the user revoked
    // access, changed their password, or (very commonly) the Google
    // Cloud OAuth app is still in "Testing", where Google expires every
    // refresh token after 7 days. Only reconnecting fixes it, so say so.
    if (body?.error === "invalid_grant") {
      throw new Error(
        "Google access has expired or was revoked — disconnect and reconnect Google on this calendar. " +
          "(If this keeps happening every week, publish the Google Cloud OAuth app from Testing to Production.)"
      );
    }
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
    scope: body.scope || "",
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

// Returns a definitely-valid access token for one signed-in Google
// account (an entry of a calendar's `connections`, loaded with
// { includeSecrets: true }), refreshing and persisting a new one first
// if the current one is within 5 minutes of expiring. Every call site
// that talks to the Calendar API should go through this (or
// getValidAccessToken below) rather than reading accessToken directly.
export async function getValidConnectionAccessToken(connection, env = process.env) {
  const expiresAt = connection.tokenExpiry ? new Date(connection.tokenExpiry).getTime() : 0;
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    throw new Error(`Google account ${connection.email || ""} has no refresh token on file — reconnect it.`);
  }
  const { accessToken, expiresAt: newExpiresAt } = await refreshAccessToken(connection.refreshToken, env);
  await updateCalendarConnectionTokens(connection.id, { accessToken, expiry: newExpiresAt });
  // Kept on the in-memory object too, so a second call in the same
  // request (free/busy check, then the event insert) reuses it instead
  // of refreshing again.
  connection.accessToken = accessToken;
  connection.tokenExpiry = newExpiresAt;
  return accessToken;
}

// The token for the Google account a calendar's bookings go to
// (calendar.googleConnectionId — see server/db.js's calendarFromRow).
export async function getValidAccessToken(calendar, env = process.env) {
  const connection = (calendar.connections || []).find(
    (c) => c.provider === "google" && c.id === calendar.googleConnectionId
  );
  if (!connection) throw new Error("No Google account is chosen for bookings on this calendar.");
  return getValidConnectionAccessToken(connection, env);
}

// Every calendar (not just "primary") the connected account can see —
// powers the "Which calendar?" picker in Calendar settings once
// Google's connected. calendar.events (the only scope this app
// requests) covers CalendarList.list per Google's own scope-to-method
// mapping, so no extra/broader scope is needed just to enumerate
// calendars. Sorted primary-first, then alphabetically, since that's
// the calendar someone's most likely to want.
export async function listGoogleCalendars({ accessToken, includeReadOnly = false }) {
  const body = await googleFetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Only calendars the account can add events to — picking one that's
  // merely shared read-only with it (accessRole "reader" /
  // "freeBusyReader") made every booking's event insert fail with 403.
  // includeReadOnly is for the "also check for clashes" list, where a
  // read-only calendar's busy times are exactly what's wanted.
  const items = (body.items || []).filter(
    (c) => includeReadOnly || c.accessRole === "owner" || c.accessRole === "writer"
  );
  return items
    .map((c) => ({
      id: c.id,
      summary: c.summary || c.id,
      primary: Boolean(c.primary),
      writable: c.accessRole === "owner" || c.accessRole === "writer",
    }))
    .sort((a, b) => (a.primary === b.primary ? a.summary.localeCompare(b.summary) : a.primary ? -1 : 1));
}

// Free/busy blocks on the connected calendar between two ISO
// timestamps — used to keep the booking widget from ever offering a
// slot the owner is already busy for on their real Google Calendar.
// `calendarId` is whichever calendar was picked in Calendar settings
// (defaults to "primary" — see server/db.js's google_calendar_id
// column default).
// extraCalendarIds: more calendars on the same account to check for
// clashes ("Also check for clashes" in Calendar settings) — one
// freeBusy request covers them all.
export async function getFreeBusy({ accessToken, calendarId = "primary", extraCalendarIds = [], timeMinISO, timeMaxISO }) {
  const ids = [...new Set([calendarId, ...extraCalendarIds].filter(Boolean))].slice(0, 50);
  const body = await googleFetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: ids.map((id) => ({ id })) }),
  });
  return ids.flatMap((id) => body.calendars?.[id]?.busy || []);
}

// Creates the event on the booker's behalf as an attendee.
// sendUpdates: "none" — the app's own Resend email is the
// confirmation the booker sees, not Google's default invite email, so
// there's exactly one confirmation rather than two different-looking
// ones landing seconds apart.
export async function createGoogleEvent({
  accessToken,
  calendarId = "primary",
  summary,
  description,
  location,
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
        location: location || undefined,
        start: { dateTime: startISO, timeZone: timezone },
        end: { dateTime: endISO, timeZone: timezone },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
      }),
    }
  );
  return body.id;
}

// Same event as createGoogleEvent, plus a Google Meet conference
// generated for it (conferenceData.createRequest, which needs
// conferenceDataVersion=1). Separate function rather than a flag on
// createGoogleEvent so that one's return value — and every existing
// calendar's events — stay exactly as they were. Only used by the
// patient confirmation workflow (server/patientReminders.js).
// Returns { id, meetLink } — meetLink is null when Google didn't
// produce one (Workspace policy, API hiccup), and callers fall back
// to the calendar's own video link.
export async function createGoogleEventWithMeet({
  accessToken,
  calendarId = "primary",
  summary,
  description,
  location,
  startISO,
  endISO,
  timezone,
  attendeeEmail,
  requestId,
}) {
  const body = await googleFetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none&conferenceDataVersion=1`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        description,
        location: location || undefined,
        start: { dateTime: startISO, timeZone: timezone },
        end: { dateTime: endISO, timeZone: timezone },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
        conferenceData: {
          createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      }),
    }
  );
  const videoEntry = (body.conferenceData?.entryPoints || []).find((e) => e.entryPointType === "video");
  return { id: body.id, meetLink: body.hangoutLink || videoEntry?.uri || null };
}

// Moves an existing event (a reschedule). The Meet conference stays
// attached to the event, so its link carries over unchanged.
export async function patchGoogleEventTimes({ accessToken, calendarId = "primary", eventId, startISO, endISO, timezone }) {
  await googleFetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { dateTime: startISO, timeZone: timezone },
        end: { dateTime: endISO, timeZone: timezone },
      }),
    }
  );
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
