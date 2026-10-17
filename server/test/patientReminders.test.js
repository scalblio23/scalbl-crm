// Integration tests for the patient confirmation & reminder workflow
// (server/patientReminders.js) against a real Postgres database, with
// Twilio / SendGrid / Google replaced by in-memory fakes — nothing is
// ever sent to a real person. Run with:
//   TEST_POSTGRES_URL=postgres://... npm run test:reminders
// Skipped entirely when TEST_POSTGRES_URL isn't set. Point it at a
// throwaway database: the schema is created and test rows are written.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";

const DB_URL = process.env.TEST_POSTGRES_URL;
process.env.SESSION_SECRET ||= "test-session-secret";
const skip = !DB_URL && "TEST_POSTGRES_URL not set";

let db, pr, handlers, pool;
const sent = { sms: [], email: [] };
let smsBehavior = null; // (msg) => result | throws
const AUTH_TOKEN = "test-auth-token";
const BASE = "https://crm.example.test";
const RUN = Date.now().toString(36);
const sidFor = (name) => `${name}_${RUN}`;

function res() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  };
}
async function call(handler, req) {
  const r = res();
  await handler({ headers: {}, query: {}, ...req }, r);
  return r;
}
const sql = async (text, params) => (await pool.query(text, params)).rows;

before(async () => {
  if (skip) return;
  process.env.POSTGRES_URL = DB_URL.includes("sslmode") ? DB_URL : `${DB_URL}${DB_URL.includes("?") ? "&" : "?"}sslmode=disable`;
  delete process.env.SENDGRID_API_KEY; // owner-notification path in calendar-book stays off
  db = await import("../db.js");
  pr = await import("../patientReminders.js");
  handlers = {
    book: (await import("../../api/calendar-book.js")).default,
    slots: (await import("../../api/calendar-slots.js")).default,
    manage: (await import("../../api/calendar-manage.js")).default,
    cancel: (await import("../../api/calendar-cancel.js")).default,
    inbound: (await import("../../api/sms-inbound.js")).default,
    status: (await import("../../api/booking-sms-status.js")).default,
    calendars: (await import("../../api/calendars.js")).default,
    bookings: (await import("../../api/calendar-bookings.js")).default,
  };
  await db.ensureSchema();
  pool = db.getPool();
  pr.__setDepsForTests({
    sendSms: async (msg) => {
      if (smsBehavior) return smsBehavior(msg);
      sent.sms.push(msg);
      return { sid: `SM${sent.sms.length}${Date.now()}`, status: "queued" };
    },
    sendEmail: async (msg) => { sent.email.push(msg); },
    missingEmailEnv: () => [],
    missingTwilioEnv: () => [],
    baseUrl: () => BASE,
    env: () => ({ TWILIO_AUTH_TOKEN: AUTH_TOKEN }),
  });
});

after(async () => {
  if (skip) return;
  pr.__setDepsForTests(null);
  await pool.end();
});

beforeEach(() => {
  sent.sms.length = 0;
  sent.email.length = 0;
  smsBehavior = null;
});

const ALL_DAY = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "23:59" }]]));

async function makeCalendar({ workflow = true, name = "Keevo Discovery" } = {}) {
  const cal = await db.createCalendar({ name, ownerUserId: null });
  return db.updateCalendar(cal.id, {
    timezone: "Australia/Sydney",
    minNoticeHours: 0,
    availability: ALL_DAY,
    ...(workflow ? { confirmationWorkflow: "keevo_health" } : {}),
  });
}

// A real bookable slot starting as close as possible to `hoursAhead`.
async function slotAt(calendar, hoursAhead) {
  const target = Date.now() + hoursAhead * 3600000;
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const r = await call(handlers.slots, { method: "GET", query: { slug: calendar.slug, from: day(target - 86400000), to: day(target + 86400000) } });
  const slots = r.body.slots;
  slots.sort((a, b) => Math.abs(Date.parse(a.startUTC) - target) - Math.abs(Date.parse(b.startUTC) - target));
  return slots[0];
}

let phoneSeq = 0;
function newPhone() {
  phoneSeq += 1;
  return `04${String(Date.now()).slice(-6)}${String(phoneSeq).padStart(2, "0")}`.slice(0, 10);
}

async function book(calendar, hoursAhead, { phone = newPhone(), email = `patient+${phoneSeq}.${RUN}@example.test`, name = "Pat Test" } = {}) {
  const slot = await slotAt(calendar, hoursAhead);
  const r = await call(handlers.book, {
    method: "POST",
    body: { slug: calendar.slug, startUTC: slot.startUTC, endUTC: slot.endUTC, name, email, phone, timezone: "Australia/Sydney" },
  });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const [row] = await sql("SELECT * FROM calendar_bookings WHERE id = $1", [r.body.booking.id]);
  return { id: row.id, token: row.cancel_token, phone, email, slot };
}

// Messages sent to one booking's recipient — the cron is global, so
// other bookings (including ones left from earlier runs) may send too.
const to = (b) => ({
  sms: sent.sms.filter((m) => m.to === pr.toSendableNumber(b.phone)),
  email: sent.email.filter((m) => m.to === b.email),
});
const reminders = (bookingId) =>
  sql("SELECT * FROM booking_reminders WHERE booking_id = $1 ORDER BY schedule_version, send_at, kind, channel", [bookingId]);
const bookingRow = async (id) => (await sql("SELECT * FROM calendar_bookings WHERE id = $1", [id]))[0];

// "Fast-forward" a reminder kind: make it due now, then run the cron.
async function fireDue(bookingId, kind) {
  await sql("UPDATE booking_reminders SET send_at = now() - interval '1 second' WHERE booking_id = $1 AND kind = $2 AND status = 'pending'", [bookingId, kind]);
  return pr.processDueBookingReminders(100);
}

