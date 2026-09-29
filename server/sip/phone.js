// Phone number formatting for the SIP trunk. Same Australia-first
// normalization as src/lib/twilioDevice.js and server/twilioCore.js
// (keep them in sync): "0412 345 678" → "+61412345678".
export function toE164(rawPhone) {
  const cleaned = String(rawPhone || "").replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("0")) return `+61${cleaned.slice(1)}`;
  if (cleaned.startsWith("61")) return `+${cleaned}`;
  return cleaned;
}

export function normalizeCallerId(raw) {
  const s = String(raw || "").trim();
  return s ? toE164(s) : "";
}

// Writes an E.164 number the way the trunk wants it in the
// Request-URI's user part — see SIP_DIAL_FORMAT in config.js.
export function formatForDial(rawPhone, format = "e164") {
  const e164 = toE164(rawPhone);
  if (!e164) return "";
  if (format === "e164-no-plus") return e164.replace(/^\+/, "");
  if (format === "national") return e164.startsWith("+61") ? `0${e164.slice(3)}` : e164.replace(/^\+/, "");
  return e164;
}

// A number is dialable if it's 6-15 digits once normalized (E.164's
// limit), optionally led by a "+". Short codes like 13xxxx are fine.
export function isDialable(rawPhone) {
  return /^\+?\d{6,15}$/.test(toE164(rawPhone));
}

// The caller's number from an inbound INVITE's From URI user part,
// normalized to E.164 when it looks like an Australian number.
export function callerNumberFromUser(user) {
  const digits = String(user || "").replace(/[^\d+]/g, "");
  return digits ? toE164(digits) : "";
}
