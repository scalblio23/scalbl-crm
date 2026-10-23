// Patient confirmation & reminder workflow — opt-in per calendar via
// calendars.confirmation_workflow (see WORKFLOWS below; currently only
// Keevo Health). A calendar without it set never reaches any of this:
// api/calendar-book.js, api/calendar-cancel.js, api/calendar-bookings.js
// and api/sms-inbound.js all check workflowFor(calendar) first and keep
// their original behavior otherwise.
//
// For a workflow calendar, every booking gets:
//   - a confirmation (email + SMS) the moment it's booked,
//   - a Y/N confirmation request 12 hours before (email + SMS),
//   - a join reminder 30 minutes before and 10 minutes before.
// A "Y" reply marks the booking's attendance confirmed (+ an ack SMS);
// an "N" reply cancels that booking, stops its reminders and sends a
// rebooking link. No reply changes nothing.
//
// Every message is a row in booking_reminders, unique per (booking,
// schedule_version, kind, channel), delivered by the same per-minute
// cron that already advances automation runs. Before anything is sent
// the booking row is locked and re-checked (still booked, same
// schedule version, not started) inside the same transaction that
// records the outcome — so a reminder can't slip out for a booking that
// was cancelled or rescheduled a moment earlier, and a retried cron
// tick can't send the same row twice.
import crypto from "crypto";
import twilio from "twilio";
import { getPool, calendarFromRow, calendarBookingFromRow, CALENDAR_CONNECTIONS_SQL } from "./db.js";
import { sendCalendarEmail, buildIcs, missingEmailEnv } from "./email.js";
import { sendSms, missingTwilioEnv, publicBaseUrl } from "./twilioCore.js";
import {
  getValidAccessToken,
  getFreeBusy,
  createGoogleEventWithMeet,
  patchGoogleEventTimes,
  deleteGoogleEvent,
} from "./googleCalendar.js";
import { computeAvailableSlots, localDateStrInZone } from "./calendarAvailability.js";
import { getValidOutlookAccessToken, deleteOutlookEvent } from "./outlookCalendar.js";
import { calendarForBookingEvent } from "./calendarSync.js";

export const WORKFLOWS = {
  keevo_health: { brand: "Keevo Health", callName: "Keevo Health discovery call" },
};

export function workflowFor(calendar) {
  return (calendar && WORKFLOWS[calendar.confirmationWorkflow]) || null;
}

// Base for the patient's links. PUBLIC_URL wins; otherwise Vercel's
// production domain (VERCEL_PROJECT_PRODUCTION_URL, set automatically
// on every deployment) rather than the per-deployment VERCEL_URL that
// publicBaseUrl() falls back to — per-deployment URLs can sit behind
// Vercel's login (Deployment Protection), which would break every
// reschedule/cancel link a patient taps.
export function patientLinkBase(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/+$/, "")}`;
  return publicBaseUrl(env);
}

// Twilio only accepts E.164 ("+614…") — it never infers a country —
// but patients type numbers the Australian way ("0412 345 678"). Those
// are converted; anything already international is left alone, and
// anything unrecognisable is passed through for Twilio to reject (which
// is then logged as a failed reminder, never silently dropped).
export function toSendableNumber(raw) {
  const s = String(raw || "").trim();
  if (s.startsWith("+")) return `+${s.slice(1).replace(/\D/g, "")}`;
  const d = s.replace(/\D/g, "");
  if (/^00\d{8,15}$/.test(d)) return `+${d.slice(2)}`;
  if (/^0[2-478]\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^61[2-478]\d{8}$/.test(d)) return `+${d}`;
  if (/^4\d{8}$/.test(d)) return `+61${d}`;
  return s;
}

// Swappable for tests — production always uses the real providers.
const defaultDeps = {
  sendSms,
  sendEmail: sendCalendarEmail,
  missingEmailEnv,
  missingTwilioEnv,
  baseUrl: () => patientLinkBase(),
  env: () => process.env,
  google: { getValidAccessToken, getFreeBusy, createGoogleEventWithMeet, patchGoogleEventTimes, deleteGoogleEvent },
};
let deps = defaultDeps;
export function __setDepsForTests(overrides) {
  deps = overrides ? { ...defaultDeps, ...overrides, google: { ...defaultDeps.google, ...(overrides.google || {}) } } : defaultDeps;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---------- DB helpers ----------

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function q(text, params = []) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

// Audit trail. Never stores message bodies, only what happened.
async function logEvent(db, bookingId, type, detail = {}) {
  await db.query("INSERT INTO booking_events (booking_id, type, detail) VALUES ($1,$2,$3)", [
    bookingId,
    type,
    JSON.stringify(detail),
  ]);
}

async function lockBooking(db, bookingId) {
  const { rows } = await db.query(
    `SELECT b.*, row_to_json(c.*) AS calendar_row, ${CALENDAR_CONNECTIONS_SQL} AS calendar_connections
     FROM calendar_bookings b JOIN calendars c ON c.id = b.calendar_id
     WHERE b.id = $1 FOR UPDATE OF b`,
    [bookingId]
  );
  if (!rows[0]) return null;
  return {
    booking: calendarBookingFromRow(rows[0]),
    calendar: calendarFromRow({ ...rows[0].calendar_row, connections: rows[0].calendar_connections }, { includeSecrets: true }),
  };
}

const PHONE_DIGITS_SQL = `regexp_replace(regexp_replace(COALESCE(b.contact_phone, ''), '\\D', '', 'g'), '^(61|0)', '')`;
function phoneDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("61")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

// ---------- Scheduling ----------

const REMINDER_OFFSETS = { reminder_12h: 12 * HOUR, reminder_30m: 30 * MIN, reminder_10m: 10 * MIN };

// When each message for one schedule version goes out. A booking (or
// reschedule) made inside a reminder's window doesn't get that
// reminder scheduled in the past:
//   - 12h Y/N request: sent a minute after the confirmation instead,
//     as long as the call is still at least an hour away (still worth
//     asking); closer than that it's skipped.
//   - 30m / 10m: skipped once their moment has passed — the
//     confirmation that just went out already carries the time and
//     the join link, and whichever of them is still ahead stays.
export function planReminderTimes(startISO, now = new Date()) {
  const start = new Date(startISO).getTime();
  const t = now.getTime();
  const plan = [{ kind: "confirmation", sendAt: new Date(t) }];
  const ideal12 = start - REMINDER_OFFSETS.reminder_12h;
  if (ideal12 >= t) plan.push({ kind: "reminder_12h", sendAt: new Date(ideal12) });
  else if (start - t >= HOUR) plan.push({ kind: "reminder_12h", sendAt: new Date(t + MIN) });
  for (const kind of ["reminder_30m", "reminder_10m"]) {
    const ideal = start - REMINDER_OFFSETS[kind];
    if (ideal >= t) plan.push({ kind, sendAt: new Date(ideal) });
  }
  return plan;
}

function channelsFor(booking) {
  const channels = [];
  if (booking.contactEmail) channels.push("email");
  if (booking.contactPhone) channels.push("sms");
  return channels;
}

async function insertReminder(db, booking, kind, channel, sendAt) {
  const { rows } = await db.query(
    `INSERT INTO booking_reminders (booking_id, schedule_version, kind, channel, send_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (booking_id, schedule_version, kind, channel) DO NOTHING
     RETURNING id`,
    [booking.id, booking.scheduleVersion, kind, channel, sendAt.toISOString()]
  );
  return rows[0]?.id || null;
}

// Idempotent — scheduling the same booking version twice is a no-op.
async function scheduleForCurrentVersion(db, booking, now = new Date()) {
  const ids = [];
  for (const { kind, sendAt } of planReminderTimes(booking.startTime, now)) {
    for (const channel of channelsFor(booking)) {
      const id = await insertReminder(db, booking, kind, channel, sendAt);
      if (id) ids.push(id);
    }
  }
  await logEvent(db, booking.id, "reminders_scheduled", { version: booking.scheduleVersion, count: ids.length });
  return ids;
}

async function cancelPendingReminders(db, bookingId, reason) {
  const { rowCount } = await db.query(
    `UPDATE booking_reminders SET status = 'cancelled', last_error = $2, updated_at = now()
     WHERE booking_id = $1 AND status = 'pending'`,
    [bookingId, reason]
  );
  return rowCount;
}

// ---------- Message content ----------

function formatWhen(iso, timeZone) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
  return { date, time, full: `${date} at ${time}` };
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The patient's links. The token rides in the URL fragment (#…), which
// browsers never send to a server, so it doesn't end up in access logs
// or Referer headers; the manage page posts it in a request body. The
// fragment carries no personal details — just the opaque token.
function links(base, calendar, booking) {
  const manage = `${base}/book/${calendar.slug}#manage=${booking.cancelToken}`;
  return {
    manage,
    reschedule: `${manage}&action=reschedule`,
    cancel: `${manage}&action=cancel`,
    confirm: `${manage}&action=confirm`,
    addToCalendar: `${manage}&action=calendar`,
    rebook: `${base}/book/${calendar.slug}`,
  };
}