function signedInbound({ from, body, sid }) {
  const url = `${BASE}/api/sms-inbound`;
  const params = { From: `+61${from.replace(/^0/, "")}`, Body: body, MessageSid: sid };
  const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);
  return { method: "POST", body: params, headers: { "x-twilio-signature": signature, host: "crm.example.test", "x-forwarded-proto": "https" }, url: "/api/sms-inbound" };
}
async function reply(phone, body, sid = `SMIN${Math.random().toString(16).slice(2)}`) {
  const req = signedInbound({ from: phone, body, sid });
  return pr.handleBookingReply({
    messageSid: sid,
    from: req.body.From,
    body,
    verified: pr.verifyTwilioSignature({ signature: req.headers["x-twilio-signature"], urls: pr.candidateWebhookUrls(req, "/api/sms-inbound"), params: req.body }),
  });
}

// ---------- pure scheduling rules ----------

test("planReminderTimes: normal booking gets confirmation + 12h/30m/10m at exact offsets", { skip }, () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const start = "2026-10-22T03:00:00Z";
  const plan = Object.fromEntries(pr.planReminderTimes(start, now).map((p) => [p.kind, p.sendAt.toISOString()]));
  assert.equal(plan.confirmation, now.toISOString());
  assert.equal(plan.reminder_12h, "2026-10-21T15:00:00.000Z");
  assert.equal(plan.reminder_30m, "2026-10-22T02:30:00.000Z");
  assert.equal(plan.reminder_10m, "2026-10-22T02:50:00.000Z");
});

test("planReminderTimes: inside 12h → Y/N request a minute after confirmation, never in the past", { skip }, () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const plan = pr.planReminderTimes("2026-10-20T05:00:00Z", now);
  const r12 = plan.find((p) => p.kind === "reminder_12h");
  assert.equal(r12.sendAt.toISOString(), "2026-10-20T00:01:00.000Z");
  for (const p of plan) assert.ok(p.sendAt >= now);
  assert.ok(plan.find((p) => p.kind === "reminder_30m"));
  assert.ok(plan.find((p) => p.kind === "reminder_10m"));
});

test("planReminderTimes: under an hour → no Y/N request; 30m/10m kept while still ahead", { skip }, () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const kinds = (start) => pr.planReminderTimes(start, now).map((p) => p.kind);
  assert.deepEqual(kinds("2026-10-20T00:40:00Z"), ["confirmation", "reminder_30m", "reminder_10m"]);
  assert.deepEqual(kinds("2026-10-20T00:20:00Z"), ["confirmation", "reminder_10m"]);
  assert.deepEqual(kinds("2026-10-20T00:05:00Z"), ["confirmation"]);
});

test("planReminderTimes: 12h offset is absolute time across a DST change (Sydney, 5 Apr 2026)", { skip }, () => {
  // DST ends 03:00 AEDT → 02:00 AEST on 5 Apr 2026. A 10:00 AEST call is 00:00Z.
  const now = new Date("2026-04-01T00:00:00Z");
  const r12 = pr.planReminderTimes("2026-04-05T00:00:00Z", now).find((p) => p.kind === "reminder_12h");
  assert.equal(r12.sendAt.toISOString(), "2026-04-04T12:00:00.000Z");
});

test("parseReplyIntent only accepts clear Y / N", { skip }, () => {
  for (const y of ["Y", "y", " yes ", "Yes!", "YES."]) assert.equal(pr.parseReplyIntent(y), "confirm");
  for (const n of ["N", "no", "No."]) assert.equal(pr.parseReplyIntent(n), "cancel");
  for (const other of ["", "maybe", "y n", "Yes but late", "nah?", "STOP"]) assert.equal(pr.parseReplyIntent(other), null);
});

// ---------- 1, 2: booking confirmation ----------

