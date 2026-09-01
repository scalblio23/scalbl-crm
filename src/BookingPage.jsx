// The contact-facing booking page — served at /book/:slug (see
// src/main.jsx for the routing switch and vercel.json for the rewrite
// that makes that path work on a fresh page load in production). Talks
// only to the public endpoints in /api/public-*.js; never touches
// anything that needs a CRM login.
import { useEffect, useMemo, useState } from "react";
import { Calendar, Globe, Clock, MapPin, Loader2, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./lib/api";
import { getTimezoneList, detectBrowserTimezone, timezoneOffsetLabel } from "./lib/timezones";

function slugFromPath() {
  const match = window.location.pathname.match(/^\/book\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// "YYYY-MM-DD" for `isoString`'s instant as seen in `timeZone` — a
// slot's calendar date only means something relative to a timezone,
// and here that's whichever one the contact picked.
function localDateKey(isoString, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(isoString)
  );
}

function formatDateHeading(dateKey) {
  // dateKey is already the target calendar date — format it at face
  // value (as UTC) rather than re-interpreting it through a timezone,
  // which would risk shifting it a day either way.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

function formatTime(isoString, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(isoString));
}

const durationLabel = (mins) => (mins < 60 ? `${mins} min` : `${mins / 60} hr${mins / 60 > 1 ? "s" : ""}`);

export default function BookingPage() {
  const slug = useMemo(slugFromPath, []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [info, setInfo] = useState(null);
  const [slots, setSlots] = useState([]);
  const [timezone, setTimezone] = useState(detectBrowserTimezone());
  const [selectedDateKey, setSelectedDateKey] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmed, setConfirmed] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!slug) {
        setLoadError("This booking link is missing a page name.");
        setLoading(false);
        return;
      }
      try {
        const [infoRes, availRes] = await Promise.all([
          api.get(`/api/public-booking-info?slug=${encodeURIComponent(slug)}`),
          api.get(`/api/public-availability?slug=${encodeURIComponent(slug)}`),
        ]);
        if (cancelled) return;
        setInfo(infoRes);
        setSlots(availRes.slots || []);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "This booking page isn't available right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Grouped by the contact's chosen timezone — re-buckets whenever
  // they change it, since a slot near midnight can fall on a different
  // calendar day depending on the zone.
  const dateGroups = useMemo(() => {
    const map = new Map();
    for (const slot of slots) {
      const key = localDateKey(slot.start, timezone);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(slot);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [slots, timezone]);

  useEffect(() => {
    if (dateGroups.length === 0) {
      setSelectedDateKey(null);
      return;
    }
    if (!selectedDateKey || !dateGroups.some(([key]) => key === selectedDateKey)) {
      setSelectedDateKey(dateGroups[0][0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateGroups]);

  useEffect(() => {
    setSelectedSlot(null); // changing date or timezone invalidates whatever was picked
  }, [selectedDateKey, timezone]);

  const dateIndex = dateGroups.findIndex(([key]) => key === selectedDateKey);
  const daySlots = dateIndex >= 0 ? dateGroups[dateIndex][1] : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitError("");
    if (!form.name.trim() || !form.email.trim()) {
      setSubmitError("Enter your name and email.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post("/api/public-book", {
        slug,
        start: selectedSlot.start,
        end: selectedSlot.end,
        name: form.name.trim(),
        email: form.email.trim(),
        timezone,
        notes: form.notes.trim(),
      });
      setConfirmed(result);
    } catch (err) {
      setSubmitError(err.message || "Could not complete the booking.");
      // The slot may have just been taken — drop it and re-fetch so
      // the picker doesn't keep offering something that's gone.
      if (err.status === 409) {
        setSelectedSlot(null);
        try {
          const availRes = await api.get(`/api/public-availability?slug=${encodeURIComponent(slug)}`);
          setSlots(availRes.slots || []);
        } catch {
          // best-effort refresh — the error message above already told the contact what to do
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const Shell = ({ children }) => (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center py-10 px-4" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full max-w-3xl bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">{children}</div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-24 text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-2 py-24 px-8 text-center">
          <AlertTriangle size={22} className="text-amber-500" />
          <div className="text-sm text-gray-600">{loadError}</div>
        </div>
      </Shell>
    );
  }

  if (confirmed) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-3 py-20 px-8 text-center">
          <CheckCircle2 size={32} className="text-green-600" />
          <div className="text-lg font-bold">You're booked!</div>
          <div className="text-sm text-gray-600">{confirmed.whenForContact}</div>
          <div className="text-sm text-gray-400 max-w-sm mt-2">
            It's on {info.hostName}'s calendar, and we've sent a confirmation to{" "}
            <span className="font-medium text-gray-600">{form.email}</span>.
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid md:grid-cols-[minmax(0,220px)_1fr]">
        {/* Meeting summary */}
        <div className="border-b md:border-b-0 md:border-r border-gray-100 p-6 space-y-3">
          <div className="text-xs font-medium text-gray-400">{info.hostName}</div>
          <div className="text-lg font-bold leading-snug">{info.title}</div>
          {info.description && <div className="text-sm text-gray-500">{info.description}</div>}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock size={14} className="shrink-0" /> {durationLabel(info.slotMinutes)}
          </div>
          {info.location && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin size={14} className="shrink-0" /> {info.location}
            </div>
          )}
        </div>

        {/* Picker + form */}
        <div className="p-6">
          {!selectedSlot ? (
            <>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-1.5">
                <Globe size={13} /> Your timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-gray-400 mb-5"
              >
                {getTimezoneList().map((tz) => (
                  <option key={tz} value={tz}>
                    {tz} ({timezoneOffsetLabel(tz)})
                  </option>
                ))}
              </select>

              {dateGroups.length === 0 ? (
                <div className="text-sm text-gray-400 flex items-center gap-2 py-8 justify-center">
                  <Calendar size={16} /> No times available right now.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setSelectedDateKey(dateGroups[Math.max(0, dateIndex - 1)][0])}
                      disabled={dateIndex <= 0}
                      className="border border-gray-200 rounded-lg p-1.5 disabled:opacity-30 hover:bg-gray-50"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <div className="text-sm font-semibold flex-1 text-center">{formatDateHeading(selectedDateKey)}</div>
                    <button
                      type="button"
                      onClick={() => setSelectedDateKey(dateGroups[Math.min(dateGroups.length - 1, dateIndex + 1)][0])}
                      disabled={dateIndex >= dateGroups.length - 1}
                      className="border border-gray-200 rounded-lg p-1.5 disabled:opacity-30 hover:bg-gray-50"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                    {daySlots.map((slot) => (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className="border border-gray-200 rounded-lg py-2 text-sm font-medium hover:border-gray-900 hover:bg-gray-900 hover:text-white transition-colors"
                      >
                        {formatTime(slot.start, timezone)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setSelectedSlot(null)}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                <ChevronLeft size={13} /> Back to times
              </button>
              <div className="border border-gray-200 rounded-lg px-4 py-3 text-sm">
                <div className="font-semibold">{formatDateHeading(selectedDateKey)}</div>
                <div className="text-gray-500">
                  {formatTime(selectedSlot.start, timezone)} – {formatTime(selectedSlot.end, timezone)} ({timezoneOffsetLabel(timezone)})
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5 text-gray-500">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5 text-gray-500">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5 text-gray-500">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
              </div>
              {submitError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {submitError}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-1.5 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium disabled:opacity-40"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Confirm booking
              </button>
            </form>
          )}
        </div>
      </div>
    </Shell>
  );
}
