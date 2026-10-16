// SendGrid email — used by the Calendars feature for booking
// confirmation/notification/cancellation emails. Same shared-module,
// fetch-only pattern as server/googleCalendar.js: one JSON POST to
// SendGrid's REST API, no @sendgrid/mail dependency needed for that.
const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

export function missingEmailEnv(env = process.env) {
  return ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"].filter((key) => !env[key]);
}

// `ics`, if passed, is attached as a text/calendar file so the email
// works as an "add to calendar" action in Gmail/Outlook/Apple Mail
// even when the calendar isn't Google-connected (no real Google
// Calendar invite to fall back on in that case).
export async function sendCalendarEmail({ to, subject, html, ics }, env = process.env) {
  const missing = missingEmailEnv(env);
  if (missing.length) throw new Error(`SendGrid is not configured. Missing: ${missing.join(", ")}`);

  const attachments = ics
    ? [
        {
          content: Buffer.from(ics).toString("base64"),
          filename: "invite.ics",
          type: "text/calendar",
          disposition: "attachment",
        },
      ]
    : undefined;

  const res = await fetch(SENDGRID_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.SENDGRID_FROM_EMAIL, name: env.SENDGRID_FROM_NAME || undefined },
      subject,
      content: [{ type: "text/html", value: html }],
      attachments,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`SendGrid error (${res.status}): ${body || res.statusText}`);
    err.status = res.status;
    throw err;
  }
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
