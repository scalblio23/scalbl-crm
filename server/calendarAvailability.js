// Pure availability math for the Calendars feature — turns a
// calendar's weekly `availability` rules + booking rules into actual
// bookable UTC slots, given whatever's already busy (Google freebusy
// + existing confirmed bookings). No date/timezone library — the
// runtime's built-in Intl is enough for the two things actually
// needed here: converting a "wall clock time in timezone X" into a
// UTC instant, and reading a UTC instant back as a wall-clock date in
// timezone X. Kept dependency-free and easy to unit-test in isolation
// from the API layer (api/calendar-slots.js does the DB/Google I/O
// and hands this function plain data).
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Offset (in minutes, positive east of UTC) of `timeZone` at the
// instant `date` falls on — read by formatting that instant in the
// target zone and comparing it back to the same instant in UTC.
function timezoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
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
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

// Converts a wall-clock "YYYY-MM-DD" + "HH:MM" reading in `timeZone`
// into the UTC instant it refers to. Two passes are enough in
// practice — the offset only changes right at a DST transition, and
// re-reading it once against the first guess converges.
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const wallClockUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wallClockUTC;
  for (let i = 0; i < 2; i++) {
    const offset = timezoneOffsetMinutes(new Date(guess), timeZone);
    guess = wallClockUTC - offset * 60000;
  }
  return new Date(guess);
}

// Reads a UTC instant back as its "YYYY-MM-DD" calendar date in
// `timeZone` — used to attribute an existing booking to the local day
// it falls on, for the max-bookings-per-day check.
export function localDateStrInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(instant))
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function enumerateDates(fromDate, toDate) {
  const dates = [];
  let cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

// Expands one calendar day's availability ranges into fixed-length
// slots, stepping by event length + buffer so back-to-back bookings
// always leave the configured gap.
function slotsForDay(calendar, dateStr) {
  const weekdayKey = WEEKDAY_KEYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
  const ranges = calendar.availability?.[weekdayKey] || [];
  const stepMinutes = calendar.eventLengthMinutes + calendar.bufferMinutes;
  if (stepMinutes <= 0) return [];
  const slots = [];
  for (const range of ranges) {
    const rangeEnd = zonedTimeToUtc(dateStr, range.end, calendar.timezone);
    let cursor = zonedTimeToUtc(dateStr, range.start, calendar.timezone);
    while (true) {
      const slotEnd = new Date(cursor.getTime() + calendar.eventLengthMinutes * 60000);
      if (slotEnd > rangeEnd) break;
      slots.push({ start: cursor, end: slotEnd });
      cursor = new Date(cursor.getTime() + stepMinutes * 60000);
    }
  }
  return slots;
}

// `calendar`: { timezone, eventLengthMinutes, bufferMinutes,
//   minNoticeHours, bookingWindowDays, maxBookingsPerDay, availability }
// `googleBusy`: [{ start, end }] ISO strings, from getFreeBusy().
// `existingBookings`: [{ startTime, endTime }] confirmed bookings —
//   already-busy time AND what the per-day cap counts against.
// Returns [{ startUTC, endUTC }], soonest first.
export function computeAvailableSlots({
  calendar,
  fromDate,
  toDate,
  googleBusy = [],
  existingBookings = [],
  now = new Date(),
}) {
  const earliestStart = new Date(now.getTime() + calendar.minNoticeHours * 3600000);
  const latestStart = new Date(now.getTime() + calendar.bookingWindowDays * 86400000);
  const busyRanges = [
    ...googleBusy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
    ...existingBookings.map((b) => ({ start: new Date(b.startTime), end: new Date(b.endTime) })),
  ];
  const bookedCountByDay = new Map();
  if (calendar.maxBookingsPerDay != null) {
    for (const b of existingBookings) {
      const day = localDateStrInZone(b.startTime, calendar.timezone);
      bookedCountByDay.set(day, (bookedCountByDay.get(day) || 0) + 1);
    }
  }

  const result = [];
  for (const dateStr of enumerateDates(fromDate, toDate)) {
    const maxPerDay = calendar.maxBookingsPerDay;
    let dayCount = maxPerDay != null ? bookedCountByDay.get(dateStr) || 0 : 0;
    for (const slot of slotsForDay(calendar, dateStr)) {
      if (slot.start < earliestStart || slot.start > latestStart) continue;
      if (maxPerDay != null && dayCount >= maxPerDay) break;
      if (busyRanges.some((b) => slot.start < b.end && slot.end > b.start)) continue;
      result.push({ startUTC: slot.start.toISOString(), endUTC: slot.end.toISOString() });
      if (maxPerDay != null) dayCount++;
    }
  }
  return result;
}
