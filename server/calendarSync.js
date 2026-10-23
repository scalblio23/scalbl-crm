// Everything that talks to a calendar's signed-in Google/Outlook
// accounts goes through here, so the booking, availability, cancel and
// "retry sync" endpoints all behave the same way. `calendar` is always a
// row from getCalendarById/getCalendarBySlug(…, { includeSecrets: true }).
//
// A calendar can have any number of accounts signed in (both
// providers). Busy time on every account's ticked calendars blocks
// slots; each booking is added to exactly one place — the account +
// calendar chosen under "Add calls to calendar" (calendar.googleConnected
// / outlookConnected describe only that target; see calendarFromRow).
//
// A sync failure never undoes a booking (the CRM's own record is the
// source of truth), but it's no longer only console.error'd: it's
// saved on the booking and the calendar, so Calendar settings can show
// what went wrong and offer a retry.
import {
  getConfirmedBookingsForCalendars,
  setCalendarBookingGoogleEventId,
  setCalendarBookingOutlookEventId,
  setCalendarBookingSyncError,
  setCalendarSyncError,
} from "./db.js";
import {
  getValidAccessToken,
  getValidConnectionAccessToken,
  getFreeBusy,
  createGoogleEvent,
  deleteGoogleEvent,
} from "./googleCalendar.js";
import {
  getValidOutlookAccessToken,
  getValidOutlookConnectionAccessToken,
  getOutlookBusy,
  createOutlookEvent,
  deleteOutlookEvent,
} from "./outlookCalendar.js";

// The calendars on one account whose busy time counts: its ticked
// clash calendars, plus the booking calendar when this is the account
// bookings go to. "primary" = the account's main calendar.
function busyCalendarIds(calendar, connection) {
  const ids = [...connection.clashCalendarIds];
  if (connection.id === calendar.bookingConnectionId) ids.unshift(calendar.bookingCalendarId || "primary");
  return [...new Set(ids)];
}

// Busy blocks from every signed-in account between two ISO timestamps.
// Fails open per account (logged, nothing added) — a token hiccup
// shouldn't take the booking widget down.
export async function getExternalBusy(calendar, timeMinISO, timeMaxISO, logTag = "[calendarSync]") {
  const lookups = (calendar.connections || []).map((connection) => {
    const ids = busyCalendarIds(calendar, connection);
    if (!ids.length) return [];
    if (connection.provider === "google") {
      return getValidConnectionAccessToken(connection)
        .then((accessToken) =>
          getFreeBusy({ accessToken, calendarId: ids[0], extraCalendarIds: ids.slice(1), timeMinISO, timeMaxISO })
        )
        .catch((err) => {
          console.error(`${logTag} Google freebusy lookup failed for ${connection.email}`, err);
          return [];
        });
    }
    return getValidOutlookConnectionAccessToken(connection)
      .then(async (accessToken) => {
        const results = await Promise.all(
          ids.slice(0, 20).map((calendarId) =>
            getOutlookBusy({ accessToken, calendarId, timeMinISO, timeMaxISO }).catch((err) => {
              console.error(`${logTag} Outlook busy lookup failed for one calendar of ${connection.email}`, err);
              return [];
            })
          )
        );
        return results.flat();
      })
      .catch((err) => {
        console.error(`${logTag} Outlook busy lookup failed for ${connection.email}`, err);
        return [];
      });
  });
  return (await Promise.all(lookups)).flat();
}

// The calendar as seen from where one booking's event actually lives —
// the account/calendar it was put on, which may no longer be the
// booking target. Returns a copy whose googleConnected/googleCalendarId
// (or outlook*) point there, so the usual token/event helpers can be
// used as-is; null when that account isn't signed in any more.
// Bookings from before multiple accounts existed have no connection
// recorded and fall back to the current target.
export function calendarForBookingEvent(calendar, booking, provider) {
  if (!calendar) return null;
  if (provider === "google") {
    const id = booking.googleEventConnectionId || calendar.googleConnectionId;
    if (!id || !(calendar.connections || []).some((c) => c.provider === "google" && c.id === Number(id))) return null;
    return {
      ...calendar,
      googleConnected: true,
      googleConnectionId: Number(id),
      googleCalendarId:
        booking.googleEventCalendarId || (Number(id) === calendar.googleConnectionId ? calendar.googleCalendarId : "primary"),
    };
  }
  const id = booking.outlookEventConnectionId || calendar.outlookConnectionId;
  if (!id || !(calendar.connections || []).some((c) => c.provider === "outlook" && c.id === Number(id))) return null;
  return { ...calendar, outlookConnected: true, outlookConnectionId: Number(id) };
}

// Bookings on the OTHER CRM calendars this one checks for clashes (so
// one person isn't double-booked across two booking links), as plain
// busy blocks — kept apart from the calendar's own bookings, which
// also count toward its max-bookings-per-day limit.
export async function getCrmClashBusy(calendar, fromISO, toISO) {
  const others = (calendar.clashCrmCalendarIds || []).filter((id) => Number(id) !== Number(calendar.id));
  if (!others.length) return [];
  const bookings = await getConfirmedBookingsForCalendars(others, fromISO, toISO);
  return bookings.map((b) => ({ start: new Date(b.startTime).toISOString(), end: new Date(b.endTime).toISOString() }));
}

