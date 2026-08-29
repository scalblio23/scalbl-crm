// Shared IANA timezone list — used by the Booking tab (host picks
// their own timezone for working hours) and the public booking page
// (a contact picks theirs before choosing a slot, so times never get
// crossed). Modern browsers/Node expose the full IANA database via
// Intl.supportedValuesOf; the curated fallback covers everywhere
// that doesn't (older Safari in particular).
const FALLBACK_TIMEZONES = [
  "UTC",
  "Pacific/Auckland",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/London",
  "Atlantic/Reykjavik",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function getTimezoneList() {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const zones = Intl.supportedValuesOf("timeZone");
      if (zones?.length) return zones;
    }
  } catch {
    // fall through to the curated list
  }
  return FALLBACK_TIMEZONES;
}

export function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// A short, human "UTC+10:00"-style offset label for a timezone name —
// shown next to each option so a contact who doesn't recognise
// "Australia/Adelaide" can still tell zones apart at a glance.
export function timezoneOffsetLabel(timeZone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value;
    return offset || "";
  } catch {
    return "";
  }
}