export const CONFIRMATION_RULE_TEXT =
  "12 hours before your appointment, you'll receive a confirmation request. Reply Y to confirm your attendance or N if you cannot attend. Replying N will automatically cancel your appointment and stop its reminders. You can then use the booking link provided to schedule another time. If you don't reply, your appointment will remain booked and you will continue receiving scheduled reminders.";

export function meetLinkFor(booking, calendar) {
  return booking.meetLink || calendar.videoConferenceLink || null;
}

export function bookingIcs(booking, calendar, workflow, { cancelled = false } = {}) {
  const meet = meetLinkFor(booking, calendar);
  return buildIcs({
    uid: `booking-${booking.id}@scalbl-crm`,
    summary: workflow.callName,
    description: meet ? `Join with Google Meet: ${meet}` : "",
    location: meet || undefined,
    startISO: new Date(booking.startTime).toISOString(),
    endISO: new Date(booking.endTime).toISOString(),
    attendeeEmail: booking.contactEmail || undefined,
    sequence: booking.scheduleVersion + (cancelled ? 1 : 0),
    method: cancelled ? "CANCEL" : "PUBLISH",
    status: cancelled ? "CANCELLED" : "CONFIRMED",
  });
}

// Returns { subject, html, text, ics } — `text` is the SMS body.
export function renderMessage(kind, { booking, calendar, workflow, base }) {
  const tz = booking.bookerTimezone || calendar.timezone || "UTC";
  const when = formatWhen(booking.startTime, tz);
  const meet = meetLinkFor(booking, calendar);
  const l = links(base, calendar, booking);
  const hi = `Hi ${firstName(booking.contactName)},`;
  const meetText = meet ? `Join with Google Meet: ${meet}` : "Your meeting link will be sent to you before the call.";
  const meetHtml = meet
    ? `<p><strong>Join with Google Meet:</strong> <a href="${escapeHtml(meet)}">${escapeHtml(meet)}</a></p>`
    : `<p>Your meeting link will be sent to you before the call.</p>`;
  const call = workflow.callName;

  if (kind === "confirmation") {
    const isReschedule = booking.scheduleVersion > 1;
    const lead = isReschedule ? `your ${call} has been moved to` : `your ${call} is booked for`;
    return {
      subject: `${isReschedule ? "Rescheduled" : "Booked"}: ${call} — ${when.full}`,
      text: [
        `${hi} ${lead} ${when.full}.`,
        meetText,
        `Add to calendar: ${l.addToCalendar}`,
        `Reschedule: ${l.reschedule}`,
        `Cancel: ${l.cancel}`,
        CONFIRMATION_RULE_TEXT,
      ].join("\n\n"),
      html: `
        <p>${escapeHtml(hi)}</p>
        <p>${escapeHtml(lead.charAt(0).toUpperCase() + lead.slice(1))}:</p>
        <p style="font-size:16px"><strong>${escapeHtml(when.full)}</strong></p>
        ${meetHtml}
        <p>A calendar invitation is attached — open it to add this call to your calendar
          (or <a href="${escapeHtml(l.addToCalendar)}">add it from here</a>).</p>
        <p><a href="${escapeHtml(l.reschedule)}">Reschedule</a> &nbsp;·&nbsp; <a href="${escapeHtml(l.cancel)}">Cancel</a></p>
        <p><strong>How confirmation works:</strong> ${escapeHtml(CONFIRMATION_RULE_TEXT)}</p>
      `,
      ics: bookingIcs(booking, calendar, workflow),
    };
  }
  if (kind === "reminder_12h") {
    const timeText = `${when.time} on ${when.date}`;
    return {
      subject: `Please confirm: ${call} at ${timeText}`,
      text: `Your ${call} is at ${timeText}. Reply Y to confirm or N if you can't attend.`,
      html: `
        <p>${escapeHtml(hi)}</p>
        <p>Your ${escapeHtml(call)} is at <strong>${escapeHtml(timeText)}</strong>.</p>
        <p>Reply <strong>Y</strong> to the text message we've just sent you to confirm, or <strong>N</strong> if you can't attend.
          You can also use these links:</p>
        <p><a href="${escapeHtml(l.confirm)}">Confirm I'll attend</a> &nbsp;·&nbsp; <a href="${escapeHtml(l.cancel)}">I can't attend — cancel</a></p>
        <p>Replying N (or cancelling) cancels this appointment and stops its reminders. If you don't reply, your appointment stays booked.</p>
        ${meetHtml}
      `,
    };
  }
  if (kind === "reminder_30m" || kind === "reminder_10m") {
    const mins = kind === "reminder_30m" ? 30 : 10;
    const lead =
      mins === 30
        ? `Reminder: your ${call} starts in 30 minutes, at ${when.full}.`
        : `Your ${call} starts in 10 minutes (${when.time}). Please join now.`;
    return {
      subject: mins === 30 ? `Starting in 30 minutes: ${call}` : `Starting in 10 minutes: ${call} — join now`,
      text: `${lead}\n\n${meet ? `Join here: ${meet}` : "Your meeting link will follow shortly."}`,
      html: `
        <p>${escapeHtml(hi)}</p>
        <p>${escapeHtml(lead)}</p>
        ${meet ? `<p><a href="${escapeHtml(meet)}" style="font-size:16px"><strong>Join the call</strong></a><br/>${escapeHtml(meet)}</p>` : meetHtml}
      `,
    };
  }
  if (kind === "ack_confirmed") {
    return { subject: `Confirmed: ${call}`, text: "Thanks for confirming. We look forward to speaking with you.", html: "<p>Thanks for confirming. We look forward to speaking with you.</p>" };
  }
  if (kind === "cancellation") {
    return {
      subject: `Cancelled: ${call} — ${when.full}`,
      text: `Your ${call} on ${when.full} has been cancelled, and you won't receive any more reminders for it. To book another time: ${l.rebook}`,
      html: `
        <p>${escapeHtml(hi)}</p>
        <p>Your ${escapeHtml(call)} on <strong>${escapeHtml(when.full)}</strong> has been cancelled, and you won't receive any more reminders for it.</p>
        <p><a href="${escapeHtml(l.rebook)}">Book another time</a></p>
      `,
      ics: bookingIcs(booking, calendar, workflow, { cancelled: true }),
    };
  }
  throw new Error(`Unknown reminder kind: ${kind}`);
}

