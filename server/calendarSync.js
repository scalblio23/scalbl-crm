// Everything that talks to a calendar's connected external calendars
// (Google and/or Outlook — a calendar can have either or both) goes
// through here, so the booking, availability, cancel and "retry sync"
// endpoints all behave the same way. `calendar` is always a row from
// getCalendarById/getCalendarBySlug(…, { includeSecrets: true }).
//
// A sync failure never undoes a booking (the CRM's own record is the
// source of truth), but it's no longer only console.error'd: it's
// saved on the booking and the calendar, so Calendar settings can show
// what went wrong and offer a retry.
import {
  setCalendarBookingGoogleEventId,
  setCalendarBookingOutlookEventId,
  setCalendarBookingSyncError,
  setCalendarSyncError,
} from "./db.js";
import { getValidAccessToken, getFreeBusy, createGoogleEvent, deleteGoogleEvent } from "./googleCalendar.js";
import {
  getValidOutlookAccessToken,
  getOutlookBusy,
  createOutlookEvent,
  deleteOutlookEvent,
} from "./outlookCalendar.js";

// Busy blocks from every connected calendar between two ISO
// timestamps. Fails open per provider (logged, nothing added) — a
// token hiccup shouldn't take the booking widget down.
export async function getExternalBusy(calendar, timeMinISO, timeMaxISO, logTag = "[calendarSync]") {
  const lookups = [];
  if (calendar.googleConnected) {
    lookups.push(
      getValidAccessToken(calendar)
        .then((accessToken) =>
          getFreeBusy({ accessToken, calendarId: calendar.googleCalendarId, timeMinISO, timeMaxISO })
        )
        .catch((err) => {
          console.error(`${logTag} Google freebusy lookup failed`, err);
          return [];
        })
    );
  }
  if (calendar.outlookConnected) {
    lookups.push(
      getValidOutlookAccessToken(calendar)
        .then((accessToken) =>
          getOutlookBusy({ accessToken, calendarId: calendar.outlookCalendarId, timeMinISO, timeMaxISO })
        )
        .catch((err) => {
          console.error(`${logTag} Outlook busy lookup failed`, err);
          return [];
        })
    );
  }
  return (await Promise.all(lookups)).flat();
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

// Creates the booking's event on every connected calendar that
// doesn't already have it (so it's also the retry). Returns
// { ok, errors: [string] } and records the outcome on the booking and
// the calendar.
export async function pushBookingToCalendars(calendar, booking) {
  const { summary, description, location } = eventDetails(calendar, booking);
  const errors = [];

  if (calendar.googleConnected && !booking.googleEventId) {
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
      await setCalendarBookingGoogleEventId(booking.id, eventId);
      booking.googleEventId = eventId;
    } catch (err) {
      console.error("[calendarSync] failed to create Google event", err);
      errors.push(`Google: ${err.message}`);
    }
  }

  if (calendar.outlookConnected && !booking.outlookEventId) {
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
      await setCalendarBookingOutlookEventId(booking.id, eventId);
      booking.outlookEventId = eventId;
    } catch (err) {
      console.error("[calendarSync] failed to create Outlook event", err);
      errors.push(`Outlook: ${err.message}`);
    }
  }

  const message = errors.length ? errors.join(" · ") : null;
  booking.syncError = message;
  await Promise.all([
    setCalendarBookingSyncError(booking.id, message).catch(() => {}),
    // Only touch the calendar-level banner when something was
    // actually attempted — a calendar with nothing connected keeps
    // whatever it had.
    calendar.googleConnected || calendar.outlookConnected
      ? setCalendarSyncError(calendar.id, message).catch(() => {})
      : null,
  ]);
  return { ok: !errors.length, errors };
}

// Removes the booking's event from every calendar it was put on.
// Failures are logged only — cancelling in the CRM always wins.
export async function removeBookingFromCalendars(calendar, booking, logTag = "[calendarSync]") {
  if (!calendar) return;
  if (booking.googleEventId && calendar.googleConnected) {
    try {
      const accessToken = await getValidAccessToken(calendar);
      await deleteGoogleEvent({ accessToken, calendarId: calendar.googleCalendarId, eventId: booking.googleEventId });
    } catch (err) {
      console.error(`${logTag} failed to delete Google event`, err);
    }
  }
  if (booking.outlookEventId && calendar.outlookConnected) {
    try {
      const accessToken = await getValidOutlookAccessToken(calendar);
      await deleteOutlookEvent({ accessToken, eventId: booking.outlookEventId });
    } catch (err) {
      console.error(`${logTag} failed to delete Outlook event`, err);
    }
  }
}
