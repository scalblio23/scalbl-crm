// Static option lists for the Calendars feature's dropdowns — kept
// here rather than inline so the Calendar settings UI and the public
// BookingWidget can both use them.

// Every IANA timezone name the runtime knows about. Intl.supportedValuesOf
// isn't in every older browser, so fall back to a short hand-picked
// list rather than leaving the timezone picker empty.
const FALLBACK_TIMEZONES = [
  "UTC",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Pacific/Auckland",
];

export function listTimezones() {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    if (zones?.length) return zones;
  } catch {
    // fall through
  }
  return FALLBACK_TIMEZONES;
}

// Label includes the current UTC offset (e.g. "Australia/Sydney
// (UTC+10:00)") so picking a timezone doesn't require already knowing
// its offset.
function offsetLabel(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(
      new Date()
    );
    const gmt = parts.find((p) => p.type === "timeZoneName")?.value || "";
    return `${tz} (${gmt.replace("GMT", "UTC")})`;
  } catch {
    return tz;
  }
}

export function timezoneOptions() {
  return listTimezones()
    .map((tz) => ({ value: tz, label: offsetLabel(tz) }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// 15-minute increments, "00:00".."23:45" — used by the Availability
// section's start/end time pickers.
export function timeOfDayOptions() {
  const options = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    options.push({ value, label: `${h12}:${String(m).padStart(2, "0")} ${period}` });
  }
  return options;
}

export const EVENT_LENGTH_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
];

export const BUFFER_OPTIONS = [
  { value: "0", label: "No buffer" },
  { value: "5", label: "5 minutes" },
  { value: "10", label: "10 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
];

export const MIN_NOTICE_OPTIONS = [
  { value: "0", label: "No minimum" },
  { value: "1", label: "1 hour" },
  { value: "4", label: "4 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "1 day" },
  { value: "48", label: "2 days" },
];

export const BOOKING_WINDOW_OPTIONS = [
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

export const WEEKDAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];