// ---------- Delivery ----------

// Why a claimed row must not be sent, or null if it's good to go.
// Re-evaluated under the booking's row lock, against its latest state.
export function skipReason(row, booking, calendar, now = new Date()) {
  if (!booking) return "booking_missing";
  if (!workflowFor(calendar)) return "workflow_disabled";
  if (row.schedule_version !== booking.scheduleVersion) return "superseded_by_reschedule";
  const msToStart = new Date(booking.startTime).getTime() - now.getTime();
  if (row.kind === "cancellation") return booking.status === "cancelled" ? null : "booking_not_cancelled";
  if (booking.status !== "confirmed") return "booking_cancelled";
  if (msToStart <= 0) return "appointment_started";
  if (row.kind === "ack_confirmed") return booking.attendanceStatus === "confirmed" ? null : "not_confirmed";
  // A reminder that runs very late (cron outage, provider retry) is
  // dropped once a later one would make it redundant, rather than
  // sending out-of-order messages.
  if (row.kind === "reminder_12h" && msToStart < 45 * MIN) return "too_late";
  if (row.kind === "reminder_30m" && msToStart < 12 * MIN) return "too_late";
  return null;
}

// Provider-confirmed rejections that are worth another attempt. A send
// whose outcome is unknown (timeout, dropped connection) is NOT
// retried — that's how duplicate messages happen.
function isRetryable(err) {
  return err && (err.status === 429 || (Number(err.status) >= 500 && Number(err.status) < 600));
}

function smsStatusCallbackUrl(base) {
  // Only when we can verify Twilio's signature on the callback.
  return base && deps.env().TWILIO_AUTH_TOKEN ? `${base}/api/booking-sms-status` : undefined;
}