test("1/2: booking sends confirmation email + SMS with time, Meet link, invite, reschedule/cancel links and the Y/N rule", { skip }, async () => {
  const cal = await makeCalendar();
  await db.updateCalendar(cal.id, { videoConferenceLink: "https://meet.google.com/abc-defg-hij" });
  const b = await book(cal, 48);

  assert.equal(to(b).sms.length, 1);
  assert.equal(to(b).email.length, 1);
  const sms = to(b).sms[0].body;
  const email = to(b).email[0];
  for (const text of [sms, email.html]) {
    assert.match(text, /Keevo Health discovery call/);
    assert.match(text, /meet\.google\.com\/abc-defg-hij/);
    assert.ok(text.includes(`#manage=${b.token}&amp;action=reschedule`) || text.includes(`#manage=${b.token}&action=reschedule`));
    assert.ok(text.includes(`#manage=${b.token}&amp;action=cancel`) || text.includes(`#manage=${b.token}&action=cancel`));
    assert.match(text, /AEDT|AEST/); // local timezone shown
  }
  assert.ok(sms.includes(pr.CONFIRMATION_RULE_TEXT));
  assert.ok(email.html.includes(pr.CONFIRMATION_RULE_TEXT.replace(/'/g, "&#39;")));
  // calendar invite for THIS booking
  assert.match(email.ics, new RegExp(`UID:booking-${b.id}@scalbl-crm`));
  assert.match(email.ics, /METHOD:PUBLISH/);
  assert.match(email.ics, /LOCATION:https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.equal(to(b).sms[0].to, `+61${b.phone.slice(1)}`); // sent in E.164
  // no token in any query string
  assert.ok(!/\?token=/.test(sms + email.html));

  const rows = await reminders(b.id);
  assert.deepEqual(
    rows.filter((r) => r.kind === "confirmation").map((r) => r.status),
    ["sent", "sent"]
  );
});

test("1b: Google-connected calendar gets a generated Meet link stored on the booking", { skip }, async () => {
  const cal = await makeCalendar();
  const calendar = { ...(await db.getCalendarById(cal.id, { includeSecrets: true })), googleConnected: true };
  const booking = { id: (await book(cal, 30)).id, contactName: "Pat", startTime: new Date(Date.now() + 30 * 3600000).toISOString(), endTime: new Date(Date.now() + 30.5 * 3600000).toISOString() };
  pr.__setDepsForTests({
    sendSms: async (m) => { sent.sms.push(m); return { sid: "SMx", status: "queued" }; },
    sendEmail: async (m) => { sent.email.push(m); },
    missingEmailEnv: () => [], missingTwilioEnv: () => [], baseUrl: () => BASE, env: () => ({ TWILIO_AUTH_TOKEN: AUTH_TOKEN }),
    google: {
      getValidAccessToken: async () => "tok",
      createGoogleEventWithMeet: async (args) => { assert.match(args.requestId, /^booking-/); return { id: "evt1", meetLink: "https://meet.google.com/gen-erat-ed" }; },
    },
  });
  try {
    const result = await pr.createWorkflowGoogleEvent(booking, calendar);
    assert.equal(result.meetLink, "https://meet.google.com/gen-erat-ed");
    const row = await bookingRow(booking.id);
    assert.equal(row.meet_link, "https://meet.google.com/gen-erat-ed");
    assert.equal(row.google_event_id, "evt1");
  } finally {
    pr.__setDepsForTests({
      sendSms: async (msg) => { if (smsBehavior) return smsBehavior(msg); sent.sms.push(msg); return { sid: `SM${sent.sms.length}${Date.now()}`, status: "queued" }; },
      sendEmail: async (msg) => { sent.email.push(msg); },
      missingEmailEnv: () => [], missingTwilioEnv: () => [], baseUrl: () => BASE, env: () => ({ TWILIO_AUTH_TOKEN: AUTH_TOKEN }),
    });
  }
});

// ---------- 3, 4, 5: 12h request, Y reply ----------

test("3/4/5: 12h request is scheduled at start-12h on both channels; Y confirms and sends the ack", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  const start = Date.parse((await bookingRow(b.id)).start_time);
  const r12 = (await reminders(b.id)).filter((r) => r.kind === "reminder_12h");
  assert.deepEqual(r12.map((r) => r.channel).sort(), ["email", "sms"]);
  for (const r of r12) assert.equal(Date.parse(r.send_at), start - 12 * 3600000);

  sent.sms.length = 0;
  await fireDue(b.id, "reminder_12h");
  assert.equal(to(b).sms.length, 1);
  assert.match(to(b).sms[0].body, /^Your Keevo Health discovery call is at .+\. Reply Y to confirm or N if you can't attend\.$/);
  assert.match(to(b).email.at(-1).html, /Reply <strong>Y<\/strong>/);
  assert.ok((await bookingRow(b.id)).confirmation_requested_at);

  sent.sms.length = 0;
  assert.equal(await reply(b.phone, "Y"), "confirmed");
  const row = await bookingRow(b.id);
  assert.equal(row.attendance_status, "confirmed");
  assert.equal(row.status, "confirmed"); // booked state untouched
  assert.equal(to(b).sms.length, 1);
  assert.equal(to(b).sms[0].body, "Thanks for confirming. We look forward to speaking with you.");
  // 30m / 10m still pending
  const pending = (await reminders(b.id)).filter((r) => r.status === "pending").map((r) => r.kind);
  assert.ok(pending.includes("reminder_30m") && pending.includes("reminder_10m"));
});

// ---------- 6: N reply ----------

test("6: N cancels only that booking, stops every reminder, sends cancellation with rebook link", { skip }, async () => {
  const cal = await makeCalendar();
  const phone = newPhone();
  await sql("INSERT INTO contacts (name, phone, status, tag) VALUES ('Pat Test', $1, 'New Lead', 'keevo-test')", [phone]);
  const b = await book(cal, 50, { phone });
  const other = await book(cal, 120, { phone }); // another appointment, not yet asked
  await fireDue(b.id, "reminder_12h");
  sent.sms.length = 0;
  sent.email.length = 0;

  assert.equal(await reply(phone, "n"), "cancelled");
  const row = await bookingRow(b.id);
  assert.equal(row.status, "cancelled");
  assert.equal(row.cancel_reason, "patient_unable_to_attend");
  assert.ok(row.cancelled_at);
  assert.deepEqual(
    [...new Set((await reminders(b.id)).filter((r) => r.kind.startsWith("reminder_") && r.status !== "sent").map((r) => r.status))],
    ["cancelled"]
  );
  assert.equal(to(b).sms.length, 1);
  assert.match(to(b).sms[0].body, /has been cancelled/);
  assert.ok(to(b).sms[0].body.includes(`${BASE}/book/${cal.slug}`));
  assert.match(to(b).email[0].ics, /METHOD:CANCEL/);

  // Everything else untouched.
  assert.equal((await bookingRow(other.id)).status, "confirmed");
  const [contact] = await sql("SELECT * FROM contacts WHERE phone = $1", [phone]);
  assert.ok(contact, "contact still exists");
  assert.equal(contact.status, "Booked"); // set by the booking, not reverted

  // Further reminders for the cancelled booking never send.
  await sql("UPDATE booking_reminders SET send_at = now() - interval '1 second' WHERE booking_id = $1", [b.id]);
  sent.sms.length = 0;
  sent.email.length = 0;
  await pr.processDueBookingReminders(100);
  assert.equal(to(b).sms.length + to(b).email.length, 0);

  // A late second reply can't touch any other booking.
  assert.equal(await reply(phone, "N"), "no_match");
  assert.equal((await bookingRow(other.id)).status, "confirmed");
});

// ---------- 7: no reply ----------

test("7: no reply leaves the booking booked and later reminders still send", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await fireDue(b.id, "reminder_12h");
  sent.sms.length = 0;
  await fireDue(b.id, "reminder_30m");
  const row = await bookingRow(b.id);
  assert.equal(row.status, "confirmed");
  assert.equal(row.attendance_status, null);
  assert.equal(to(b).sms.length, 1);
});

// ---------- 8, 9: 30m and 10m ----------

test("8/9: 30m and 10m reminders carry time + Meet link, once each", { skip }, async () => {
  const cal = await makeCalendar();
  await db.updateCalendar(cal.id, { videoConferenceLink: "https://meet.google.com/xyz-abcd-efg" });
  const b = await book(cal, 50);
  sent.sms.length = 0;
  sent.email.length = 0;
  await fireDue(b.id, "reminder_30m");
  assert.match(to(b).sms[0].body, /starts in 30 minutes, at .+(AEDT|AEST)/);
  assert.match(to(b).sms[0].body, /meet\.google\.com\/xyz-abcd-efg/);
  assert.match(to(b).email[0].html, /Join the call/);
  await fireDue(b.id, "reminder_10m");
  assert.match(to(b).sms[1].body, /starts in 10 minutes .+Please join now/);
  assert.match(to(b).sms[1].body, /meet\.google\.com\/xyz-abcd-efg/);
  // A second cron pass sends nothing more.
  await pr.processDueBookingReminders(100);
  await pr.processDueBookingReminders(100);
  assert.equal(to(b).sms.length, 2);
  assert.equal(to(b).email.length, 2);
});

// ---------- 10, 11, 16: reschedule ----------

test("10/11: reschedule invalidates old reminders, sends fresh confirmation, schedules new cycle, Y works for new time", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await fireDue(b.id, "reminder_12h"); // old cycle already asked
  const newSlot = await slotAt(cal, 80);
  sent.sms.length = 0;
  sent.email.length = 0;
  const r = await call(handlers.manage, { method: "POST", body: { token: b.token, action: "reschedule", startUTC: newSlot.startUTC, endUTC: newSlot.endUTC, timezone: "Australia/Sydney" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(new Date(r.body.startTime).toISOString(), newSlot.startUTC);

  const row = await bookingRow(b.id);
  assert.equal(row.schedule_version, 2);
  assert.equal(row.reschedule_count, 1);
  assert.equal(row.confirmation_requested_at, null);
  const all = await reminders(b.id);
  assert.ok(all.filter((x) => x.schedule_version === 1).every((x) => x.status !== "pending"));
  const v2 = all.filter((x) => x.schedule_version === 2);
  const start = Date.parse(newSlot.startUTC);
  assert.equal(Date.parse(v2.find((x) => x.kind === "reminder_12h").send_at), start - 12 * 3600000);
  assert.equal(Date.parse(v2.find((x) => x.kind === "reminder_10m").send_at), start - 10 * 60000);
  // fresh confirmation, flagged as a move, with an updated invite (same UID, higher sequence)
  assert.match(to(b).sms[0].body, /has been moved to/);
  assert.match(to(b).email[0].ics, new RegExp(`UID:booking-${b.id}@scalbl-crm`));
  assert.match(to(b).email[0].ics, /SEQUENCE:2/);

  // A Y to the OLD request (before the new one goes out) does nothing.
  assert.equal(await reply(b.phone, "Y"), "no_match");
  // An old-version reminder forced due is refused at send time.
  await sql("UPDATE booking_reminders SET status = 'pending', send_at = now() - interval '1 second' WHERE booking_id = $1 AND schedule_version = 1 AND kind = 'reminder_30m'", [b.id]);
  sent.sms.length = 0;
  sent.email.length = 0;
  await pr.processDueBookingReminders(100);
  assert.equal(to(b).sms.length + to(b).email.length, 0);
  assert.equal((await reminders(b.id)).find((x) => x.schedule_version === 1 && x.kind === "reminder_30m" && x.channel === "sms").last_error, "superseded_by_reschedule");

  // New cycle: request then Y confirms the rescheduled booking.
  await fireDue(b.id, "reminder_12h");
  assert.equal(await reply(b.phone, "Y"), "confirmed");
  assert.equal((await bookingRow(b.id)).attendance_status, "confirmed");
  // Only one active booking row for this appointment.
  assert.equal((await sql("SELECT count(*)::int AS n FROM calendar_bookings WHERE cancel_token = $1", [b.token]))[0].n, 1);
});

test("16: rescheduled to <12h away → Y/N request a minute later, nothing scheduled in the past", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  const soon = await slotAt(cal, 5);
  const r = await call(handlers.manage, { method: "POST", body: { token: b.token, action: "reschedule", startUTC: soon.startUTC, endUTC: soon.endUTC } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const v2 = (await reminders(b.id)).filter((x) => x.schedule_version === 2);
  const now = Date.now();
  const r12 = v2.find((x) => x.kind === "reminder_12h");
  assert.ok(Date.parse(r12.send_at) > now - 5000 && Date.parse(r12.send_at) <= now + 61000);
  for (const x of v2.filter((x) => x.kind !== "confirmation")) assert.ok(Date.parse(x.send_at) >= now - 5000);
  assert.ok(v2.some((x) => x.kind === "reminder_30m") && v2.some((x) => x.kind === "reminder_10m"));
});

test("reschedule to a taken slot is refused and changes nothing", { skip }, async () => {
  const cal = await makeCalendar();
  const a = await book(cal, 60);
  const b = await book(cal, 70);
  const taken = await bookingRow(a.id);
  const r = await call(handlers.manage, {
    method: "POST",
    body: { token: b.token, action: "reschedule", startUTC: new Date(taken.start_time).toISOString(), endUTC: new Date(taken.end_time).toISOString() },
  });
  assert.equal(r.statusCode, 409);
  assert.equal((await bookingRow(b.id)).schedule_version, 1);
});

// ---------- 12: cancel link ----------

test("12: cancel via manage page stops reminders and confirms; GET on a legacy cancel link never cancels", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  const get = await call(handlers.cancel, { method: "GET", query: { token: b.token } });
  assert.equal(get.statusCode, 302);
  assert.match(get.headers.location, new RegExp(`#manage=${b.token}&action=cancel$`));
  assert.equal((await bookingRow(b.id)).status, "confirmed");

  sent.sms.length = 0;
  const r = await call(handlers.manage, { method: "POST", body: { token: b.token, action: "cancel" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.status, "cancelled");
  assert.equal(r.body.canChange, false);
  const row = await bookingRow(b.id);
  assert.equal(row.cancel_reason, "cancelled_by_patient");
  assert.equal((await reminders(b.id)).filter((x) => x.status === "pending").length, 0);
  assert.match(to(b).sms[0].body, /has been cancelled/);
  // second cancel is a no-op, no second message
  await call(handlers.manage, { method: "POST", body: { token: b.token, action: "cancel" } });
  assert.equal(to(b).sms.length, 1);
});

test("manage page: bad token → 404; view exposes no email/phone", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  assert.equal((await call(handlers.manage, { method: "POST", body: { token: "0".repeat(32), action: "view" } })).statusCode, 404);
  assert.equal((await call(handlers.manage, { method: "POST", body: { token: "'; drop table x;--", action: "view" } })).statusCode, 404);
  const v = await call(handlers.manage, { method: "POST", body: { token: b.token, action: "view" } });
  const text = JSON.stringify(v.body);
  assert.ok(!text.includes(b.email) && !text.includes(b.phone));
  assert.equal(v.body.firstName, "Pat");
});

// ---------- 13: duplicate webhook ----------

test("13: the same Twilio MessageSid delivered twice acts once", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await fireDue(b.id, "reminder_12h");
  sent.sms.length = 0;
  assert.equal(await reply(b.phone, "Y", sidFor("SMdup1")), "confirmed");
  assert.equal(await reply(b.phone, "Y", sidFor("SMdup1")), "duplicate");
  assert.equal(to(b).sms.length, 1);
  // A genuinely new second Y is a no-op too (already confirmed → no second ack).
  assert.equal(await reply(b.phone, "Y", sidFor("SMdup2")), "already_confirmed");
  assert.equal(to(b).sms.length, 1);
});

test("13b: real /api/sms-inbound handler — signed Y confirms; unsigned/forged Y does nothing", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await fireDue(b.id, "reminder_12h");
  const forged = signedInbound({ from: b.phone, body: "N", sid: sidFor("SMforged") });
  forged.headers["x-twilio-signature"] = "bm9wZQ==";
  await call(handlers.inbound, forged);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await bookingRow(b.id)).status, "confirmed");

  await call(handlers.inbound, signedInbound({ from: b.phone, body: "Y", sid: sidFor("SMreal1") }));
  for (let i = 0; i < 40 && !(await bookingRow(b.id)).attendance_status; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await bookingRow(b.id)).attendance_status, "confirmed");
  // the inbound text was still logged to the inbox, as before
  const [m] = await sql("SELECT * FROM messages WHERE text = 'Y' ORDER BY id DESC LIMIT 1");
  assert.ok(m);
});

// ---------- 14: cancelled appointments never get reminders, even mid-race ----------

test("14: a booking cancelled outside the workflow (race) is re-checked at send time", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  // Cancelled by a path that didn't stop the queue — simulates the
  // reminder having been claimed just before the cancel landed.
  await sql("UPDATE calendar_bookings SET status = 'cancelled' WHERE id = $1", [b.id]);
  await sql("UPDATE booking_reminders SET send_at = now() - interval '1 second' WHERE booking_id = $1 AND status = 'pending'", [b.id]);
  sent.sms.length = 0;
  sent.email.length = 0;
  await pr.processDueBookingReminders(100);
  assert.equal(to(b).sms.length + to(b).email.length, 0);
  assert.ok((await reminders(b.id)).filter((x) => x.kind !== "confirmation").every((x) => x.status === "cancelled" && x.last_error === "booking_cancelled"));
});

