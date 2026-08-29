// Shared booking business logic — imported by both the Vercel
// functions (/api/google-*.js, /api/booking-settings.js,
// /api/bookings.js, /api/public-*.js) and the local Express server
// (server/index.js), same split as the rest of the app. Every export
// here returns a plain { status, body } (or { status, redirect } for
// the OAuth callback) so both call sites can just forward it onto
// their own req/res — no Express- or Vercel-specific code lives here.
import {
  getGoogleConnectionByUserId,
  upsertGoogleConnection,
  deleteGoogleConnection,
  getBookingSettingsByUserId,
  getBookingSettingsBySlug,
  createBookingSettings,
  updateBookingSettings,
  generateUniqueBookingSlug,
  getBookingCalendars,
  syncBookingCalendars,
  setBookingCalendarIncluded,
  createBooking,
  getBookingsForUser,
  getBookingById,
  updateBookingStatus,
  getUserById,
} from "./db.js";
import {
  missingGoogleEnv,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  revokeGoogleToken,
  getValidAccessTokenForUser,
  listGoogleCalendars,
  getFreeBusy,
  createCalendarEvent,
  cancelCalendarEvent,
  sendGmail,
} from "./googleCalendar.js";
import { signState, verifyState } from "./auth.js";
import { computeAvailableSlots, upcomingLocalDateStrings, formatRangeInTimezone, SLOT_DURATION_OPTIONS } from "./bookingSlots.js";

const MAX_DAYS_AHEAD = 60; // hard cap regardless of a user's own setting — keeps the freeBusy window bounded

// ---------- Authenticated (CRM user) ----------

export async function handleGoogleConnect(user) {
  const missing = missingGoogleEnv();
  if (missing.length) {
    return { status: 500, body: { error: `Google isn't configured yet. Missing: ${missing.join(", ")}` } };
  }
  const state = signState({ uid: user.id });
  return { status: 200, body: { url: buildGoogleAuthUrl(state) } };
}

// Google redirects the contact's browser here directly (a top-level
// navigation, not an XHR) — the result is always a redirect back into
// the app, success or failure, with enough in the query string for
// the Booking tab to show a toast.
export async function handleGoogleCallback({ code, state, error }) {
  const target = (params) => `/?page=booking&${new URLSearchParams(params).toString()}`;
  if (error) return { redirect: target({ google: "error", message: String(error) }) };

  const payload = state ? verifyState(state) : null;
  if (!payload?.uid) {
    return { redirect: target({ google: "error", message: "That connection attempt expired — try again." }) };
  }
  if (!code) return { redirect: target({ google: "error" }) };

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await fetchGoogleUserEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
    await upsertGoogleConnection({
      userId: payload.uid,
      googleEmail: email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt,
      scope: tokens.scope || null,
    });
    return { redirect: target({ google: "connected" }) };
  } catch (err) {
    console.error("[bookingApi] google callback failed", err);
    return { redirect: target({ google: "error", message: err.message || "Connection failed" }) };
  }
}

export async function handleGoogleDisconnect(user) {
  const conn = await getGoogleConnectionByUserId(user.id);
  if (conn?.refresh_token) await revokeGoogleToken(conn.refresh_token);
  else if (conn?.access_token) await revokeGoogleToken(conn.access_token);
  await deleteGoogleConnection(user.id);
  return { status: 204, body: null };
}

export async function handleGetGoogleCalendars(user) {
  const conn = await getGoogleConnectionByUserId(user.id);
  if (!conn) return { status: 409, body: { error: "Connect Google Calendar first." } };
  const accessToken = await getValidAccessTokenForUser(user.id);
  const googleCalendars = await listGoogleCalendars(accessToken);
  const calendars = await syncBookingCalendars(user.id, googleCalendars);
  return { status: 200, body: calendars };
}

export async function handlePatchGoogleCalendar(user, { calendarId, included }) {
  if (!calendarId || typeof included !== "boolean") {
    return { status: 400, body: { error: "Missing calendarId or included" } };
  }
  const row = await setBookingCalendarIncluded(user.id, calendarId, included);
  if (!row) return { status: 404, body: { error: "Calendar not found" } };
  return { status: 200, body: row };
}

async function ensureBookingSettings(user) {
  const existing = await getBookingSettingsByUserId(user.id);
  if (existing) return existing;
  const slug = await generateUniqueBookingSlug(user.name || user.email || `user-${user.id}`);
  return createBookingSettings({ userId: user.id, slug });
}

export async function handleGetBookingSettings(user) {
  const settings = await ensureBookingSettings(user);
  const connection = await getGoogleConnectionByUserId(user.id);
  const calendars = await getBookingCalendars(user.id);
  return {
    status: 200,
    body: {
      settings,
      connected: Boolean(connection),
      googleEmail: connection?.google_email || null,
      calendars,
      slotDurationOptions: SLOT_DURATION_OPTIONS,
    },
  };
}