async function sendOne(row, booking, msg, base) {
  if (row.channel === "email") {
    if (deps.missingEmailEnv().length) throw Object.assign(new Error("Resend not configured"), { permanent: true });
    const sent = await deps.sendEmail({ to: booking.contactEmail, subject: msg.subject, html: msg.html, ics: msg.ics });
    // Resend accepting it means queued for delivery, not delivered.
    return { providerId: sent?.id || null, providerStatus: "accepted" };
  }
  if (deps.missingTwilioEnv().length) throw Object.assign(new Error("Twilio not configured"), { permanent: true });
  const result = await deps.sendSms({
    to: toSendableNumber(booking.contactPhone),
    body: msg.text,
    statusCallback: smsStatusCallbackUrl(base),
  });
  return { providerId: result?.sid || null, providerStatus: result?.status || "queued" };
}

// Delivers one already-claimed ('processing') row.
async function deliverClaimed(row) {
  const now = new Date();
  let alert = null;
  await withTransaction(async (db) => {
    const locked = await lockBooking(db, row.booking_id);
    const reason = skipReason(row, locked?.booking, locked?.calendar, now);
    if (reason) {
      const terminal = reason === "too_late" || reason === "appointment_started" || reason === "not_confirmed" ? "skipped" : "cancelled";
      await db.query(
        "UPDATE booking_reminders SET status = $2, last_error = $3, updated_at = now() WHERE id = $1",
        [row.id, terminal, reason]
      );
      if (locked) await logEvent(db, row.booking_id, `reminder_${terminal}`, { kind: row.kind, channel: row.channel, reason });
      return;
    }
    const { booking, calendar } = locked;
    const workflow = workflowFor(calendar);
    const base = deps.baseUrl();
    if (!base) {
      await db.query(
        "UPDATE booking_reminders SET status = 'failed', last_error = 'PUBLIC_URL not configured', updated_at = now() WHERE id = $1",
        [row.id]
      );
      await logEvent(db, booking.id, "reminder_failed", { kind: row.kind, channel: row.channel, error: "no_public_url" });
      return;
    }
    const msg = renderMessage(row.kind, { booking, calendar, workflow, base });
    try {
      const { providerId, providerStatus } = await sendOne(row, booking, msg, base);
      await db.query(
        `UPDATE booking_reminders SET status = 'sent', sent_at = now(), provider_id = $2, provider_status = $3,
           last_error = NULL, updated_at = now() WHERE id = $1`,
        [row.id, providerId, providerStatus]
      );
      if (row.kind === "reminder_12h") {
        await db.query(
          `UPDATE calendar_bookings SET confirmation_requested_at = COALESCE(confirmation_requested_at, now())
           WHERE id = $1 AND schedule_version = $2`,
          [booking.id, row.schedule_version]
        );
      }
      await logEvent(db, booking.id, "reminder_sent", { kind: row.kind, channel: row.channel, providerStatus });
      if (row.kind === "confirmation" && !meetLinkFor(booking, calendar)) {
        await logEvent(db, booking.id, "meet_link_missing", {});
        alert = { calendar, booking, problem: "has no Google Meet link (none generated and no video link set on the calendar)" };
      }
    } catch (err) {
      // Provider errors can quote the recipient's number — redacted
      // before it reaches logs or the database.
      const errorText = String(err?.message || err)
        .replace(/\+?\d[\d\s()-]{6,}\d/g, "[number]")
        .slice(0, 300);
      const retry = !err?.permanent && isRetryable(err) && row.attempts < 3;
      if (retry) {
        await db.query(
          "UPDATE booking_reminders SET status = 'pending', send_at = now() + interval '2 minutes', last_error = $2, updated_at = now() WHERE id = $1",
          [row.id, errorText]
        );
      } else {
        const code = err?.code === 21610 ? "recipient_opted_out" : errorText;
        await db.query("UPDATE booking_reminders SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1", [row.id, code]);
        if (row.kind === "confirmation" || row.kind === "reminder_12h") {
          alert = { calendar, booking, problem: `couldn't be sent its ${row.kind === "confirmation" ? "booking confirmation" : "12-hour confirmation request"} by ${row.channel}` };
        }
      }
      console.error(`[patientReminders] reminder ${row.id} (${row.kind}/${row.channel}) failed${retry ? ", will retry" : ""}: ${errorText}`);
      await logEvent(db, booking.id, retry ? "reminder_retry" : "reminder_failed", { kind: row.kind, channel: row.channel, error: errorText });
    }
  });
  if (alert) await alertOwner(alert).catch((err) => console.error("[patientReminders] owner alert failed", err));
}

// Internal heads-up to the calendar owner — no patient contact details
// beyond the name the owner already sees in the CRM.
async function alertOwner({ calendar, booking, problem }) {
  if (!calendar.ownerUserId || deps.missingEmailEnv().length) return;
  const rows = await q("SELECT email FROM users WHERE id = $1", [calendar.ownerUserId]);
  if (!rows[0]?.email) return;
  await deps.sendEmail({
    to: rows[0].email,
    subject: `Action needed: ${calendar.name} booking #${booking.id}`,
    html: `<p>Booking #${booking.id} (${escapeHtml(booking.contactName)}) on <strong>${escapeHtml(calendar.name)}</strong> ${escapeHtml(problem)}. Please check it in the CRM.</p>`,
  });
}