test("14b: a reminder for an appointment that has already started is skipped", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await sql("UPDATE calendar_bookings SET start_time = now() - interval '1 minute', end_time = now() + interval '29 minutes' WHERE id = $1", [b.id]);
  sent.sms.length = 0;
  await fireDue(b.id, "reminder_10m");
  assert.equal(to(b).sms.length, 0);
  assert.ok((await reminders(b.id)).filter((x) => x.kind === "reminder_10m").every((x) => x.status === "skipped"));
});

// ---------- 15: multiple appointments ----------

test("15: two appointments awaiting a reply on one number → neither is confirmed or cancelled", { skip }, async () => {
  const cal = await makeCalendar();
  const phone = newPhone();
  const a = await book(cal, 40, { phone });
  const b = await book(cal, 44, { phone });
  await fireDue(a.id, "reminder_12h");
  await fireDue(b.id, "reminder_12h");
  sent.sms.length = 0;
  assert.equal(await reply(phone, "N"), "ambiguous");
  assert.equal((await bookingRow(a.id)).status, "confirmed");
  assert.equal((await bookingRow(b.id)).status, "confirmed");
  assert.match(sent.sms.filter((m) => m.to.endsWith(phone.slice(1)))[0].body, /couldn't tell which appointment/);
  // The manage link still lets them act on exactly one.
  await call(handlers.manage, { method: "POST", body: { token: b.token, action: "cancel" } });
  assert.equal((await bookingRow(a.id)).status, "confirmed");
  assert.equal((await bookingRow(b.id)).status, "cancelled");
  // Now only one is awaiting → a reply is unambiguous.
  assert.equal(await reply(phone, "Y"), "confirmed");
  assert.equal((await bookingRow(a.id)).attendance_status, "confirmed");
});

test("15b: a token only ever reaches its own booking", { skip }, async () => {
  const cal = await makeCalendar();
  const a = await book(cal, 40);
  const b = await book(cal, 44);
  await call(handlers.manage, { method: "POST", body: { token: a.token, action: "cancel" } });
  assert.equal((await bookingRow(a.id)).status, "cancelled");
  assert.equal((await bookingRow(b.id)).status, "confirmed");
});

// ---------- 17: delivery failures ----------

test("17: provider 5xx retries; definite rejection fails and is logged; Twilio 'undelivered' callback marks failed", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  smsBehavior = () => { throw Object.assign(new Error("Twilio 503"), { status: 503 }); };
  await fireDue(b.id, "reminder_30m");
  let sms30 = (await reminders(b.id)).find((x) => x.kind === "reminder_30m" && x.channel === "sms");
  assert.equal(sms30.status, "pending");
  assert.ok(Date.parse(sms30.send_at) > Date.now());

  smsBehavior = () => { throw Object.assign(new Error("Invalid To number: +61 400 123 456"), { status: 400, code: 21211 }); };
  await fireDue(b.id, "reminder_30m");
  sms30 = (await reminders(b.id)).find((x) => x.kind === "reminder_30m" && x.channel === "sms");
  assert.equal(sms30.status, "failed");
  assert.match(sms30.last_error, /Invalid To number/);
  assert.ok(!/400 123 456|61400123456/.test(sms30.last_error), "phone number redacted");
  const ev = await sql("SELECT type FROM booking_events WHERE booking_id = $1", [b.id]);
  assert.ok(ev.some((e) => e.type === "reminder_retry") && ev.some((e) => e.type === "reminder_failed"));
  // email for the same reminder unaffected
  assert.equal((await reminders(b.id)).find((x) => x.kind === "reminder_30m" && x.channel === "email").status, "sent");

  // delivered/failed status from Twilio, signature-checked
  smsBehavior = null;
  await fireDue(b.id, "reminder_10m");
  const sms10 = (await reminders(b.id)).find((x) => x.kind === "reminder_10m" && x.channel === "sms");
  assert.equal(sms10.provider_status, "queued");
  const url = `${BASE}/api/booking-sms-status`;
  const mk = (status) => {
    const params = { MessageSid: sms10.provider_id, MessageStatus: status, ErrorCode: status === "undelivered" ? "30003" : "" };
    return { method: "POST", body: params, url: "/api/booking-sms-status", headers: { host: "crm.example.test", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params) } };
  };
  const bad = mk("delivered");
  bad.headers["x-twilio-signature"] = "forged";
  assert.equal((await call(handlers.status, bad)).statusCode, 403);
  assert.equal((await call(handlers.status, mk("undelivered"))).statusCode, 204);
  const after = (await reminders(b.id)).find((x) => x.id === sms10.id);
  assert.equal(after.status, "failed");
  assert.equal(after.provider_status, "undelivered");
  assert.equal(after.last_error, "twilio_error_30003");
  // a late "sent" can't move it backwards
  await call(handlers.status, mk("sent"));
  assert.equal((await reminders(b.id)).find((x) => x.id === sms10.id).provider_status, "undelivered");
});