export async function handlePatchBookingSettings(user, patch = {}) {
  await ensureBookingSettings(user);
  const clean = { ...patch };
  if (clean.slotMinutes !== undefined && !SLOT_DURATION_OPTIONS.includes(Number(clean.slotMinutes))) {
    return { status: 400, body: { error: "Invalid meeting length." } };
  }
  if (clean.daysAhead !== undefined) {
    clean.daysAhead = Math.max(1, Math.min(MAX_DAYS_AHEAD, Number(clean.daysAhead) || 0));
  }
  if (clean.minNoticeHours !== undefined) {
    clean.minNoticeHours = Math.max(0, Number(clean.minNoticeHours) || 0);
  }
  // The booking link is meant to stay stable once it's been shared —
  // changing it isn't exposed here.
  delete clean.slug;
  const updated = await updateBookingSettings(user.id, clean);
  return { status: 200, body: { settings: updated } };
}

export async function handleGetBookings(user) {
  return { status: 200, body: await getBookingsForUser(user.id) };
}

export async function handleCancelBooking(user, id) {
  const booking = await getBookingById(id);
  if (!booking || booking.user_id !== user.id) return { status: 404, body: { error: "Booking not found" } };
  if (booking.status === "cancelled") return { status: 200, body: booking };

  if (booking.google_event_id) {
    try {
      const accessToken = await getValidAccessTokenForUser(user.id);
      if (accessToken) {
        await cancelCalendarEvent({
          accessToken,
          calendarId: booking.google_calendar_id || "primary",
          eventId: booking.google_event_id,
        });
      }
    } catch (err) {
      // The booking is still marked cancelled in the CRM either way —
      // a stale calendar event is a smaller problem than a cancel
      // button that silently does nothing.
      console.error("[bookingApi] calendar cancel failed", err.message);
    }
  }
  const updated = await updateBookingStatus(id, "cancelled");
  return { status: 200, body: updated };
}

// ---------- Public (the contact booking a slot — no auth) ----------

export async function handlePublicBookingInfo(slug) {
  if (!slug) return { status: 400, body: { error: "Missing booking page." } };
  const settings = await getBookingSettingsBySlug(slug);
  if (!settings) return { status: 404, body: { error: "This booking page doesn't exist." } };
  const connection = await getGoogleConnectionByUserId(settings.user_id);
  if (!connection) return { status: 409, body: { error: "This booking page isn't accepting bookings right now." } };
  const host = await getUserById(settings.user_id);
  return {
    status: 200,
    body: {
      hostName: host?.name || "Our team",
      title: settings.title,
      description: settings.description,
      location: settings.location,
      slotMinutes: settings.slot_minutes,
      hostTimezone: settings.timezone,
      daysAhead: Math.min(settings.days_ahead || 30, MAX_DAYS_AHEAD),
    },
  };
}

export async function handlePublicAvailability(slug) {
  if (!slug) return { status: 400, body: { error: "Missing booking page." } };
  const settings = await getBookingSettingsBySlug(slug);
  if (!settings) return { status: 404, body: { error: "This booking page doesn't exist." } };

  const calendars = (await getBookingCalendars(settings.user_id)).filter((c) => c.included);
  if (!calendars.length) return { status: 200, body: { slots: [], slotMinutes: settings.slot_minutes, hostTimezone: settings.timezone } };

  let accessToken;
  try {
    accessToken = await getValidAccessTokenForUser(settings.user_id);
  } catch (err) {
    return { status: 409, body: { error: "This booking page isn't accepting bookings right now." } };
  }
  if (!accessToken) return { status: 409, body: { error: "This booking page isn't accepting bookings right now." } };

  const daysAhead = Math.max(1, Math.min(settings.days_ahead || 30, MAX_DAYS_AHEAD));
  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + daysAhead * 86400000).toISOString();

  const busy = await getFreeBusy({
    accessToken,
    calendarIds: calendars.map((c) => c.calendar_id),
    timeMinIso: windowStart,
    timeMaxIso: windowEnd,
  });

  const minNoticeMs = (settings.min_notice_hours || 0) * 3600000;
  const dateStrings = upcomingLocalDateStrings(now, settings.timezone, daysAhead);
  const slots = dateStrings.flatMap((dateStr) =>
    computeAvailableSlots({
      dateStr,
      hostTimezone: settings.timezone,
      workingHours: settings.working_hours,
      slotMinutes: settings.slot_minutes,
      busy,
      minNoticeMs,
    })
  );

  return { status: 200, body: { slots, slotMinutes: settings.slot_minutes, hostTimezone: settings.timezone } };
}

