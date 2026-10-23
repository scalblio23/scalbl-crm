// POST /api/calendar-book — public, unauthenticated. Body:
// { slug, startUTC, endUTC, name, email, phone, timezone, notes }.
// This is the one endpoint that does everything the feature promises
// once a visitor picks a slot: re-validates it's still free, books it,
// creates the Google and/or Outlook calendar event (if connected), and sends the
// confirmation email (Resend) + confirmation SMS (Twilio).
import {
  withSchemaRetry,
  getCalendarBySlug,
  getConfirmedBookingsInRange,
  createCalendarBooking,
  getUserById,
  markContactsBookedForBooking,
  setCalendarBookingContactsSynced,
} from "../server/db.js";
import { getCrmClashBusy, getExternalBusy, pushBookingToCalendars } from "../server/calendarSync.js";
import { computeAvailableSlots, localDateStrInZone } from "../server/calendarAvailability.js";
import { sendCalendarEmail, buildIcs, missingEmailEnv } from "../server/email.js";
import { sendSms, missingTwilioEnv, publicBaseUrl } from "../server/twilioCore.js";
import { queueAutomationsForTrigger, startQueuedRuns } from "../server/automations.js";
import { afterResponse } from "../server/afterResponse.js";
import { workflowFor, createWorkflowGoogleEvent, onWorkflowBookingCreated } from "../server/patientReminders.js";

