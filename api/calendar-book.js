// POST /api/calendar-book — public, unauthenticated. Body:
// { slug, startUTC, endUTC, name, email, phone, timezone, notes }.
// This is the one endpoint that does everything the feature promises
// once a visitor picks a slot: re-validates it's still free, books it,
// creates the Google Calendar event (if connected), and sends the
// confirmation email (SendGrid) + confirmation SMS (Twilio).
import {
  ensureSchema,
  getCalendarBySlug,
  getConfirmedBookingsInRange,
  createCalendarBooking,
  setCalendarBookingGoogleEventId,
  getUserById,
} from "../server/db.js";
import { getValidAccessToken, getFreeBusy, createGoogleEvent } from "../server/googleCalendar.js";
import { computeAvailableSlots, localDateStrInZone } from "../server/calendarAvailability.js";
import { sendCalendarEmail, buildIcs, missingEmailEnv } from "../server/email.js";
import { sendSms, missingTwilioEnv, publicBaseUrl } from "../server/twilioCore.js";
import { runAutomationsForTrigger, hasMatchingAutomation } from "../server/automations.js";

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

export default async function handler(req, res) {
  try {
    await ensureSchema();
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

    const calendar = await getCalendarBySlug(slug, { includeSecrets: true });
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
    let googleBusy = [];
    if (calendar.googleConnected) {
      try {
        const accessToken = await getValidAccessToken(calendar);
        googleBusy = await getFreeBusy({
          accessToken,
          calendarId: calendar.googleCalendarId,
          timeMinISO: dayStartISO,
          timeMaxISO: dayEndISO,
        });
      } catch (err) {
        console.error("[api/calendar-book] freebusy lookup failed", err);
      }
    }
    const existingBookings = await getConfirmedBookingsInRange(calendar.id, dayStartISO, dayEndISO);
    const daySlots = computeAvailableSlots({ calendar, fromDate: dateStr, toDate: dateStr, googleBusy, existingBookings });
    const stillFree = daySlots.some((s) => s.startUTC === startUTC && s.endUTC === endUTC);
    if (!stillFree) {
      return res.status(409).json({ error: "That time was just booked — please pick another slot." });
    }

    let booking;
    try {
      booking = await createCalendarBooking({
        calendarId: calendar.id,
        contactName: name,
        contactEmail: email || null,
        contactPhone: phone || null,
        notes: notes || null,
        startTime: startUTC,
        endTime: endUTC,
        bookerTimezone: timezone || calendar.timezone,
      });
    } catch (err) {
      // Unique-index violation = someone else won the exact race.
      if (String(err.message || "").includes("calendar_bookings_no_double_book")) {
        return res.status(409).json({ error: "That time was just booked — please pick another slot." });
      }
      throw err;
    }

    if (calendar.googleConnected) {
      try {
        const accessToken = await getValidAccessToken(calendar);
        // The video conference link (Zoom, Meet, …) configured on the
        // calendar, if any, is surfaced in brackets after the booker's
        // name in the event title and set as the event's location —
        // that's what makes it show up on both the Google Calendar
        // event card and in the Meet/join button Google renders for a
        // recognized link.
        const summary = calendar.videoConferenceLink
          ? `${calendar.name} with ${name} (${calendar.videoConferenceLink})`
          : `${calendar.name} with ${name}`;
        const eventId = await createGoogleEvent({
          accessToken,
          calendarId: calendar.googleCalendarId,
          summary,
          description: notes || "",
          location: calendar.videoConferenceLink || undefined,
          startISO: startUTC,
          endISO: endUTC,
          timezone: calendar.timezone,
          attendeeEmail: email || undefined,
        });
        await setCalendarBookingGoogleEventId(booking.id, eventId);
      } catch (err) {
        // The booking itself is already saved — a Google-side failure
        // shouldn't undo a real reservation the visitor thinks they
        // have. Surfaced in logs so it can be reconciled manually.
        console.error("[api/calendar-book] failed to create Google event", err);
      }
    }

    const owner = calendar.ownerUserId ? await getUserById(calendar.ownerUserId) : null;
    const bookerWhen = formatInZone(startUTC, timezone || calendar.timezone);
    const ownerWhen = formatInZone(startUTC, calendar.timezone);
    const cancelUrl = `${publicBaseUrl() || ""}/api/calendar-cancel?token=${booking.cancelToken}`;

    // Once a calendar has its own "Booking Created" automation, that
    // automation's own actions ARE the booker-facing confirmation —
    // sending this generic built-in one too meant every booking with
    // a custom automation produced two different confirmation
    // messages, with no way to tell from the booker's side which one
    // was actually configured. The owner notification email below is
    // unaffected — that's an internal notice, not a duplicate.
    const hasCustomBookingAutomation = await hasMatchingAutomation("booking_created", {
      calendarId: calendar.id,
    }).catch(() => false);

    // All genuinely awaited (via Promise.all, so they run concurrently
    // rather than adding up) rather than fire-and-forget behind
    // waitUntil() — waitUntil() only actually extends the function's
    // lifetime when Vercel's runtime has wired up its special request
    // context for that invocation, which isn't guaranteed on every
    // plan/runtime configuration; when it hasn't, it's a silent no-op
    // (see its own source: `getContext().waitUntil?.()`), and
    // unawaited work is liable to get cut off the moment the response
    // below is sent and the container freezes. A single quick call
    // (like the plain confirmation SMS) often gets away with it purely
    // by luck of timing; a multi-step automation chain (DB writes plus
    // a real send) is exactly the kind of work most likely to lose
    // that race. Awaiting adds real latency to this response, but a
    // confirmation that's supposed to send and silently doesn't is
    // worse than a booking call that takes another few hundred ms.
    const confirmationSends = [];
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
      confirmationSends.push(
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
      confirmationSends.push(
        sendCalendarEmail({
          to: owner.email,
          subject: `New booking: ${calendar.name} with ${name}`,
          html: `
            <p>${name} just booked <strong>${calendar.name}</strong> for:</p>
            <p style="font-size:16px"><strong>${ownerWhen}</strong></p>
            <p>Contact: ${email || "—"} ${phone || ""}</p>
            ${notes ? `<p>Notes: ${notes}</p>` : ""}
          `,
        }).catch((err) => console.error("[api/calendar-book] owner notification email failed", err))
      );
    }
    // SMS never blocks/fails the booking — a bad number or unconfigured
    // Twilio shouldn't turn a successful booking into a 500 (each
    // push above already swallows its own error the same way).
    if (phone && !hasCustomBookingAutomation && !missingTwilioEnv().length) {
      confirmationSends.push(
        sendSms({
          to: phone,
          body: `Hi ${name}, your ${calendar.name} is confirmed for ${bookerWhen}. Reply to reschedule.`,
        }).catch((err) => console.error("[api/calendar-book] confirmation SMS failed", err))
      );
    }
    // Separate from the confirmation sends above — a "Booking Created"
    // automation is an extra, user-configured action chain, not a
    // replacement for them (unless hasCustomBookingAutomation already
    // suppressed the built-in ones above).
    confirmationSends.push(
      runAutomationsForTrigger("booking_created", {
        calendarId: calendar.id,
        calendarName: calendar.name,
        contact: { name, email, phone },
        whenText: bookerWhen,
        timezone: timezone || calendar.timezone,
        appointmentStartUTC: startUTC,
      }).catch((err) => console.error("[api/calendar-book] automation trigger failed", err))
    );
    await Promise.all(confirmationSends);

    return res.status(201).json({ booking, whenText: bookerWhen });
  } catch (err) {
    console.error("[api/calendar-book]", err);
    return res.status(500).json({ error: err.message || "Could not complete the booking" });
  }
}