test("17b: a stuck 'processing' row is failed as outcome_uncertain, never re-sent", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await sql("UPDATE booking_reminders SET status = 'processing', updated_at = now() - interval '11 minutes' WHERE booking_id = $1 AND kind = 'reminder_30m'", [b.id]);
  sent.sms.length = 0;
  await pr.processDueBookingReminders(100);
  assert.ok((await reminders(b.id)).filter((x) => x.kind === "reminder_30m").every((x) => x.status === "failed" && x.last_error === "outcome_uncertain"));
  assert.equal(to(b).sms.length, 0);
});

// ---------- 18, 19, 20: everything else unchanged ----------

test("19: a calendar WITHOUT the workflow books exactly as before — no reminder rows, automations still fire, GET cancel link still cancels", { skip }, async () => {
  const cal = await makeCalendar({ workflow: false, name: "Other Client Calendar" });
  const auto = await db.createAutomation({ name: "other client booking automation" });
  await db.updateAutomation(auto.id, { triggerType: "booking_created", triggerConfig: { calendarId: cal.id }, actions: [{ type: "sms", body: "hi {{name}}" }] });
  const b = await book(cal, 50);
  assert.equal((await reminders(b.id)).length, 0);
  assert.equal(to(b).sms.length + to(b).email.length, 0); // workflow fakes never used
  const runs = await sql("SELECT * FROM automation_runs WHERE automation_id = $1", [auto.id]);
  assert.equal(runs.length, 1);
  const row = await bookingRow(b.id);
  assert.equal(row.status, "confirmed");
  assert.equal(row.schedule_version, 1);
  const get = await call(handlers.cancel, { method: "GET", query: { token: b.token } });
  assert.equal(get.statusCode, 200);
  assert.equal((await bookingRow(b.id)).status, "cancelled");
  // their Y/N replies are ignored entirely
  assert.equal(await reply(b.phone, "N"), "no_match");
  await db.updateAutomation(auto.id, { active: false });
});