async function claimById(id) {
  const rows = await q(
    `UPDATE booking_reminders SET status = 'processing', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND status = 'pending' AND send_at <= now() RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Sends any of these rows that are already due, right now, instead of
// waiting for the next cron tick (the booking confirmation, an ack).
// Claimed the same atomic way the cron does, so the two can't both
// send a row.
async function deliverNow(ids) {
  for (const id of ids) {
    const row = await claimById(id);
    if (row) await deliverClaimed(row).catch((err) => console.error("[patientReminders] immediate delivery failed", err));
  }
}

// Called every minute by api/automations-process-runs.js (and the local
// dev poller in server/index.js).
// Claims a few rows at a time and stops starting new batches after
// `budgetMs`, so one cron invocation never runs into the function's
// time limit with rows claimed but unsent (those would otherwise be
// failed as outcome_uncertain). Anything left is picked up next minute.
export async function processDueBookingReminders(limit = 25, { batchSize = 5, budgetMs = 9000 } = {}) {
  const startedAt = Date.now();
  // A row stuck in 'processing' means a send was in flight when the
  // function died — its outcome is unknown, so it's failed rather than
  // re-sent (a duplicate is worse than a logged gap).
  await q(
    `UPDATE booking_reminders SET status = 'failed', last_error = 'outcome_uncertain', updated_at = now()
     WHERE status = 'processing' AND updated_at < now() - interval '10 minutes'`
  );
  await healMissingSchedules().catch((err) => console.error("[patientReminders] self-heal failed", err));
  let processed = 0;
  while (processed < limit && Date.now() - startedAt < budgetMs) {
    const rows = await q(
      `UPDATE booking_reminders SET status = 'processing', attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM booking_reminders
         WHERE status = 'pending' AND send_at <= now()
         ORDER BY send_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [Math.min(batchSize, limit - processed)]
    );
    if (!rows.length) break;
    for (const row of rows) {
      await deliverClaimed(row).catch((err) => console.error(`[patientReminders] reminder ${row.id} failed`, err));
    }
    processed += rows.length;
  }
  return processed;
}