function formatInZone(iso, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function ownerNotificationEmail({ calendar, owner, name, email, phone, notes, startUTC }) {
  return sendCalendarEmail({
    to: owner.email,
    subject: `New booking: ${calendar.name} with ${name}`,
    html: `
      <p>${name} just booked <strong>${calendar.name}</strong> for:</p>
      <p style="font-size:16px"><strong>${formatInZone(startUTC, calendar.timezone)}</strong></p>
      <p>Contact: ${email || "—"} ${phone || ""}</p>
      ${notes ? `<p>Notes: ${notes}</p>` : ""}
    `,
  }).catch((err) => console.error("[api/calendar-book] owner notification email failed", err));
}

// A calendar with the patient confirmation workflow switched on
// (currently Keevo Health) is handled end to end by
// server/patientReminders.js: Google event with a generated Meet link,
// the confirmation email/SMS, and the 12h/30m/10m reminders. Its own
// confirmations replace both the generic built-in ones AND any "Booking
// Created" automations — every automation step messages the booker, so
// running them as well would send duplicate confirmations and competing
// reminders. The owner notification email is still sent.
async function runWorkflowAfterBooking({ booking, calendar, name, email, phone, notes, startUTC }) {
  // Google event with a generated Meet link; then any other connected
  // calendar (Outlook) gets the booking the usual way.
  const workflowEvent = await createWorkflowGoogleEvent(booking, calendar);
  if (workflowEvent) booking.googleEventId = workflowEvent.id;
  await pushBookingToCalendars(calendar, booking);
  const owner = calendar.ownerUserId ? await getUserById(calendar.ownerUserId) : null;
  await Promise.all([
    onWorkflowBookingCreated(booking.id).catch((err) =>
      console.error("[api/calendar-book] confirmation workflow failed", err)
    ),
    owner?.email && !missingEmailEnv().length
      ? ownerNotificationEmail({ calendar, owner, name, email, phone, notes, startUTC })
      : null,
  ]);
}

// Everything a normal booking does once it's saved, after the visitor
// already has their "You're booked" screen (see waitUntil in the
// handler). Each piece fails on its own without stopping the rest: a
// Google/Outlook failure is recorded on the booking + calendar (shown in
// Calendar settings with a retry button — see server/calendarSync.js).
async function runAfterBooking({ booking, calendar, queued, name, email, phone, notes, startUTC, endUTC, bookerWhen }) {
  // Once a calendar has its own "Booking Created" automation, that
  // automation's own actions ARE the booker-facing confirmation, so the
  // generic built-in one isn't sent as well (it would be a second,
  // different-looking confirmation). The owner notification still is.
  const hasCustomBookingAutomation = queued.length > 0;
  const owner = calendar.ownerUserId ? await getUserById(calendar.ownerUserId).catch(() => null) : null;
  // Links to the manage page, where cancelling takes a button press —
  // link scanners that pre-fetch email URLs can't cancel anything, and
  // the token sits in the fragment, out of server access logs.
  const cancelUrl = `${publicBaseUrl() || ""}/book/${calendar.slug}#manage=${booking.cancelToken}&action=cancel`;

  const work = [
    pushBookingToCalendars(calendar, booking).catch((err) =>
      console.error("[api/calendar-book] calendar sync failed", err)
    ),
    startQueuedRuns(queued),
  ];
  if (email && !hasCustomBookingAutomation && !missingEmailEnv().length) {
    const ics = buildIcs({
      uid: `booking-${booking.id}@scalbl-crm`,
      summary: `${calendar.name} with ${owner?.name || "the team"}`,
      description: notes || "",
      startISO: startUTC,
      endISO: endUTC,
      organizerEmail: owner?.email,
      attendeeEmail: email,
    });
    work.push(
      sendCalendarEmail({
        to: email,
        subject: `Confirmed: ${calendar.name} — ${bookerWhen}`,
        html: `
          <p>Hi ${name},</p>
          <p>Your <strong>${calendar.name}</strong> is confirmed for:</p>
          <p style="font-size:16px"><strong>${bookerWhen}</strong></p>
          ${notes ? `<p>Notes: ${notes}</p>` : ""}
          <p><a href="${cancelUrl}">Cancel this booking</a></p>
        `,
        ics,
      }).catch((err) => console.error("[api/calendar-book] confirmation email failed", err))
    );
  }
  if (owner?.email && !missingEmailEnv().length) {
    work.push(ownerNotificationEmail({ calendar, owner, name, email, phone, notes, startUTC }));
  }
  if (phone && !hasCustomBookingAutomation && !missingTwilioEnv().length) {
    work.push(
      sendSms({
        to: phone,
        body: `Hi ${name}, your ${calendar.name} is confirmed for ${bookerWhen}. Reply to reschedule.`,
      }).catch((err) => console.error("[api/calendar-book] confirmation SMS failed", err))
    );
  }
  await Promise.all(work);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { slug, startUTC, endUTC, name, email, phone, timezone, notes } = req.body || {};
    if (!slug || !startUTC || !endUTC || !name) {
      return res.status(400).json({ error: "Missing slug, startUTC, endUTC, or name" });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: "An email or phone number is required to confirm the booking" });
    }

    // Speed: no ensureSchema up front (see withSchemaRetry) — a lead is
    // waiting on this answer.
    const calendar = await withSchemaRetry(() => getCalendarBySlug(slug, { includeSecrets: true }));
    if (!calendar || !calendar.active) return res.status(404).json({ error: "Calendar not found" });

    // Re-check the slot is still free right before booking — closes
    // most of the race a visitor sitting on a stale slot list could
    // hit; the DB's partial unique index (see server/db.js) is the
    // actual last line of defense against two people booking at once.
    const dateStr = localDateStrInZone(startUTC, calendar.timezone);
    // Padded a day either side rather than using this local day's own
    // UTC midnight-to-midnight — that only equals the calendar's real
    // local day for a UTC-timezone calendar. For any offset timezone,
    // a slot near the start/end of the local day falls outside a
    // window built that way, so a real Google Calendar conflict there
    // would be missed by the freebusy check below (src/BookingWidget.jsx
    // pads its own request the same way, for the same reason).
    const prevDateStr = new Date(`${dateStr}T00:00:00Z`);
    prevDateStr.setUTCDate(prevDateStr.getUTCDate() - 1);
    const nextDateStr = new Date(`${dateStr}T00:00:00Z`);
    nextDateStr.setUTCDate(nextDateStr.getUTCDate() + 1);
    const dayStartISO = `${prevDateStr.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const dayEndISO = `${nextDateStr.toISOString().slice(0, 10)}T23:59:59.999Z`;
    const [providerBusy, crmBusy, existingBookings] = await Promise.all([
      getExternalBusy(calendar, dayStartISO, dayEndISO, "[api/calendar-book]"),
      getCrmClashBusy(calendar, dayStartISO, dayEndISO),
      withSchemaRetry(() => getConfirmedBookingsInRange(calendar.id, dayStartISO, dayEndISO)),
    ]);
    const externalBusy = [...providerBusy, ...crmBusy];
    const daySlots = computeAvailableSlots({ calendar, fromDate: dateStr, toDate: dateStr, googleBusy: externalBusy, existingBookings });
    const stillFree = daySlots.some((s) => s.startUTC === startUTC && s.endUTC === endUTC);
    if (!stillFree) {
      return res.status(409).json({ error: "That time was just booked — please pick another slot." });
    }

    let booking;
    try {
      // A failed INSERT inserted nothing, so retrying it is safe.
      booking = await withSchemaRetry(() => createCalendarBooking({
        calendarId: calendar.id,
        contactName: name,
        contactEmail: email || null,
        contactPhone: phone || null,
        notes: notes || null,
        startTime: startUTC,
        endTime: endUTC,
        bookerTimezone: timezone || calendar.timezone,
      }));
    } catch (err) {
      // Unique-index violation = someone else won the exact race.
      if (String(err.message || "").includes("calendar_bookings_no_double_book")) {
        return res.status(409).json({ error: "That time was just booked — please pick another slot." });
      }
      throw err;
    }

    // Mark the booker's lead Booked so setters stop calling someone
    // who's already in the calendar. Never fails the booking — if it
    // throws, contacts_synced stays false and the next cold start's
    // sync (server/db.js) retries it.
    try {
      await markContactsBookedForBooking(booking, calendar);
      await setCalendarBookingContactsSynced(booking.id);
    } catch (err) {
      console.error("[api/calendar-book] failed to mark contact Booked", err);
    }

    // Everything after this point runs AFTER the visitor is told they're
    // booked (see server/afterResponse.js — on Vercel, waitUntil keeps
    // the function alive until it's done), so "You're booked" shows as
    // soon as the booking is saved. Patient
    // workflow calendars: see runWorkflowAfterBooking.
    const workflow = workflowFor(calendar);
    if (workflow) {
      await afterResponse(
        runWorkflowAfterBooking({ booking, calendar, name, email, phone, notes, startUTC }).catch((err) =>
          console.error("[api/calendar-book] after-booking work failed", err)
        )
      );
      const { cancelToken, ...publicBooking } = booking;
      return res.status(201).json({ booking: publicBooking, whenText: formatInZone(startUTC, timezone || calendar.timezone) });
    }
    const bookerWhen = formatInZone(startUTC, timezone || calendar.timezone);
    // Queued (durable) before answering: if the background work below is
    // ever cut short, the every-minute cron still runs these.
    const queued = await queueAutomationsForTrigger("booking_created", {
      bookingId: booking.id,
      calendarId: calendar.id,
      calendarName: calendar.name,
      contact: { name, email, phone },
      whenText: bookerWhen,
      timezone: timezone || calendar.timezone,
      appointmentStartUTC: startUTC,
    }).catch((err) => {
      console.error("[api/calendar-book] automation trigger failed", err);
      return [];
    });
    await afterResponse(
      runAfterBooking({ booking, calendar, queued, name, email, phone, notes, startUTC, endUTC, bookerWhen }).catch((err) =>
        console.error("[api/calendar-book] after-booking work failed", err)
      )
    );
    return res.status(201).json({ booking, whenText: bookerWhen });
  } catch (err) {
    console.error("[api/calendar-book]", err);
    return res.status(500).json({ error: err.message || "Could not complete the booking" });
  }
}