test("workflow calendar suppresses 'Booking Created' automations (no duplicate confirmations)", { skip }, async () => {
  const cal = await makeCalendar();
  const auto = await db.createAutomation({ name: "keevo booking automation" });
  await db.updateAutomation(auto.id, { triggerType: "booking_created", triggerConfig: { calendarId: cal.id }, actions: [{ type: "sms", body: "dup" }] });
  const b = await book(cal, 50);
  assert.equal((await sql("SELECT * FROM automation_runs WHERE automation_id = $1", [auto.id])).length, 0);
  assert.equal(to(b).sms.length, 1);
  await db.updateAutomation(auto.id, { active: false });
});

// ---------- "Booking Created" automations stop when the booking is cancelled ----------

// A non-workflow calendar with a "remind 2h before" automation: the
// run waits (pending) after booking, with this booking's id on it.
async function bookWithReminderAutomation(label) {
  const cal = await makeCalendar({ workflow: false, name: `Automation Reminder ${label}` });
  const auto = await db.createAutomation({ name: `reminder automation ${label}` });
  await db.updateAutomation(auto.id, {
    triggerType: "booking_created",
    triggerConfig: { calendarId: cal.id },
    actions: [{ type: "wait", mode: "before_appointment", amount: 2, unit: "hours" }, { type: "sms", body: "see you soon {{name}}" }],
  });
  const b = await book(cal, 50);
  const [run] = await sql("SELECT * FROM automation_runs WHERE automation_id = $1", [auto.id]);
  assert.equal(run.status, "pending");
  assert.equal(run.next_step_index, 1);
  assert.equal(run.context.bookingId, b.id);
  return { cal, auto, b, runId: run.id };
}
const runRow = async (id) => (await sql("SELECT * FROM automation_runs WHERE id = $1", [id]))[0];