// What the "Patient reminders" settings tab shows before it can be
// switched on. Only booleans and non-secret hints — never a value.
export function workflowReadiness(calendar, env = process.env) {
  const base = patientLinkBase(env);
  return [
    { key: "sms_send", required: true, ok: !missingTwilioEnv(env).length, label: "Twilio can send SMS", fix: "Twilio account/API key and caller ID env vars (same as calling)." },
    { key: "sms_replies", required: true, ok: Boolean(env.TWILIO_AUTH_TOKEN), label: "Y/N replies can be verified", fix: "Set TWILIO_AUTH_TOKEN in Vercel (Twilio Console → Account → Auth Token)." },
    { key: "email", required: true, ok: !missingEmailEnv(env).length, label: "Resend can send email", fix: "Set RESEND_API_KEY and RESEND_FROM_EMAIL (on a domain verified in Resend) in Vercel." },
    { key: "links", required: true, ok: Boolean(base) && /^https:\/\//.test(base), label: base ? `Patient links use ${base}` : "Patient links have a public address", fix: "Set PUBLIC_URL to the CRM's production address (https://…) in Vercel." },
    { key: "meet", required: false, ok: Boolean(calendar.googleConnected || calendar.videoConferenceLink), label: calendar.googleConnected ? "Google Meet links are generated per booking" : calendar.videoConferenceLink ? "Uses this calendar's Video conference link" : "Meeting link", fix: "Connect Google (Integrate tab) to generate Meet links, or set a Video conference link." },
    { key: "inbound", required: false, ok: null, label: "Twilio sends replies to the CRM", fix: `Set every sending number's (or the Messaging Service's) incoming message webhook to POST ${base || "https://<your-domain>"}/api/sms-inbound — can't be checked from here.` },
  ];
}

// Catches a booking whose scheduling step failed after the booking
// itself was saved (DB blip mid-request). Only bookings made after the
// workflow was switched on — enabling it never messages people who
// booked before.
async function healMissingSchedules() {
  const rows = await q(
    `SELECT b.id FROM calendar_bookings b JOIN calendars c ON c.id = b.calendar_id
     WHERE c.confirmation_workflow IS NOT NULL
       AND b.status = 'confirmed' AND b.start_time > now()
       AND c.confirmation_workflow_enabled_at IS NOT NULL AND b.created_at >= c.confirmation_workflow_enabled_at
       AND b.created_at < now() - interval '2 minutes'
       AND NOT EXISTS (SELECT 1 FROM booking_reminders r WHERE r.booking_id = b.id AND r.schedule_version = b.schedule_version)
     LIMIT 20`
  );
  for (const { id } of rows) {
    await withTransaction(async (db) => {
      const locked = await lockBooking(db, id);
      if (locked && workflowFor(locked.calendar)) await scheduleForCurrentVersion(db, locked.booking);
    });
  }
}

// ---------- Lifecycle entry points ----------

// From api/calendar-book.js, once the booking row (and its Google
// event, if any) exists. Schedules every message and sends the
// confirmation immediately.
export async function onWorkflowBookingCreated(bookingId) {
  const ids = await withTransaction(async (db) => {
    const locked = await lockBooking(db, bookingId);
    if (!locked || !workflowFor(locked.calendar)) return [];
    await logEvent(db, bookingId, "booked", { startTime: locked.booking.startTime });
    return scheduleForCurrentVersion(db, locked.booking);
  });
  await deliverNow(ids);
}

// For a workflow calendar: creates the Google event with a Meet
// conference and stores the link on the booking. Never throws — a
// Google failure must not undo a real reservation (same rule as
// api/calendar-book.js); reminders then fall back to the calendar's
// own video link.
export async function createWorkflowGoogleEvent(booking, calendar) {
  if (!calendar.googleConnected) return null;
  const workflow = workflowFor(calendar);
  try {
    const accessToken = await deps.google.getValidAccessToken(calendar);
    const { id, meetLink } = await deps.google.createGoogleEventWithMeet({
      accessToken,
      calendarId: calendar.googleCalendarId,
      summary: `${workflow.callName} with ${booking.contactName}`,
      description: booking.notes || "",
      location: calendar.videoConferenceLink || undefined,
      startISO: new Date(booking.startTime).toISOString(),
      endISO: new Date(booking.endTime).toISOString(),
      timezone: calendar.timezone,
      attendeeEmail: booking.contactEmail || undefined,
      requestId: `booking-${booking.id}-${crypto.randomBytes(4).toString("hex")}`,
    });
    await q(
      `UPDATE calendar_bookings SET google_event_id = $2, meet_link = COALESCE($3, meet_link),
         google_event_connection_id = $4, google_event_calendar_id = $5
       WHERE id = $1`,
      [booking.id, id, meetLink, calendar.googleConnectionId || null, calendar.googleCalendarId]
    );
    if (!meetLink) await logEvent(getPool(), booking.id, "meet_generation_failed", { reason: "no_conference_returned" });
    return { id, meetLink };
  } catch (err) {
    console.error(`[patientReminders] Google event for booking ${booking.id} failed`, err?.message || err);
    await logEvent(getPool(), booking.id, "google_event_failed", { error: String(err?.message || err).slice(0, 200) }).catch(() => {});
    return null;
  }
}

async function removeGoogleEvent(booking, calendar) {
  // An Outlook copy of the booking (server/calendarSync.js puts it
  // there when bookings go to an Outlook account) goes too. Both are
  // removed from the account the event was put on, even if bookings
  // now go somewhere else.
  const onOutlook = booking.outlookEventId && calendarForBookingEvent(calendar, booking, "outlook");
  if (onOutlook) {
    try {
      const accessToken = await getValidOutlookAccessToken(onOutlook);
      await deleteOutlookEvent({ accessToken, eventId: booking.outlookEventId });
    } catch (err) {
      console.error(`[patientReminders] failed to delete Outlook event for booking ${booking.id}`, err?.message || err);
    }
  }
  const onGoogle = booking.googleEventId && calendarForBookingEvent(calendar, booking, "google");
  if (!onGoogle) return;
  try {
    const accessToken = await deps.google.getValidAccessToken(onGoogle);
    await deps.google.deleteGoogleEvent({ accessToken, calendarId: onGoogle.googleCalendarId, eventId: booking.googleEventId });
  } catch (err) {
    console.error(`[patientReminders] failed to delete Google event for booking ${booking.id}`, err?.message || err);
    await logEvent(getPool(), booking.id, "google_event_delete_failed", {}).catch(() => {});
  }
}

// Cancels one booking: status → cancelled with a reason, every pending
// reminder stopped, Google event removed, and (notifyPatient) a
// cancellation email/SMS with a rebooking link. Touches nothing but
// this booking and its reminders — never the contact, lead, call
// history or other bookings. Returns { booking, alreadyCancelled }.
export async function cancelWorkflowBooking(bookingId, { reason, source, notifyPatient = true }) {
  const outcome = await withTransaction(async (db) => {
    const locked = await lockBooking(db, bookingId);
    if (!locked) return null;
    if (locked.booking.status !== "confirmed") return { ...locked, alreadyCancelled: true, ids: [] };
    const { rows } = await db.query(
      `UPDATE calendar_bookings SET status = 'cancelled', cancel_reason = $2, cancelled_at = now()
       WHERE id = $1 RETURNING *`,
      [bookingId, reason]
    );
    const booking = calendarBookingFromRow(rows[0]);
    const stopped = await cancelPendingReminders(db, bookingId, "booking_cancelled");
    // Same as cancelCalendarBooking in server/db.js: stop the "Booking
    // Created" automation runs this booking started, so a cancelled
    // appointment doesn't keep getting automation reminders either.
    await db.query(
      `UPDATE automation_runs SET status = 'done', last_error = 'booking_cancelled', updated_at = now()
       WHERE status = 'pending' AND context->>'bookingId' = $1`,
      [String(bookingId)]
    );
    await logEvent(db, bookingId, "cancelled", { reason, source, remindersStopped: stopped });
    const ids = [];
    if (notifyPatient && workflowFor(locked.calendar)) {
      for (const channel of channelsFor(booking)) {
        const id = await insertReminder(db, booking, "cancellation", channel, new Date());
        if (id) ids.push(id);
      }
    }
    return { booking, calendar: locked.calendar, alreadyCancelled: false, ids };
  });
  if (!outcome) return null;
  if (!outcome.alreadyCancelled) {
    await removeGoogleEvent(outcome.booking, outcome.calendar);
    await deliverNow(outcome.ids);
  }
  return { booking: outcome.booking, alreadyCancelled: outcome.alreadyCancelled };
}

export async function confirmWorkflowAttendance(bookingId, { source }) {
  const outcome = await withTransaction(async (db) => {
    const locked = await lockBooking(db, bookingId);
    if (!locked || !workflowFor(locked.calendar)) return { result: "not_found" };
    const { booking } = locked;
    if (booking.status !== "confirmed" || new Date(booking.startTime) <= new Date()) return { result: "not_active" };
    if (booking.attendanceStatus === "confirmed") return { result: "already_confirmed" };
    await db.query(
      "UPDATE calendar_bookings SET attendance_status = 'confirmed', attendance_confirmed_at = now() WHERE id = $1",
      [bookingId]
    );
    await logEvent(db, bookingId, "attendance_confirmed", { source });
    const ids = [];
    if (booking.contactPhone) {
      const id = await insertReminder(db, booking, "ack_confirmed", "sms", new Date());
      if (id) ids.push(id);
    }
    return { result: "confirmed", ids };
  });
  if (outcome.ids) await deliverNow(outcome.ids);
  return outcome.result;
}

// ---------- Patient self-service (manage link) ----------

export async function getBookingByToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) return null;
  const rows = await q(
    `SELECT b.*, row_to_json(c.*) AS calendar_row, ${CALENDAR_CONNECTIONS_SQL} AS calendar_connections FROM calendar_bookings b
     JOIN calendars c ON c.id = b.calendar_id WHERE b.cancel_token = $1`,
    [token]
  );
  if (!rows[0]) return null;
  return {
    booking: calendarBookingFromRow(rows[0]),
    calendar: calendarFromRow({ ...rows[0].calendar_row, connections: rows[0].calendar_connections }, { includeSecrets: true }),
  };
}

