import React, { useState, useEffect, useMemo, useRef } from "react";
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

// "Thu" and "1" separately, for the stacked day tiles on phones.
function weekdayAndDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric" }).formatToParts(date);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value || "",
    day: parts.find((p) => p.type === "day")?.value || "",
  };
}

function timeLabel(iso, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// Meta Pixel base code (the standard snippet, minus the <noscript>
// image) — injected only when the calendar has a Pixel ID set in
// Calendar settings → Tracking. Fires PageView on load; the booking
// itself fires the standard "Schedule" event (see submitBooking).
function loadMetaPixel(pixelId) {
  if (!pixelId || typeof window === "undefined") return;
  if (!window.fbq) {
    const n = (window.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

// When the widget is embedded with the snippet from Calendar settings →
// Share & embed, the host page answers our "scalbl:ready" with
// "scalbl:parent-tracking" and fires the pixel itself — events fired
// inside a cross-site iframe miss the host page's cookies and don't
// show up in Meta's pixel helper for that page. A bare <iframe> embed
// (no listener) never answers, so we fall back to firing in here.
const isFramed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const PARENT_ACK_WAIT_MS = 1500;

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
  // Bumped each time a window's slots finish loading — the "jump to the
  // first available day" effect below waits on it.
  const [slotsLoadCount, setSlotsLoadCount] = useState(0);
  // On first load only: if today has no free times, select the first day
  // that does, moving forward a week at a time if needed. Off as soon as
  // the visitor picks a day or changes week themselves.
  const autoPickRef = useRef(true);
  const autoWeeksRef = useRef(0);
  const [selectedSlot, setSelectedSlot] = useState(null);
  // ?name=&email=&phone= pre-fill the form, e.g. when embedded after a lead-capture survey.
  const [form, setForm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { name: params.get("name") || "", email: params.get("email") || "", phone: params.get("phone") || "", notes: "" };
  });
  const [submitting, setSubmitting] = useState(false);
  const [bookError, setBookError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const VISIBLE_SLOT_COUNT = 6;
  const parentTracksRef = useRef(false);

  useEffect(() => {
    if (!isFramed) return;
    const onMessage = (e) => {
      if (e.source === window.parent && e.data?.type === "scalbl:parent-tracking") parentTracksRef.current = true;
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "scalbl:ready", slug }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [slug]);

  // Manage mode — /book/<slug>#manage=<token>[&action=reschedule|cancel|confirm|calendar],
  // the link in a booking confirmation message (see api/calendar-manage.js).
  // Calendars with the patient confirmation workflow get the full set of
  // actions; every other calendar gets a cancel-only view. The token lives in the URL fragment, which
  // the browser never sends anywhere; it's posted in request bodies.
  // Nothing happens on page load beyond showing the appointment — every
  // change is an explicit click, so link scanners can't trigger one.
  const manageParams = useMemo(() => new URLSearchParams(window.location.hash.slice(1)), []);
  const manageToken = manageParams.get("manage");
  const manageAction = manageParams.get("action");
  const [manageView, setManageView] = useState(null);
  const [manageError, setManageError] = useState("");
  const [manageBusy, setManageBusy] = useState(false);
  const [manageNotice, setManageNotice] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const manageCall = (action, extra = {}) => api.post("/api/calendar-manage", { token: manageToken, action, ...extra });

  useEffect(() => {
    if (!manageToken) return;
    manageCall("view")
      .then((view) => {
        setManageView(view);
        if (view.workflow && view.canChange && manageAction === "reschedule") setRescheduling(true);
        if (view.canChange && manageAction === "cancel") setConfirmingCancel(true);
      })
      .catch((err) => setManageError(err.message || "We couldn't find this appointment."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageToken]);

  async function runManageAction(action, extra, notice) {
    setManageBusy(true);
    setManageError("");
    try {
      const view = await manageCall(action, extra);
      setManageView(view);
      setManageNotice(notice);
      return true;
    } catch (err) {
      setManageError(err.message || "Something went wrong — please try again.");
      return false;
    } finally {
      setManageBusy(false);
    }
  }

  async function downloadIcs() {
    try {
      const { ics } = await manageCall("ics");
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "appointment.ics";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setManageError(err.message || "Couldn't create the calendar invite.");
    }
  }

  async function submitReschedule() {
    const ok = await runManageAction(
      "reschedule",
      { startUTC: selectedSlot.startUTC, endUTC: selectedSlot.endUTC, timezone },
      "Your appointment has been moved. A new confirmation is on its way."
    );
    if (ok) {
      setRescheduling(false);
      setSelectedSlot(null);
    }
  }

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
      .then((info) => {
        setCalendarInfo(info);
        if (!info.metaPixelId) return;
        if (!isFramed) loadMetaPixel(info.metaPixelId);
        else setTimeout(() => !parentTracksRef.current && loadMetaPixel(info.metaPixelId), PARENT_ACK_WAIT_MS);
      })
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
      .finally(() => {
        setLoadingSlots(false);
        setSlotsLoadCount((n) => n + 1);
      });
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

  useEffect(() => {
    if (!autoPickRef.current || !slotsLoadCount || loadingSlots) return;
    const todayKey = dateKeyInZone(new Date(), timezone);
    const firstFree = visibleDays
      .map((d) => dateKeyInZone(d, timezone))
      .find((k) => k >= todayKey && (slotsByDay[k] || []).length > 0);
    if (firstFree) {
      autoPickRef.current = false;
      setSelectedDayKey(firstFree);
      return;
    }
    // Nothing this week — look at the next one, up to the booking window.
    const maxWeeks = Math.ceil((calendarInfo?.bookingWindowDays || 60) / 7);
    if (autoWeeksRef.current >= maxWeeks) {
      // No availability at all: go back to this week and show today.
      autoPickRef.current = false;
      setWindowStart(new Date());
      setSelectedDayKey(todayKey);
      return;
    }
    autoWeeksRef.current += 1;
    setWindowStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsLoadCount, loadingSlots]);

  const stopAutoPick = () => {
    autoPickRef.current = false;
  };

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
      const eventId = `scalbl-booking-${result.booking?.id ?? Date.now()}`;
      if (isFramed) {
        window.parent.postMessage(
          { type: "scalbl:booked", slug, eventId, calendarName: calendarInfo?.name, metaPixelId: calendarInfo?.metaPixelId || null },
          "*"
        );
      }
      if (calendarInfo?.metaPixelId && window.fbq && !parentTracksRef.current) {
        window.fbq("trackSingle", calendarInfo.metaPixelId, "Schedule", { content_name: calendarInfo.name }, { eventID: eventId });
      }
    } catch (err) {
      setBookError(err.message || "Could not complete the booking.");
    } finally {
      setSubmitting(false);
    }
  }

  // The manage view only needs the token, so it still works for a
  // calendar that has since been deactivated (its booking page 404s).
  const showManage = manageToken && !rescheduling;

  if (loadError && !showManage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-500 text-sm">{loadError}</p>
      </div>
    );
  }

  if (!calendarInfo && !showManage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (showManage) {
    const v = manageView;
    const whenText = v
      ? new Intl.DateTimeFormat("en-AU", {
          timeZone: v.timezone,
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(new Date(v.startTime))
      : "";
    const btn = "w-full flex items-center justify-center gap-2 text-sm px-5 py-2.5 rounded-lg font-medium disabled:opacity-40";
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 max-w-md w-full">
          {!v ? (
            manageError ? (
              <p className="text-sm text-gray-500 text-center">{manageError}</p>
            ) : (
              <div className="flex justify-center">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <CalendarDays size={28} className="text-gray-400 mx-auto mb-3" />
                <h1 className="text-lg font-bold">{v.calendarName}</h1>
                <p className="text-sm font-medium text-gray-900 mt-1">{whenText}</p>
                {v.status === "cancelled" ? (
                  <p className="text-sm text-red-600 mt-2">This appointment is cancelled.</p>
                ) : v.attendanceStatus === "confirmed" ? (
                  <p className="text-sm text-emerald-600 mt-2 flex items-center justify-center gap-1">
                    <CheckCircle2 size={14} /> You've confirmed you'll attend.
                  </p>
                ) : null}
              </div>
              {manageNotice && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{manageNotice}</p>}
              {manageError && <p className="text-sm text-red-600">{manageError}</p>}
              {v.canChange ? (
                confirmingCancel ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-700">
                      {v.workflow
                        ? "Cancel this appointment? Its reminders will stop, and you can book another time afterwards."
                        : "Cancel this appointment? You can book another time afterwards."}
                    </p>
                    <button
                      disabled={manageBusy}
                      onClick={async () => {
                        const notice = v.workflow ? "Your appointment has been cancelled. A confirmation is on its way." : "Your appointment has been cancelled.";
                        if (await runManageAction("cancel", {}, notice)) setConfirmingCancel(false);
                      }}
                      className={`${btn} bg-red-600 text-white`}
                    >
                      {manageBusy && <Loader2 size={14} className="animate-spin" />} Yes, cancel it
                    </button>
                    <button onClick={() => setConfirmingCancel(false)} className={`${btn} border border-gray-200 text-gray-700`}>
                      Keep my appointment
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {v.meetLink && (
                      <a href={v.meetLink} target="_blank" rel="noreferrer noopener" className={`${btn} bg-gray-900 text-white`}>
                        Join with Google Meet
                      </a>
                    )}
                    {v.workflow && v.attendanceStatus !== "confirmed" && (
                      <button
                        disabled={manageBusy}
                        onClick={() => runManageAction("confirm", {}, "Thanks for confirming. We look forward to speaking with you.")}
                        className={`${btn} ${manageAction === "confirm" ? "bg-emerald-600 text-white" : "border border-gray-200 text-gray-700"}`}
                      >
                        Confirm I'll attend
                      </button>
                    )}
                    {v.workflow && (
                      <>
                        <button onClick={downloadIcs} className={`${btn} border border-gray-200 text-gray-700`}>
                          Add to calendar
                        </button>
                        <button onClick={() => { setManageNotice(""); setRescheduling(true); }} className={`${btn} border border-gray-200 text-gray-700`}>
                          Reschedule
                        </button>
                      </>
                    )}
                    <button onClick={() => setConfirmingCancel(true)} className={`${btn} text-red-600`}>
                      Cancel appointment
                    </button>
                  </div>
                )
              ) : (
                <a href={`/book/${slug}`} className={`${btn} bg-gray-900 text-white`}>
                  Book another time
                </a>
              )}
            </div>
          )}
        </div>
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
    <div className="min-h-screen bg-gray-50 px-3 sm:px-4 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-5 border-b border-gray-100 flex flex-col sm:flex-row items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <CalendarDays size={18} className="text-gray-400" /> {calendarInfo.name}
            </h1>
            {calendarInfo.description && <p className="text-sm text-gray-500 mt-1">{calendarInfo.description}</p>}
            {rescheduling && (
              <p className="text-sm text-gray-700 mt-2">
                Pick a new time.{" "}
                <button type="button" onClick={() => { setRescheduling(false); setSelectedSlot(null); }} className="text-gray-400 hover:text-gray-700 underline">
                  Back
                </button>
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">{calendarInfo.eventLengthMinutes} minute call</p>
          </div>
          <div className="w-full sm:w-56 shrink-0">
            <label className="text-xs font-medium block mb-1.5 text-gray-500">Choose Your Timezone</label>
            <Dropdown value={timezone} onChange={setTimezone} options={tzOptions} searchable />
          </div>
        </div>

        {!selectedSlot ? (
          <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => { stopAutoPick(); setWindowStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }); }}
                className="text-gray-400 hover:text-gray-700"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-medium text-gray-600">
                {dayLabel(visibleDays[0], timezone)} – {dayLabel(visibleDays[6], timezone)}
              </span>
              <button
                onClick={() => { stopAutoPick(); setWindowStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; }); }}
                className="text-gray-400 hover:text-gray-700"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-6">
              {visibleDays.map((d) => {
                const key = dateKeyInZone(d, timezone);
                const active = key === selectedDayKey;
                // Grey out (and disable) days with no bookable slots, once
                // the window has actually loaded — don't flash every day
                // as unavailable while the fetch is still in flight.
                const unavailable = !loadingSlots && !active && (slotsByDay[key] || []).length === 0;
                const { weekday, day } = weekdayAndDay(d, timezone);
                // Bookable days get a light blue glow on every screen size.
                // Phones get a stacked "Thu / 1" tile; sm and up keep the
                // "Thu, Oct 1" buttons.
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      stopAutoPick();
                      setSelectedDayKey(key);
                    }}
                    disabled={unavailable}
                    className={`flex flex-col items-center justify-center py-2 sm:py-2.5 rounded-xl sm:rounded-lg text-xs font-medium border ${
                      active
                        ? "bg-gray-900 text-white border-gray-900"
                        : unavailable
                        ? "bg-transparent text-gray-300 border-transparent sm:bg-gray-50 sm:border-gray-100 cursor-not-allowed"
                        : "bg-sky-50 text-slate-700 border-transparent sm:border-sky-100 shadow-[0_0_10px_rgba(56,189,248,0.25)] hover:border-sky-300"
                    }`}
                  >
                    <span className="sm:hidden text-[13px] font-medium leading-tight">{weekday}</span>
                    <span className="sm:hidden text-xl font-normal leading-tight mt-1">{day}</span>
                    <span className="hidden sm:inline">{dayLabel(d, timezone)}</span>
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
        ) : rescheduling ? (
          <div className="p-6 max-w-sm mx-auto space-y-4">
            <button type="button" onClick={() => setSelectedSlot(null)} className="text-xs text-gray-400 hover:text-gray-700">
              ← Pick a different time
            </button>
            <p className="text-sm font-medium text-gray-900">
              Move to {dayLabel(new Date(selectedSlot.startUTC), timezone)} at {timeLabel(selectedSlot.startUTC, timezone)}?
            </p>
            {manageError && <p className="text-sm text-red-600">{manageError}</p>}
            <button
              onClick={submitReschedule}
              disabled={manageBusy}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium disabled:opacity-40"
            >
              {manageBusy && <Loader2 size={14} className="animate-spin" />}
              Confirm new time
            </button>
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
