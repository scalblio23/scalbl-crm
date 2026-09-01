// Pure scheduling math for the booking tool — no network or database
// calls, so it's easy to reason about (and test) in isolation from
// server/googleCalendar.js's API plumbing. Handles the timezone
// conversion a booking tool can't avoid: "9am–5pm" only means
// something relative to the host's chosen timezone, and Google's
// freeBusy response comes back in UTC.

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The classic dependency-free IANA-timezone-offset trick: format an
// instant as wall-clock time *in* `timeZone`, reinterpret those same
// numbers as if they were UTC, and the delta from the original
// instant is that zone's UTC offset at that moment (correct across
// DST since it's derived from the actual instant, not a fixed offset).
function timeZoneOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}

// Converts a "YYYY-MM-DD" + "HH:MM" wall-clock time in `timeZone` into
// the UTC instant it actually refers to. One correction pass handles
// the (rare) case where the offset near a DST boundary shifts between
// the initial guess and the resolved instant.
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  let offset = timeZoneOffsetMinutes(timeZone, guess);
  let utc = new Date(guess.getTime() - offset * 60000);
  offset = timeZoneOffsetMinutes(timeZone, utc);
  utc = new Date(guess.getTime() - offset * 60000);
  return utc;
}

// "YYYY-MM-DD" for `date` as seen from `timeZone` — en-CA formats
// dates in exactly that order/format.
export function hostLocalDateString(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date
  );
}

// Calendar-date arithmetic (not wall-clock ms addition, which would
// drift by an hour across a DST change) — the next `count` consecutive
// calendar dates in `timeZone` starting from `date`, as "YYYY-MM-DD" strings.
export function upcomingLocalDateStrings(date, timeZone, count) {
  const todayStr = hostLocalDateString(date, timeZone);
  const [y, m, d] = todayStr.split("-").map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(
        2,
        "0"
      )}`
    );
  }
  return out;
}

function weekdayKeyForDateString(dateStr) {
  return DAY_KEYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

// Given one host-local calendar date, the host's working hours for
// that weekday, a slot length, and a list of {start,end} busy
// intervals (ISO strings, as returned by Google's freeBusy), returns
// every slot that's within working hours, doesn't overlap a busy
// interval, and isn't inside the minimum-notice window.
export function computeAvailableSlots({ dateStr, hostTimezone, workingHours, slotMinutes, busy, minNoticeMs = 0 }) {
  const hours = workingHours?.[weekdayKeyForDateString(dateStr)];
  if (!hours || !hours.enabled) return [];

  const dayStart = zonedTimeToUtc(dateStr, hours.start, hostTimezone).getTime();
  const dayEnd = zonedTimeToUtc(dateStr, hours.end, hostTimezone).getTime();
  if (!(dayEnd > dayStart)) return [];

  const stepMs = slotMinutes * 60000;
  const earliest = Date.now() + minNoticeMs;
  const busyIntervals = busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));

  const slots = [];
  for (let t = dayStart; t + stepMs <= dayEnd; t += stepMs) {
    if (t < earliest) continue;
    const slotEnd = t + stepMs;
    const overlaps = busyIntervals.some((b) => t < b.end && slotEnd > b.start);
    if (!overlaps) slots.push({ start: new Date(t).toISOString(), end: new Date(slotEnd).toISOString() });
  }
  return slots;
}

// A friendly "Tuesday, 12 May 2026, 2:00 PM – 2:30 PM AEST"-style
// range, rendered in whichever timezone the reader (host or contact)
// actually wants to see it in — used in confirmation emails.
export function formatRangeInTimezone(startDate, endDate, timeZone) {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${dateFmt.format(startDate)}, ${timeFmt.format(startDate)} – ${timeFmt.format(endDate)}`;
}

// Preset slot lengths the Booking tab's duration picker offers — 15,
// 30, 60 minutes, then hourly up to 8 hours, per the ask.
export const SLOT_DURATION_OPTIONS = [15, 30, 60, 120, 180, 240, 300, 360, 420, 480];