function eventDetails(calendar, booking) {
  // The video conference link (Zoom, Meet, …) configured on the
  // calendar, if any, is surfaced in brackets after the booker's name
  // in the event title and set as the event's location — that's what
  // makes it show up on the event card and as the join button the
  // calendar app renders for a recognized link.
  const summary = calendar.videoConferenceLink
    ? `${calendar.name} with ${booking.contactName} (${calendar.videoConferenceLink})`
    : `${calendar.name} with ${booking.contactName}`;
  const description = [
    `Booked by: ${booking.contactName}`,
    booking.contactEmail ? `Email: ${booking.contactEmail}` : null,
    booking.contactPhone ? `Phone: ${booking.contactPhone}` : null,
    booking.notes ? `\nNotes: ${booking.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { summary, description, location: calendar.videoConferenceLink || undefined };
}

// Adds the booking's event to the calendar chosen under "Add calls to
// calendar", unless it's already on one (so it's also the retry).
// Returns { ok, errors: [string] } and records the outcome on the
// booking and the calendar.
export async function pushBookingToCalendars(calendar, booking) {
  const { summary, description, location } = eventDetails(calendar, booking);
  const errors = [];
  const alreadyOnACalendar = Boolean(booking.googleEventId || booking.outlookEventId);

  if (!alreadyOnACalendar && calendar.googleConnected) {
    try {
      const accessToken = await getValidAccessToken(calendar);
      const eventId = await createGoogleEvent({
        accessToken,
        calendarId: calendar.googleCalendarId,
        summary,
        description,
        location,
        startISO: new Date(booking.startTime).toISOString(),
        endISO: new Date(booking.endTime).toISOString(),
        timezone: calendar.timezone,
        attendeeEmail: booking.contactEmail || undefined,
      });
      await setCalendarBookingGoogleEventId(booking.id, eventId, {
        connectionId: calendar.googleConnectionId,
        calendarId: calendar.googleCalendarId,
      });
      booking.googleEventId = eventId;
      booking.googleEventConnectionId = calendar.googleConnectionId;
      booking.googleEventCalendarId = calendar.googleCalendarId;
    } catch (err) {
      console.error("[calendarSync] failed to create Google event", err);
      errors.push(`Google (${calendar.googleEmail || "account"}): ${err.message}`);
    }
  }

  if (!alreadyOnACalendar && calendar.outlookConnected) {
    try {
      const accessToken = await getValidOutlookAccessToken(calendar);
      const eventId = await createOutlookEvent({
        accessToken,
        calendarId: calendar.outlookCalendarId,
        summary,
        description,
        location,
        startISO: booking.startTime,
        endISO: booking.endTime,
      });
      await setCalendarBookingOutlookEventId(booking.id, eventId, { connectionId: calendar.outlookConnectionId });
      booking.outlookEventId = eventId;
      booking.outlookEventConnectionId = calendar.outlookConnectionId;
    } catch (err) {
      console.error("[calendarSync] failed to create Outlook event", err);
      errors.push(`Outlook (${calendar.outlookEmail || "account"}): ${err.message}`);
    }
  }

  const message = errors.length ? errors.join(" · ") : null;
  booking.syncError = message;
  await Promise.all([
    setCalendarBookingSyncError(booking.id, message).catch(() => {}),
    // Only touch the calendar-level banner when something was
    // actually attempted — a calendar with no booking target keeps
    // whatever it had.
    !alreadyOnACalendar && (calendar.googleConnected || calendar.outlookConnected)
      ? setCalendarSyncError(calendar.id, message).catch(() => {})
      : null,
  ]);
  return { ok: !errors.length, errors };
}

// Removes the booking's event from wherever it was put. Failures are
// logged only — cancelling in the CRM always wins.
export async function removeBookingFromCalendars(calendar, booking, logTag = "[calendarSync]") {
  if (!calendar) return;
  const onGoogle = booking.googleEventId && calendarForBookingEvent(calendar, booking, "google");
  if (onGoogle) {
    try {
      const accessToken = await getValidAccessToken(onGoogle);
      await deleteGoogleEvent({ accessToken, calendarId: onGoogle.googleCalendarId, eventId: booking.googleEventId });
    } catch (err) {
      console.error(`${logTag} failed to delete Google event`, err);
    }
  }
  const onOutlook = booking.outlookEventId && calendarForBookingEvent(calendar, booking, "outlook");
  if (onOutlook) {
    try {
      const accessToken = await getValidOutlookAccessToken(onOutlook);
      await deleteOutlookEvent({ accessToken, eventId: booking.outlookEventId });
    } catch (err) {
      console.error(`${logTag} failed to delete Outlook event`, err);
    }
  }
}
