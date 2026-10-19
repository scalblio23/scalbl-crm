// Resend email — used by the Calendars feature for booking
// confirmation/notification/cancellation emails, Automations "Send
// email" steps and patient reminders. Same shared-module, fetch-only
// pattern as server/googleCalendar.js: one JSON POST to Resend's REST
// API, no SDK dependency needed for that.
const RESEND_URL = "https://api.resend.com/emails";

export function missingEmailEnv(env = process.env) {
  return ["RESEND_API_KEY", "RESEND_FROM_EMAIL"].filter((key) => !env[key]);
}

// `ics`, if passed, is attached as a text/calendar file so the email
// works as an "add to calendar" action in Gmail/Outlook/Apple Mail
// even when the calendar isn't Google-connected (no real Google
// Calendar invite to fall back on in that case). Resolves to Resend's
// email id.
export async function sendCalendarEmail({ to, subject, html, ics }, env = process.env) {
  const missing = missingEmailEnv(env);
  if (missing.length) throw new Error(`Resend is not configured. Missing: ${missing.join(", ")}`);

  const from = env.RESEND_FROM_NAME
    ? `${env.RESEND_FROM_NAME.replace(/[<>"]/g, "")} <${env.RESEND_FROM_EMAIL}>`
    : env.RESEND_FROM_EMAIL;
  const attachments = ics
    ? [{ filename: "invite.ics", content: Buffer.from(ics).toString("base64"), content_type: "text/calendar" }]
    : undefined;

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html, attachments }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Resend error (${res.status}): ${body || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  return { id: data?.id || null };
}

function icsDate(isoString) {
  return new Date(isoString).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function icsEscape(text) {
  return String(text || "").replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

// Minimal RFC 5545 event — enough for every major mail client's
// "add to calendar" button, without pulling in an ICS library.
// sequence/method/status are optional and default to the original
// output: an updated invite (reschedule) reuses the same uid with a
// higher sequence so mail clients move the existing event, and a
// METHOD:CANCEL / STATUS:CANCELLED one removes it.
export function buildIcs({
  uid,
  summary,
  description,
  location,
  startISO,
  endISO,
  organizerEmail,
  attendeeEmail,
  sequence,
  method = "PUBLISH",
  status = "CONFIRMED",
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Scalbl CRM//Calendars//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    sequence !== undefined ? `SEQUENCE:${sequence}` : null,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(startISO)}`,
    `DTEND:${icsDate(endISO)}`,
    `SUMMARY:${icsEscape(summary)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    location ? `LOCATION:${icsEscape(location)}` : null,
    organizerEmail ? `ORGANIZER:mailto:${organizerEmail}` : null,
    attendeeEmail ? `ATTENDEE:mailto:${attendeeEmail}` : null,
    `STATUS:${status}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}