// What the manage page may show: no email/phone, only what the patient
// needs to recognise their own appointment.
export function publicBookingView(booking, calendar) {
  const workflow = workflowFor(calendar);
  return {
    calendarName: workflow ? workflow.callName : calendar.name,
    slug: calendar.slug,
    firstName: firstName(booking.contactName),
    startTime: booking.startTime,
    endTime: booking.endTime,
    timezone: booking.bookerTimezone || calendar.timezone,
    status: booking.status,
    attendanceStatus: booking.attendanceStatus,
    meetLink: booking.status === "confirmed" ? meetLinkFor(booking, calendar) : null,
    canChange: booking.status === "confirmed" && new Date(booking.startTime) > new Date(),
    // false → cancel-only view (no confirm / reschedule / add to calendar)
    workflow: Boolean(workflow),
  };
}

export class BookingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Moves a booking to a new slot: same row, schedule_version + 1, so
// there is only ever one active appointment for it. Every pending
// reminder for the old time is cancelled and a fresh set (confirmation,
// 12h, 30m, 10m) is scheduled against the new start time; attendance
// confirmation resets because the patient hasn't confirmed the new time.
export async function rescheduleWorkflowBooking({ token, startUTC, endUTC, timezone }) {
  const found = await getBookingByToken(token);
  if (!found || !workflowFor(found.calendar)) throw new BookingError(404, "Booking not found");
  const { booking, calendar } = found;
  if (booking.status !== "confirmed" || new Date(booking.startTime) <= new Date()) {
    throw new BookingError(409, "This appointment can no longer be changed.");
  }
  if (!startUTC || !endUTC || Number.isNaN(Date.parse(startUTC)) || Number.isNaN(Date.parse(endUTC))) {
    throw new BookingError(400, "Missing new time");
  }

  // Same availability check as a fresh booking, minus this booking's
  // own current slot.
  const dateStr = localDateStrInZone(startUTC, calendar.timezone);
  const prev = new Date(`${dateStr}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(`${dateStr}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const fromISO = `${prev.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const toISO = `${next.toISOString().slice(0, 10)}T23:59:59.999Z`;
  const ownStart = new Date(booking.startTime).getTime();
  const ownEnd = new Date(booking.endTime).getTime();
  let googleBusy = [];
  if (calendar.googleConnected) {
    try {
      const accessToken = await deps.google.getValidAccessToken(calendar);
      googleBusy = (await deps.google.getFreeBusy({ accessToken, calendarId: calendar.googleCalendarId, timeMinISO: fromISO, timeMaxISO: toISO }))
        // This booking's own event shouldn't block its own reschedule.
        .filter((b) => !(new Date(b.start).getTime() === ownStart && new Date(b.end).getTime() === ownEnd));
    } catch (err) {
      console.error("[patientReminders] freebusy lookup failed", err?.message || err);
    }
  }
  const existing = (
    await q(
      `SELECT * FROM calendar_bookings WHERE calendar_id = $1 AND status = 'confirmed' AND start_time < $3 AND end_time > $2 AND id <> $4`,
      [calendar.id, fromISO, toISO, booking.id]
    )
  ).map(calendarBookingFromRow);
  const slots = computeAvailableSlots({ calendar, fromDate: dateStr, toDate: dateStr, googleBusy, existingBookings: existing });
  if (!slots.some((s) => s.startUTC === startUTC && s.endUTC === endUTC)) {
    throw new BookingError(409, "That time isn't available any more — please pick another slot.");
  }

  let result;
  try {
    result = await withTransaction(async (db) => {
      const locked = await lockBooking(db, booking.id);
      // Changed under us (cancelled by an N reply, or another reschedule).
      if (!locked || locked.booking.status !== "confirmed" || locked.booking.scheduleVersion !== booking.scheduleVersion) {
        throw new BookingError(409, "This appointment changed while you were rescheduling — please reload.");
      }
      const { rows } = await db.query(
        `UPDATE calendar_bookings SET
           start_time = $2, end_time = $3, booker_timezone = COALESCE($4, booker_timezone),
           schedule_version = schedule_version + 1, reschedule_count = reschedule_count + 1, rescheduled_at = now(),
           attendance_status = NULL, attendance_confirmed_at = NULL, confirmation_requested_at = NULL
         WHERE id = $1 RETURNING *`,
        [booking.id, startUTC, endUTC, timezone || null]
      );
      const updated = calendarBookingFromRow(rows[0]);
      const stopped = await cancelPendingReminders(db, booking.id, "superseded_by_reschedule");
      await logEvent(db, booking.id, "rescheduled", {
        from: booking.startTime,
        to: updated.startTime,
        version: updated.scheduleVersion,
        remindersStopped: stopped,
      });
      const ids = await scheduleForCurrentVersion(db, updated);
      return { updated, ids };
    });
  } catch (err) {
    if (String(err.message || "").includes("calendar_bookings_no_double_book")) {
      throw new BookingError(409, "That time was just booked — please pick another slot.");
    }
    throw err;
  }

  // Move the Google event (its Meet link carries over); create one if
  // the original never got one.
  const onGoogle = result.updated.googleEventId && calendarForBookingEvent(calendar, result.updated, "google");
  if (onGoogle || (calendar.googleConnected && !result.updated.outlookEventId)) {
    if (onGoogle) {
      try {
        const accessToken = await deps.google.getValidAccessToken(onGoogle);
        await deps.google.patchGoogleEventTimes({
          accessToken,
          calendarId: onGoogle.googleCalendarId,
          eventId: result.updated.googleEventId,
          startISO: startUTC,
          endISO: endUTC,
          timezone: calendar.timezone,
        });
      } catch (err) {
        console.error(`[patientReminders] failed to move Google event for booking ${booking.id}`, err?.message || err);
        await logEvent(getPool(), booking.id, "google_event_update_failed", {}).catch(() => {});
      }
    } else {
      await createWorkflowGoogleEvent(result.updated, calendar);
    }
  }
  await deliverNow(result.ids);
  const fresh = await getBookingByToken(token);
  return publicBookingView(fresh.booking, fresh.calendar);
}

// ---------- Inbound SMS (Y / N replies) ----------

export function parseReplyIntent(body) {
  const word = String(body || "").trim().toLowerCase().replace(/[.!\s]+$/g, "");
  if (["y", "yes", "yep", "yeah"].includes(word)) return "confirm";
  if (["n", "no", "nope"].includes(word)) return "cancel";
  return null;
}

// Twilio signs each webhook with the account's Auth Token; anything
// that doesn't verify is ignored. The signed URL is whatever is pasted
// into the Twilio Console, which may be the request's own host or
// PUBLIC_URL — either is accepted.
export function verifyTwilioSignature({ signature, urls, params }) {
  const authToken = deps.env().TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;
  return urls.filter(Boolean).some((url) => twilio.validateRequest(authToken, signature, url, params || {}));
}

export function candidateWebhookUrls(req, path) {
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const fromReq = host ? `${proto}://${host}${req.originalUrl || req.url || path}` : null;
  const base = deps.baseUrl();
  return [fromReq, base ? `${base}${path}` : null];
}

// Returns a short outcome string (for tests/logs). Only acts when the
// reply is exactly Y or N, the webhook verifies, this MessageSid hasn't
// been processed, and the sender's number matches exactly one booking
// that is active, in the future, and was sent a confirmation request
// for its current time. Anything else leaves every booking untouched —
// the existing inbox logging in api/sms-inbound.js still runs either way.
export async function handleBookingReply({ messageSid, from, body, verified }) {
  const intent = parseReplyIntent(body);
  if (!intent) return "not_a_reply";
  if (!verified) return "unverified";
  if (!messageSid || !from) return "invalid";
  const digits = phoneDigits(from);
  if (digits.length < 8) return "invalid";

  const fresh = await q(
    "INSERT INTO booking_sms_replies (message_sid, intent) VALUES ($1,$2) ON CONFLICT (message_sid) DO NOTHING RETURNING message_sid",
    [messageSid, intent]
  );
  if (!fresh.length) return "duplicate";

  const matches = await q(
    `SELECT b.id FROM calendar_bookings b JOIN calendars c ON c.id = b.calendar_id
     WHERE c.confirmation_workflow IS NOT NULL
       AND b.status = 'confirmed' AND b.start_time > now()
       AND b.confirmation_requested_at IS NOT NULL
       AND ${PHONE_DIGITS_SQL} = $1
     ORDER BY b.start_time ASC`,
    [digits]
  );
  const record = (bookingId, outcome) =>
    q("UPDATE booking_sms_replies SET booking_id = $2, outcome = $3 WHERE message_sid = $1", [messageSid, bookingId, outcome]);

  if (matches.length === 0) {
    await record(null, "no_matching_appointment");
    return "no_match";
  }
  if (matches.length > 1) {
    // Never guess between two appointments.
    await record(null, "ambiguous");
    if (!deps.missingTwilioEnv().length) {
      await deps
        .sendSms({ to: from, body: "We couldn't tell which appointment your reply was for. Please use the confirm or cancel links in your appointment messages." })
        .catch((err) => console.error("[patientReminders] ambiguous-reply SMS failed", err?.message || err));
    }
    return "ambiguous";
  }
  const bookingId = matches[0].id;
  await logEvent(getPool(), bookingId, "sms_reply_received", { intent });
  if (intent === "confirm") {
    const result = await confirmWorkflowAttendance(bookingId, { source: "sms_reply" });
    await record(bookingId, result);
    return result;
  }
  const cancelled = await cancelWorkflowBooking(bookingId, { reason: "patient_unable_to_attend", source: "sms_reply" });
  const outcome = !cancelled ? "not_found" : cancelled.alreadyCancelled ? "already_cancelled" : "cancelled";
  await record(bookingId, outcome);
  return outcome;
}

// Twilio delivery status callback for reminder SMS. Never moves a row
// backwards (a late "sent" can't overwrite "delivered").
const PROVIDER_RANK = { accepted: 0, queued: 1, sending: 2, sent: 3, delivered: 4, undelivered: 5, failed: 5 };
export async function handleSmsStatusCallback({ messageSid, status, errorCode }) {
  if (!messageSid || !(status in PROVIDER_RANK)) return "ignored";
  const rows = await q("SELECT id, booking_id, provider_status FROM booking_reminders WHERE provider_id = $1 AND channel = 'sms'", [messageSid]);
  if (!rows[0]) return "unknown";
  const current = PROVIDER_RANK[rows[0].provider_status] ?? -1;
  if (PROVIDER_RANK[status] <= current) return "stale";
  const failed = status === "failed" || status === "undelivered";
  await q(
    `UPDATE booking_reminders SET provider_status = $2,
       status = CASE WHEN $3 THEN 'failed' ELSE status END,
       last_error = CASE WHEN $3 THEN $4 ELSE last_error END, updated_at = now()
     WHERE id = $1`,
    [rows[0].id, status, failed, errorCode ? `twilio_error_${errorCode}` : failed ? status : null]
  );
  if (failed) await logEvent(getPool(), rows[0].booking_id, "reminder_undelivered", { status, errorCode: errorCode || null });
  return "updated";
}

// For the CRM's booking list — the audit trail of one booking.
export async function getBookingTimeline(bookingId) {
  const [events, reminders] = await Promise.all([
    q("SELECT type, detail, created_at FROM booking_events WHERE booking_id = $1 ORDER BY id ASC", [bookingId]),
    q(
      `SELECT kind, channel, schedule_version, send_at, status, provider_status, last_error, sent_at
       FROM booking_reminders WHERE booking_id = $1 ORDER BY send_at ASC, id ASC`,
      [bookingId]
    ),
  ]);
  return { events, reminders };
}