test("patient cancel link stops that booking's pending automation runs; pre-existing runs without a bookingId are left alone", { skip }, async () => {
  const { cal, auto, b, runId } = await bookWithReminderAutomation("cancel-link");
  const legacy = await db.createAutomationRun({
    automationId: auto.id,
    context: { calendarId: cal.id, contact: { name: "Old Run" } },
    runAt: new Date(Date.now() + 365 * 86400000),
  });
  const get = await call(handlers.cancel, { method: "GET", query: { token: b.token } });
  assert.equal(get.statusCode, 200);
  assert.equal((await bookingRow(b.id)).status, "cancelled");
  const run = await runRow(runId);
  assert.equal(run.status, "done");
  assert.equal(run.last_error, "booking_cancelled");
  assert.equal(run.next_step_index, 1); // the reminder step never ran
  assert.equal((await runRow(legacy.id)).status, "pending");
  await sql("DELETE FROM automation_runs WHERE id = $1", [legacy.id]);
  await db.updateAutomation(auto.id, { active: false });
});

test("setter's Cancel in the CRM stops that booking's pending automation runs, and only that booking's", { skip }, async () => {
  const { cal, auto, b, runId } = await bookWithReminderAutomation("staff");
  const other = await book(cal, 70);
  const [otherRun] = await sql("SELECT id FROM automation_runs WHERE automation_id = $1 AND context->>'bookingId' = $2", [auto.id, String(other.id)]);
  const [user] = await sql("INSERT INTO users (name, email, role) VALUES ('Setter', $1, 'admin') RETURNING id, name, email", [`setter.${RUN}@example.test`]);
  const auth = await import("../auth.js");
  const cookie = auth.createSessionCookie(user).split(";")[0];
  const del = await call(handlers.bookings, { method: "DELETE", query: { id: String(b.id) }, headers: { cookie } });
  assert.equal(del.statusCode, 200, JSON.stringify(del.body));
  assert.equal((await bookingRow(b.id)).status, "cancelled");
  assert.equal((await runRow(runId)).status, "done");
  assert.equal((await runRow(runId)).last_error, "booking_cancelled");
  assert.equal((await runRow(otherRun.id)).status, "pending");
  await sql("DELETE FROM automation_runs WHERE id = $1", [otherRun.id]);
  await db.updateAutomation(auto.id, { active: false });
});

test("a due automation run whose booking was cancelled some other way skips its remaining steps", { skip }, async () => {
  const { auto, b, runId } = await bookWithReminderAutomation("belt-and-braces");
  // cancelled without going through cancelCalendarBooking, so the run is still pending
  await sql("UPDATE calendar_bookings SET status = 'cancelled' WHERE id = $1", [b.id]);
  await sql("UPDATE automation_runs SET run_at = now() - interval '1 second' WHERE id = $1", [runId]);
  await processDueAutomationRunsUntil(runId);
  const run = await runRow(runId);
  assert.equal(run.status, "done");
  assert.equal(run.last_error, "booking_cancelled");
  assert.equal(run.next_step_index, 1);
  await db.updateAutomation(auto.id, { active: false });
});

test("a due automation run for a still-confirmed booking carries on as before", { skip }, async () => {
  const { auto, runId } = await bookWithReminderAutomation("confirmed");
  await sql("UPDATE automation_runs SET run_at = now() - interval '1 second' WHERE id = $1", [runId]);
  await processDueAutomationRunsUntil(runId);
  const run = await runRow(runId);
  assert.equal(run.status, "done");
  assert.equal(run.last_error, null);
  assert.equal(run.next_step_index, 2);
  await db.updateAutomation(auto.id, { active: false });
});

// The poller is global — rows left from earlier runs may be due too —
// so keep processing until this one has been picked up.
async function processDueAutomationRunsUntil(runId) {
  const { processDueAutomationRuns } = await import("../automations.js");
  for (let i = 0; i < 20 && (await runRow(runId)).status === "pending"; i += 1) {
    await processDueAutomationRuns(100);
  }
}

