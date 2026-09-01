import React, { useState, useEffect, useMemo } from "react";
import { Loader2, ChevronLeft, ChevronRight, ChevronDown, CalendarDays, CheckCircle2 } from "lucide-react";
import { api } from "./lib/api";
import Dropdown from "./components/Dropdown";
import { timezoneOptions, detectBrowserTimezone } from "./lib/calendarOptions";

function dateKeyInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date
  );
}

function dayLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(
    date
  );
}

function timeLabel(iso, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// Standalone public page — /book/<slug>, no CRM chrome (see the
// routing check in src/main.jsx). Reuses the same input/button
// classNames as the rest of the app plus the new Dropdown component,
// so it reads as one product even outside the logged-in CRM.
export default function BookingWidget({ slug }) {
  const [calendarInfo, setCalendarInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [timezone, setTimezone] = useState(detectBrowserTimezone());
  const [windowStart, setWindowStart] = useState(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(null);
  const [windowSlots, setWindowSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [bookError, setBookError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const VISIBLE_SLOT_COUNT = 6;

  const tzOptions = useMemo(() => timezoneOptions(), []);
  const visibleDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(windowStart);
    d.setDate(d.getDate() + i);
    return d;
  }), [windowStart]);

  // These two requests don't actually depend on each other (the
  // slots endpoint only needs the slug + a date range, not anything
  // calendar-public returns) — firing them in parallel on mount
  // instead of waiting for calendar-public to resolve first cuts a
  // full round trip off the widget's load time, which mattered a lot
  // more than expected once real network/cold-start latency was in
  // the mix rather than local testing.
  useEffect(() => {
    setSelectedDayKey(dateKeyInZone(new Date(), timezone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .get(`/api/calendar-public?slug=${encodeURIComponent(slug)}`)
      .then(setCalendarInfo)
      .catch((err) => setLoadError(err.message || "This booking page isn't available."));
  }, [slug]);

  // Reset the picked slot whenever the selected day changes — it belongs
  // to whichever day was active when it was picked.
  useEffect(() => {
    setSelectedSlot(null);
    setShowAllSlots(false);
  }, [selectedDayKey]);

  // Fetch slots for the whole visible 7-day window in one call, not just
  // the selected day — the day picker needs every day's slot count up
  // front to grey out days with nothing available.
  useEffect(() => {
    setLoadingSlots(true);
    // Query a day either side of the visible window too — a visitor's
    // local calendar day can span two of the host calendar's
    // server-side days near a timezone boundary; slots are grouped
    // back onto their local day below.
    const firstKey = dateKeyInZone(visibleDays[0], timezone);
    const lastKey = dateKeyInZone(visibleDays[6], timezone);
    const from = new Date(`${firstKey}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(`${lastKey}T12:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    const fmt = (d) => d.toISOString().slice(0, 10);
    api
      .get(`/api/calendar-slots?slug=${encodeURIComponent(slug)}&from=${fmt(from)}&to=${fmt(to)}`)
      .then(({ slots: allSlots }) => setWindowSlots(allSlots))
      .catch(() => setWindowSlots([]))
      .finally(() => setLoadingSlots(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart, timezone, slug]);

  const slotsByDay = useMemo(() => {
    const map = {};
    for (const s of windowSlots) {
      const key = dateKeyInZone(new Date(s.startUTC), timezone);
      (map[key] ||= []).push(s);
    }
    return map;
  }, [windowSlots, timezone]);

  const slots = slotsByDay[selectedDayKey] || [];

  async function submitBooking(e) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setBookError("");
    try {
      const result = await api.post("/api/calendar-book", {
        slug,
        startUTC: selectedSlot.startUTC,
        endUTC: selectedSlot.endUTC,
        timezone,
        ...form,
      });
      setConfirmation(result);
    } catch (err) {
      setBookError(err.message || "Could not complete the booking.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-500 text-sm">{loadError}</p>
      </div>
    );
  }

  if (!calendarInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-1">You're booked!</h1>
          <p className="text-sm text-gray-600 mb-1">{calendarInfo.name}</p>
          <p className="text-sm font-medium text-gray-900">{confirmation.whenText}</p>
          <p className="text-xs text-gray-400 mt-4">A confirmation has been sent to you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <CalendarDays size={18} className="text-gray-400" /> {calendarInfo.name}
            </h1>
            {calendarInfo.description && <p className="text-sm text-gray-500 mt-1">{calendarInfo.description}</p>}
            <p className="text-xs text-gray-400 mt-1">{calendarInfo.eventLengthMinutes} minute call</p>
          </div>
          <div className="w-56 shrink-0">
            <label className="text-xs font-medium block mb-1.5 text-gray-500">Choose Your Timezone</label>
            <Dropdown value={timezone} onChange={setTimezone} options={tzOptions} searchable />
          </div>
        </div>

        {!selectedSlot ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setWindowStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
                className="text-gray-400 hover:text-gray-700"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-medium text-gray-600">
                {dayLabel(visibleDays[0], timezone)} – {dayLabel(visibleDays[6], timezone)}
              </span>
              <button
                onClick={() => setWindowStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
                className="text-gray-400 hover:text-gray-700"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1.5 mb-6">
              {visibleDays.map((d) => {
                const key = dateKeyInZone(d, timezone);
                const active = key === selectedDayKey;
                // Grey out (and disable) days with no bookable slots, once
                // the window has actually loaded — don't flash every day
                // as unavailable while the fetch is still in flight.
                const unavailable = !loadingSlots && !active && (slotsByDay[key] || []).length === 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDayKey(key)}
                    disabled={unavailable}
                    className={`flex flex-col items-center py-2.5 rounded-lg text-xs font-medium border ${
                      active
                        ? "bg-gray-900 text-white border-gray-900"
                        : unavailable
                        ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {dayLabel(d, timezone)}
                  </button>
                );
              })}
            </div>

            {loadingSlots ? (
              <div className="flex justify-center py-10">
                <Loader2 size={18} className="animate-spin text-gray-400" />
              </div>
            ) : slots.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No available times on this day.</p>
            ) : (
              <div className="max-w-sm mx-auto">
                <div className="flex flex-col gap-2">
                  {(showAllSlots ? slots : slots.slice(0, VISIBLE_SLOT_COUNT)).map((s) => (
                    <button
                      key={s.startUTC}
                      onClick={() => setSelectedSlot(s)}
                      className="border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:border-gray-900 hover:bg-gray-50"
                    >
                      {timeLabel(s.startUTC, timezone)}
                    </button>
                  ))}
                </div>
                {!showAllSlots && slots.length > VISIBLE_SLOT_COUNT && (
                  <button
                    onClick={() => setShowAllSlots(true)}
                    className="w-full flex items-center justify-center gap-1.5 mt-3 text-sm text-gray-500 hover:text-gray-800 font-medium"
                  >
                    Show more times <ChevronDown size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={submitBooking} className="p-6 max-w-sm mx-auto space-y-4">
            <button type="button" onClick={() => setSelectedSlot(null)} className="text-xs text-gray-400 hover:text-gray-700">
              ← Pick a different time
            </button>
            <p className="text-sm font-medium text-gray-900">
              {dayLabel(new Date(selectedSlot.startUTC), timezone)} at {timeLabel(selectedSlot.startUTC, timezone)}
            </p>
            <div>
              <label className="text-sm font-medium block mb-1.5">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Phone (for a text reminder)</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
              />
            </div>
            {bookError && <p className="text-sm text-red-600">{bookError}</p>}
            <button
              type="submit"
              disabled={submitting || (!form.email && !form.phone)}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Confirm booking
            </button>
            {!form.email && !form.phone && (
              <p className="text-xs text-gray-400 text-center">An email or phone number is required.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
