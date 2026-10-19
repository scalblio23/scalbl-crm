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
  return sendEmail({ to, subject, html, ics }, env);
}

// The one Resend send every email goes through. `text` is an optional
// plain-text part; `headers` e.g. In-Reply-To / References so a reply
// threads in the recipient's mail app.
// fromName / fromEmail override the default sender for one email (see
// checkSender — callers validate them first).
export async function sendEmail({ to, subject, html, text, ics, headers, fromName, fromEmail }, env = process.env) {
  const missing = missingEmailEnv(env);
  if (missing.length) throw new Error(`Resend is not configured. Missing: ${missing.join(", ")}`);

  const senderName = String(fromName ?? env.RESEND_FROM_NAME ?? "").replace(/[<>"\r\n]/g, "").trim();
  const senderEmail = fromEmail || env.RESEND_FROM_EMAIL;
  const from = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
  const attachments = ics
    ? [{ filename: "invite.ics", content: Buffer.from(ics).toString("base64"), content_type: "text/calendar" }]
    : undefined;

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    // RESEND_REPLY_TO (optional): where replies go — an address on the
    // domain Resend receives for, so replies land in Conversations →
    // Email (see api/email-inbound.js).
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text: text || undefined,
      attachments,
      headers: headers && Object.keys(headers).length ? headers : undefined,
      reply_to: env.RESEND_REPLY_TO || undefined,
    }),
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

// The full content of one email Resend received (the webhook only
// carries its id, sender and subject). Fetched with our own API key, so
// whatever the webhook claims, only a real email in our Resend account
// can come back from here.
export async function fetchReceivedEmail(id, env = process.env) {
  if (!env.RESEND_API_KEY) throw new Error("Resend is not configured. Missing: RESEND_API_KEY");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(id || ""))) throw new Error("Invalid email id");
  const res = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Resend error (${res.status}): ${body || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// "Jane Smith <jane@x.com>" → { name: "Jane Smith", email: "jane@x.com" }.
export function parseAddress(value) {
  const raw = String(value || "").trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: raw.toLowerCase() };
}

// The default sender, and the domain every custom From address must be
// on (the one RESEND_FROM_EMAIL is on — verified in Resend).
export function senderDefaults(env = process.env) {
  const email = String(env.RESEND_FROM_EMAIL || "").trim().toLowerCase();
  return { name: String(env.RESEND_FROM_NAME || "").trim(), email, domain: email.split("@")[1] || "" };
}

// Validates a sender chosen in the CRM. Returns { name, email } or
// { error }.
export function checkSender({ fromName, fromEmail }, env = process.env) {
  const d = senderDefaults(env);
  const email = String(fromEmail || d.email).trim().toLowerCase();
  const name = String(fromName ?? d.name).replace(/[<>"\r\n]/g, "").trim();
  if (name.length > 100) return { error: "That sender name is too long." };
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(email)) return { error: "Enter a valid From address." };
  if (!d.domain || email.split("@")[1] !== d.domain) return { error: `The From address must end in @${d.domain}.` };
  return { name, email };
}

// Plain text typed in the CRM → safe HTML (escaped, line breaks kept).
export function textToHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
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