test("18/20: booking still marks the matching lead Booked; staff cancel stops reminders without messaging", { skip }, async () => {
  const cal = await makeCalendar();
  const phone = newPhone();
  await sql("INSERT INTO contacts (name, phone, status, tag) VALUES ('Lead Person', $1, 'New Lead', 'keevo-test')", [phone]);
  const b = await book(cal, 50, { phone });
  const [contact] = await sql("SELECT status, notes FROM contacts WHERE phone = $1", [phone]);
  assert.equal(contact.status, "Booked");
  assert.match(contact.notes, /Booked via/);
  sent.sms.length = 0;
  sent.email.length = 0;
  const result = await pr.cancelWorkflowBooking(b.id, { reason: "cancelled_by_staff", source: "test", notifyPatient: false });
  assert.equal(result.booking.status, "cancelled");
  assert.equal(to(b).sms.length + to(b).email.length, 0);
  assert.equal((await reminders(b.id)).filter((x) => x.status === "pending").length, 0);
});

test("switching the workflow off stops pending reminders; patches without the flag leave it alone", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await db.updateCalendar(cal.id, { confirmationWorkflow: null });
  assert.equal((await db.getCalendarById(cal.id)).confirmationWorkflow, null);
  sent.sms.length = 0;
  await fireDue(b.id, "reminder_30m");
  assert.equal(to(b).sms.length, 0);
  // unchanged fields stay put when the flag isn't in a patch
  await db.updateCalendar(cal.id, { confirmationWorkflow: "keevo_health" });
  await db.updateCalendar(cal.id, { name: "Renamed" });
  assert.equal((await db.getCalendarById(cal.id)).confirmationWorkflow, "keevo_health");
});

test("self-heal schedules a workflow booking whose scheduling step failed, but never pre-existing bookings", { skip }, async () => {
  const cal = await makeCalendar();
  const b = await book(cal, 50);
  await sql("DELETE FROM booking_reminders WHERE booking_id = $1", [b.id]);
  await sql("UPDATE calendar_bookings SET created_at = now() - interval '5 minutes' WHERE id = $1", [b.id]);
  // created before the workflow was switched on → left alone
  await sql("UPDATE calendars SET confirmation_workflow_enabled_at = now() WHERE id = $1", [cal.id]);
  await pr.processDueBookingReminders(100);
  assert.equal((await reminders(b.id)).length, 0);
  // created after → healed
  await sql("UPDATE calendars SET confirmation_workflow_enabled_at = now() - interval '1 hour' WHERE id = $1", [cal.id]);
  await pr.processDueBookingReminders(100);
  assert.ok((await reminders(b.id)).some((x) => x.kind === "reminder_12h"));
});

// ---------- production-readiness helpers ----------

test("toSendableNumber: Australian formats become E.164; international left alone", { skip }, () => {
  const cases = {
    "0412 345 678": "+61412345678",
    "0412345678": "+61412345678",
    "(02) 9876 5432": "+61298765432",
    "61412345678": "+61412345678",
    "412345678": "+61412345678",
    "+61 412 345 678": "+61412345678",
    "+1 (415) 555-0100": "+14155550100",
    "0044 20 7946 0958": "+442079460958",
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(pr.toSendableNumber(input), expected, input);
  assert.equal(pr.toSendableNumber("12345"), "12345"); // unrecognisable → Twilio rejects, logged as failed
});

test("patientLinkBase: PUBLIC_URL, then Vercel's production domain, before a per-deployment URL", { skip }, () => {
  assert.equal(pr.patientLinkBase({ PUBLIC_URL: "https://crm.example.com/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }), "https://crm.example.com");
  assert.equal(pr.patientLinkBase({ VERCEL_PROJECT_PRODUCTION_URL: "scalbl-crmproper.vercel.app", VERCEL_URL: "scalbl-crm-abc123.vercel.app" }), "https://scalbl-crmproper.vercel.app");
  assert.equal(pr.patientLinkBase({ VERCEL_URL: "scalbl-crm-abc123.vercel.app" }), "https://scalbl-crm-abc123.vercel.app");
});

test("workflowReadiness: required items reflect the environment, never expose values", { skip }, () => {
  const empty = pr.workflowReadiness({ googleConnected: false, videoConferenceLink: "" }, {});
  assert.deepEqual(empty.filter((c) => c.required && !c.ok).map((c) => c.key).sort(), ["email", "links", "sms_replies", "sms_send"]);
  const env = {
    TWILIO_ACCOUNT_SID: "AC1", TWILIO_API_KEY_SID: "SK1", TWILIO_API_KEY_SECRET: "secret-value", TWILIO_TWIML_APP_SID: "AP1", TWILIO_CALLER_ID: "+61400000000",
    TWILIO_AUTH_TOKEN: "auth-secret", SENDGRID_API_KEY: "sg-secret", SENDGRID_FROM_EMAIL: "a@b.c", VERCEL_PROJECT_PRODUCTION_URL: "crm.example.com",
  };
  const ready = pr.workflowReadiness({ googleConnected: true }, env);
  assert.ok(ready.filter((c) => c.required).every((c) => c.ok));
  const text = JSON.stringify(ready);
  for (const secret of ["secret-value", "auth-secret", "sg-secret"]) assert.ok(!text.includes(secret));
});

test("cron sends due reminders in small batches within its time budget, stranding nothing", { skip }, async () => {
  const cal = await makeCalendar();
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await book(cal, 60 + i * 3)).id);
  await sql("UPDATE booking_reminders SET send_at = now() - interval '1 second' WHERE booking_id = ANY($1) AND kind = 'reminder_30m'", [ids]);
  await pr.processDueBookingReminders(100, { budgetMs: -1 }); // out of time → claims nothing
  assert.equal((await sql("SELECT count(*)::int n FROM booking_reminders WHERE booking_id = ANY($1) AND status = 'processing'", [ids]))[0].n, 0);
  await pr.processDueBookingReminders(100, { batchSize: 3 });
  assert.equal((await sql("SELECT count(*)::int n FROM booking_reminders WHERE booking_id = ANY($1) AND kind = 'reminder_30m' AND status <> 'sent'", [ids]))[0].n, 0);
});
