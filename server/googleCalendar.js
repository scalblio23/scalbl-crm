// Shared Google Calendar/Gmail logic used by both the local Express
// server (server/index.js) and the Vercel serverless functions
// (/api/*.js) — exactly the same split as server/twilioCore.js for
// calling. Talks to Google over plain REST (fetch) rather than the
// `googleapis` SDK: the CRM only ever needs a handful of endpoints
// (OAuth token exchange, calendarList, freeBusy, events, Gmail send),
// so a small hand-rolled client keeps the dependency footprint down.
//
// No database access here — token persistence lives in server/db.js
// (google_connections table); getValidAccessTokenForUser below is the
// one place this file reaches into it, to keep the "is my token still
// good, refresh if not" logic in one spot instead of every caller.
import crypto from "crypto";
import { publicBaseUrl } from "./twilioCore.js";
import { getGoogleConnectionByUserId, updateGoogleConnectionTokens } from "./db.js";

const REQUIRED_ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

export function missingGoogleEnv(env = process.env) {
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]);
}

// calendar — read calendarList/freeBusy and create/cancel events.
// gmail.send — send-only, never reads a user's mail. userinfo.email +
// openid — just enough identity to show which Google account is
// connected and to put a real "from" address on confirmation emails.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

// Same redirect target regardless of environment — Twilio's
// publicBaseUrl() already handles PUBLIC_URL (local dev + ngrok) vs
// VERCEL_URL (deployed); local dev without a tunnel falls back to
// localhost so the flow at least works against a Google OAuth client
// configured with an "http://localhost:PORT/..." redirect URI.
export function googleRedirectUri(env = process.env) {
  const base = publicBaseUrl(env) || `http://localhost:${env.PORT || 3001}`;
  return `${base}/api/google-callback`;
}

// access_type=offline + prompt=consent guarantees a refresh_token
// comes back every time (Google only issues one on first consent
// otherwise) — needed since reconnecting after a revoke must produce
// a usable connection again, not a token-less one.
export function buildGoogleAuthUrl(state, env = process.env) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(env),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(params, env = process.env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || body.error || "Google token request failed");
  }
  return body;
}

export async function exchangeCodeForTokens(code, env = process.env) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri(env) }, env);
}

export async function refreshGoogleAccessToken(refreshToken, env = process.env) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }, env);
}

// Best-effort — called on disconnect. A failed revoke shouldn't block
// the user from disconnecting in the CRM; the row is deleted either way.
export async function revokeGoogleToken(token) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    // ignored — see comment above
  }
}

export async function fetchGoogleUserEmail(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not read the connected Google account's email address.");
  const body = await res.json();
  return body.email;
}

// Ensures the caller always has a live access token, refreshing (and
// persisting the refresh) transparently when the cached one is
// expired or about to be. Returns null if this user never connected a
// Google account; throws if they did but the connection can no longer
// be refreshed (e.g. access was revoked from the Google Account
// settings page, not from inside the CRM) — callers surface that as
// "reconnect your Google account".
export async function getValidAccessTokenForUser(userId, env = process.env) {
  const conn = await getGoogleConnectionByUserId(userId);
  if (!conn) return null;
  const expiryMs = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (conn.access_token && expiryMs - Date.now() > 60_000) {
    return conn.access_token;
  }
  if (!conn.refresh_token) {
    throw new Error("Your Google connection has expired — reconnect it from the Booking tab.");
  }
  let tokens;
  try {
    tokens = await refreshGoogleAccessToken(conn.refresh_token, env);
  } catch (err) {
    throw new Error("Your Google connection has expired — reconnect it from the Booking tab.");
  }
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
  await updateGoogleConnectionTokens(userId, { accessToken: tokens.access_token, expiresAt });
  return tokens.access_token;
}

async function googleApiFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = body?.error?.message || `Google API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

// minAccessRole=freeBusyReader keeps this to calendars this account
// can actually check conflicts against (excludes e.g. calendars only
// shared read-only for viewing free/busy text).
export async function listGoogleCalendars(accessToken) {
  const body = await googleApiFetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=freeBusyReader&maxResults=250",
    accessToken
  );
  return (body.items || []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary || c.id,
    primary: Boolean(c.primary),
  }));
}

export async function getFreeBusy({ accessToken, calendarIds, timeMinIso, timeMaxIso }) {
  if (!calendarIds.length) return [];
  const body = await googleApiFetch("https://www.googleapis.com/calendar/v3/freeBusy", accessToken, {
    method: "POST",
    body: JSON.stringify({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  const busy = [];
  for (const calId of Object.keys(body.calendars || {})) {
    for (const b of body.calendars[calId].busy || []) busy.push(b);
  }
  return busy;
}

// sendUpdates=none — the CRM sends its own confirmation email (see
// sendGmail below) rather than relying on Google Calendar's own
// invite mail, so the contact isn't double-emailed and the message
// content stays in the CRM's control.
export async function createCalendarEvent({
  accessToken,
  calendarId = "primary",
  summary,
  description,
  startIso,
  endIso,
  timeZone,
  attendeeEmail,
  location,
}) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`;
  return googleApiFetch(url, accessToken, {
    method: "POST",
    body: JSON.stringify({
      summary,
      description,
      location: location || undefined,
      start: { dateTime: startIso, timeZone },
      end: { dateTime: endIso, timeZone },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
      reminders: { useDefault: true },
    }),
  });
}

export async function cancelCalendarEvent({ accessToken, calendarId = "primary", eventId }) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
    eventId
  )}?sendUpdates=none`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  // 410 Gone = already deleted on the Google side (e.g. by hand) —
  // treat as success rather than surfacing an error for something
  // that's already true.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Could not cancel the calendar event (${res.status})`);
  }
}

function base64UrlEncode(str) {
  return Buffer.from(str, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Sends as the connected Google account itself (Gmail API's
// users.messages.send always sends "from" the authenticated user) —
// this is what puts the confirmation email in the contact's inbox as
// coming from the CRM user's real Gmail address, per the ask.
export async function sendGmail({ accessToken, fromEmail, fromName, to, subject, text, html }) {
  const boundary = `scalbl_${crypto.randomBytes(8).toString("hex")}`;
  const headerLines = [
    `From: ${fromName ? `"${fromName.replace(/"/g, "")}" <${fromEmail}>` : fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const bodyLines = [
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "",
    `--${boundary}--`,
  ];
  const raw = base64UrlEncode(`${headerLines.join("\r\n")}\r\n${bodyLines.join("\r\n")}`);
  return googleApiFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", accessToken, {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
}