function bookingEmailBody({ hostName, contactName, settings, startDate, endDate, contactTimezone }) {
  const whenForContact = formatRangeInTimezone(startDate, endDate, contactTimezone);
  const title = settings.title || "Meeting";
  const lines = [
    `Hi ${contactName},`,
    "",
    `Your booking with ${hostName || "us"} is confirmed:`,
    "",
    `${title}`,
    whenForContact,
    settings.location ? `Location: ${settings.location}` : null,
    "",
    "This has been added to their calendar and you'll get an update if anything changes.",
    "",
    `— ${hostName || "The team"}`,
  ].filter((l) => l !== null);
  const text = lines.join("\n");
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#111">
    <p>Hi ${escapeHtml(contactName)},</p>
    <p>Your booking with <strong>${escapeHtml(hostName || "us")}</strong> is confirmed:</p>
    <p style="margin:16px 0;padding:12px 16px;background:#f7f7f7;border-radius:8px">
      <strong>${escapeHtml(title)}</strong><br/>
      ${escapeHtml(whenForContact)}
      ${settings.location ? `<br/>Location: ${escapeHtml(settings.location)}` : ""}
    </p>
    <p>This has been added to their calendar and you'll get an update if anything changes.</p>
    <p>— ${escapeHtml(hostName || "The team")}</p>
  </div>`;
  return { text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handlePublicBook({ slug, start, end, name, email, timezone, notes }) {
  if (!slug || !start || !end || !name || !email || !timezone) {
    return { status: 400, body: { error: "Missing required fields." } };
  }
  const contactName = String(name).trim().slice(0, 200);
  const contactEmail = String(email).trim().slice(0, 320);
  if (!contactName) return { status: 400, body: { error: "Enter your name." } };
  if (!EMAIL_RE.test(contactEmail)) return { status: 400, body: { error: "Enter a valid email address." } };

  const settings = await getBookingSettingsBySlug(slug);
  if (!settings) return { status: 404, body: { error: "This booking page doesn't exist." } };

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return { status: 400, body: { error: "Invalid time slot." } };
  }
  const expectedMs = settings.slot_minutes * 60000;
  if (Math.abs(endDate.getTime() - startDate.getTime() - expectedMs) > 1000) {
    return { status: 400, body: { error: "That time slot no longer matches this page's meeting length." } };
  }
  const minNoticeMs = (settings.min_notice_hours || 0) * 3600000;
  if (startDate.getTime() < Date.now() + minNoticeMs) {
    return { status: 409, body: { error: "That time is no longer far enough in advance — pick another slot." } };
  }
  const maxAheadMs = Math.min(settings.days_ahead || 30, MAX_DAYS_AHEAD) * 86400000;
  if (startDate.getTime() > Date.now() + maxAheadMs) {
    return { status: 409, body: { error: "That time is too far in the future — pick another slot." } };
  }

  let accessToken;
  try {
    accessToken = await getValidAccessTokenForUser(settings.user_id);
  } catch (err) {
    return { status: 409, body: { error: "This booking page isn't accepting bookings right now." } };
  }
  if (!accessToken) return { status: 409, body: { error: "This booking page isn't accepting bookings right now." } };

  // Re-check the slot is still free right before booking it — the
  // contact's page may have been open a while, and someone else could
  // have taken it (via this page or directly on the calendar) since.
  const calendars = (await getBookingCalendars(settings.user_id)).filter((c) => c.included);
  if (calendars.length) {
    const busy = await getFreeBusy({
      accessToken,
      calendarIds: calendars.map((c) => c.calendar_id),
      timeMinIso: startDate.toISOString(),
      timeMaxIso: endDate.toISOString(),
    });
    const conflict = busy.some((b) => startDate < new Date(b.end) && endDate > new Date(b.start));
    if (conflict) return { status: 409, body: { error: "That time was just booked by someone else — pick another slot." } };
  }

  const host = await getUserById(settings.user_id);
  const destinationCalendarId = settings.destination_calendar_id || "primary";
  const title = settings.title || "Meeting";

  let event;
  try {
    event = await createCalendarEvent({
      accessToken,
      calendarId: destinationCalendarId,
      summary: `${title} — ${contactName}`,
      description: [notes ? `Notes from ${contactName}: ${notes}` : null, "Booked via the Scalbl CRM booking page."]
        .filter(Boolean)
        .join("\n\n"),
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
      timeZone: settings.timezone,
      attendeeEmail: contactEmail,
      location: settings.location,
    });
  } catch (err) {
    console.error("[bookingApi] calendar event create failed", err.message);
    return { status: 502, body: { error: "Could not create the calendar event — try again in a moment." } };
  }

  const booking = await createBooking({
    userId: settings.user_id,
    contactName,
    contactEmail,
    contactTimezone: timezone,
    notes: notes ? String(notes).slice(0, 2000) : null,
    startAt: startDate,
    endAt: endDate,
    googleEventId: event.id,
    googleCalendarId: destinationCalendarId,
  });

  // Best-effort — the booking is already on the calendar, so a failed
  // confirmation email shouldn't fail the whole request.
  try {
    const connection = await getGoogleConnectionByUserId(settings.user_id);
    const { text, html } = bookingEmailBody({
      hostName: host?.name,
      contactName,
      settings,
      startDate,
      endDate,
      contactTimezone: timezone,
    });
    await sendGmail({
      accessToken,
      fromEmail: connection.google_email,
      fromName: host?.name,
      to: contactEmail,
      subject: `Confirmed: ${title} with ${host?.name || "us"}`,
      text,
      html,
    });
  } catch (err) {
    console.error("[bookingApi] confirmation email failed", err.message);
  }

  return {
    status: 201,
    body: {
      booking,
      whenForContact: formatRangeInTimezone(startDate, endDate, timezone),
    },
  };
}
