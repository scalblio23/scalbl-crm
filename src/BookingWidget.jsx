import React, { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { Loader2, ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, Clock, ArrowLeft, ArrowDown, Globe, Mail } from "lucide-react";
import { api } from "./lib/api";
import Dropdown from "./components/Dropdown";
import { LocationLogo, meetingLocation } from "./components/MeetingLocation";
import { timezoneOptions, detectBrowserTimezone } from "./lib/calendarOptions";

// Booking rules → attendance confirmation wording; {time} becomes the
// call's time, date and timezone (in bold). Mirrored in SimpleCRM.jsx.
const ATTENDANCE_CONFIRM_DEFAULT =
  "Please confirm your attendance for your call at {time}, no shows are costly to our business and we require your confirmation.";

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

// Month view helpers. Days are "YYYY-MM-DD" keys in the visitor's
// timezone and months "YYYY-MM"; the grid is Sunday-first.
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function monthCells(ym) {
  const [y, m] = ym.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  return cells;
}
const monthLabel = (ym) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
// "Mon, Nov 23, 2026"
// Small inline flags (emoji flags don't render on Windows).
const UnionJack = ({ w = 30, h = 15 }) => (
  <svg viewBox="0 0 60 30" width={w} height={h} preserveAspectRatio="none">
    <clipPath id="uj-c"><path d="M0,0 v30 h60 v-30 z" /></clipPath>
    <clipPath id="uj-t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
    <g clipPath="url(#uj-c)">
      <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uj-t)" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </g>
  </svg>
);
const Star = ({ x, y, r, fill = "#fff" }) => (
  <polygon
    fill={fill}
    points={Array.from({ length: 10 }, (_, i) => {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      return `${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`;
    }).join(" ")}
  />
);
function Flag({ code }) {
  const box = "w-[26px] h-[17px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10";
  if (code === "GB") return <span className={box}><UnionJack w={26} h={17} /></span>;
  if (code === "US")
    return (
      <svg viewBox="0 0 26 17" className={box}>
        {Array.from({ length: 7 }, (_, i) => <rect key={i} y={(i * 2 * 17) / 13} width="26" height={17 / 13} fill="#B22234" />)}
        <rect width="11" height={(7 * 17) / 13} fill="#3C3B6E" />
      </svg>
    );
  // Blue ensign: Australia / New Zealand.
  return (
    <svg viewBox="0 0 26 17" className={box}>
      <rect width="26" height="17" fill="#012169" />
      <UnionJack w={13} h={8.5} />
      {code === "NZ" ? (
        <>
          <Star x={20} y={4} r={1.3} fill="#C8102E" /><Star x={17.5} y={8} r={1.4} fill="#C8102E" />
          <Star x={22.5} y={7.5} r={1.2} fill="#C8102E" /><Star x={20} y={13} r={1.5} fill="#C8102E" />
        </>
      ) : (
        <>
          <Star x={6.5} y={12.8} r={2.2} /><Star x={20} y={3.2} r={1.1} /><Star x={17} y={7.8} r={1.1} />
          <Star x={23.2} y={6.8} r={1.1} /><Star x={20} y={14} r={1.1} /><Star x={21.6} y={9.6} r={0.6} />
        </>
      )}
    </svg>
  );
}
const PHONE_COUNTRIES = [
  { code: "AU", name: "Australia", dial: "61" },
  { code: "NZ", name: "New Zealand", dial: "64" },
  { code: "GB", name: "United Kingdom", dial: "44" },
  { code: "US", name: "United States", dial: "1" },
];
// Australian numbers are sent exactly as typed (the server normalises
// them); other countries get their dialling code prefixed.
function phoneForSubmit(raw, countryCode) {
  const v = (raw || "").trim();
  if (!v || countryCode === "AU" || v.startsWith("+")) return v;
  const c = PHONE_COUNTRIES.find((x) => x.code === countryCode);
  return `+${c.dial}${v.replace(/\D/g, "").replace(/^0+/, "")}`;
}
const tzLabel = (tz) => {
  try {
    const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((x) => x.type === "timeZoneName")?.value;
    return off ? `${tz} (${off})` : tz;
  } catch {
    return tz;
  }
};

// "Zoom Call", "Google Meet Call", … for the headline; just "Call" when
// the calendar has no Location set.
const callTypeLabel = (location) =>
  ({ zoom: "Zoom Call", gmeet: "Google Meet Call", teams: "Teams Call", phone: "Phone Call" })[location] || "Call";

const dayKeyPart = (key, opts) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

const dayKeyLabel = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
// "08:00 AM" — the time buttons.
function slotTimeLabel(iso, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function timeLabel(iso, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// "Tuesday, 10 November at 2:30 pm AEDT" — the details page's headline.
// The zone's short name prefers a real abbreviation (en-AU knows AEDT /
// AWST, en-US knows EST / PDT) over a bare "GMT+11".
function bookingWhenParts(iso, timeZone) {
  const d = new Date(iso);
  const part = (opts) => new Intl.DateTimeFormat("en-AU", { timeZone, ...opts }).format(d);
  const day = `${part({ weekday: "long" })}, ${part({ day: "numeric" })} ${part({ month: "long" })}`;
  const time = new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  const names = ["en-AU", "en-US"].map(
    (locale) =>
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")
        ?.value || ""
  );
  const zone = names.find((n) => n && !n.startsWith("GMT")) || names[0];
  return { day, time, zone, year: part({ year: "numeric" }) };
}

// "2:30 pm, Tuesday, 10 November, AEDT" — TIME, DATE, TIMEZONE for the
// attendance-confirmation note.
function commitWhen(iso, timeZone) {
  const { day, time, zone } = bookingWhenParts(iso, timeZone);
  return `${time}, ${day}, ${zone || timeZone}`;
}

function bookingWhenHeadline(iso, timeZone) {
  const { day, time, zone } = bookingWhenParts(iso, timeZone);
  return `${day} at ${time}${zone ? ` ${zone}` : ""}`;
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
// Framed pages size to their content (the embed resizes the iframe to
// match); a full-viewport minimum there would pin the frame's height.
const fullHeight = (() => {
  try {
    return window.self !== window.top ? "min-h-[24rem]" : "min-h-screen";
  } catch {
    return "min-h-[24rem]";
  }
})();

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
  // The month shown ("YYYY-MM").
  const [monthKey, setMonthKey] = useState(() => dateKeyInZone(new Date(), detectBrowserTimezone()).slice(0, 7));
  const [selectedDayKey, setSelectedDayKey] = useState(null);
  const [windowSlots, setWindowSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Bumped each time a window's slots finish loading — the "jump to the
  // first available day" effect below waits on it.
  const [slotsLoadCount, setSlotsLoadCount] = useState(0);
  // On first load only: if today has no free times, select the first day
  // that does, moving forward a month at a time if needed. Off as soon as
  // the visitor picks a day or changes month themselves.
  const autoPickRef = useRef(true);
  const autoMonthsRef = useRef(0);
  const [selectedSlot, setSelectedSlot] = useState(null);
  // A time they've clicked but not yet confirmed with "Select" — the
  // two-step pick, so nobody books a time by a slip of the finger.
  const [pendingSlotStart, setPendingSlotStart] = useState(null);
  // Phones/tablets (below lg): tapping a date swaps the calendar for a
  // full-width time list with a back arrow, instead of listing times below.
  const [mobileTimesOpen, setMobileTimesOpen] = useState(false);
  // Which view just slid in: "times" / "calendar" (phone date <-> times),
  // "form" (time picked), "picker" (back from the details form).
  const [anim, setAnim] = useState(null);
  const goToForm = (slot) => {
    setAnim("form");
    setSelectedSlot(slot);
    if (window.matchMedia("(max-width: 767px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const backToPicker = () => {
    setAnim("picker");
    setSelectedSlot(null);
  };
  // ?name=&email=&phone= pre-fill the form, e.g. when embedded after a lead-capture survey.
  const [form, setForm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const [firstName = "", ...rest] = (params.get("name") || "").trim().split(/\s+/);
    return { firstName, lastName: rest.join(" "), country: "AU", email: params.get("email") || "", phone: params.get("phone") || "", notes: "" };
  });
  // Opt-in embed options, so other booking links are unaffected:
  //   ?commit=1  -> require a "will you show up" commitment checkbox before booking
  //   ?notes=0   -> hide the optional Notes field
  const embedOptions = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return { requireCommit: params.get("commit") === "1", hideNotes: params.get("notes") === "0" };
  }, []);
  // The attendance-confirmation box shows when the calendar has it
  // switched on (Calendar settings → Booking rules) or the link asks
  // for it with ?commit=1.
  const requireCommit = embedOptions.requireCommit || Boolean(calendarInfo?.requireAttendanceConfirm);
  const [committed, setCommitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bookError, setBookError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  // The host page's embed code sizes the iframe to fit (it answers the
  // first scalbl:height with scalbl:autosize). Then nothing inside the
  // frame scrolls on its own, so a swipe/scroll over the widget moves
  // the whole page — on phones a scrollable iframe traps the finger.
  // Old fixed-height embeds never send it and keep inner scrolling,
  // which they need to reach content below the frame.
  const [autoSized, setAutoSized] = useState(false);
  useEffect(() => {
    if (!autoSized) return;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }, [autoSized]);
  const parentTracksRef = useRef(false);

  useEffect(() => {
    if (!isFramed) return;
    const onMessage = (e) => {
      if (e.source === window.parent && e.data?.type === "scalbl:parent-tracking") parentTracksRef.current = true;
      if (e.source === window.parent && e.data?.type === "scalbl:autosize") setAutoSized(true);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "scalbl:ready", slug }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [slug]);

  // Embedded: tell the host page how tall the widget is, so the embed
  // code can size the iframe to fit (no inner scrolling, the Schedule
  // button is never hidden below a fixed-height frame). Measured from
  // the content itself — the page doesn't stretch to the frame height
  // when framed (see fullHeight) — and re-sent whenever it changes,
  // including when a dropdown opens past the bottom.
  useEffect(() => {
    if (!isFramed) return;
    let last = 0;
    let raf = 0;
    const send = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const body = document.body;
        const h = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height));
        if (h && Math.abs(h - last) > 2) {
          last = h;
          window.parent.postMessage({ type: "scalbl:height", height: h }, "*");
        }
      });
    };
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    const mo = new MutationObserver(send);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    send();
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

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
  const cells = useMemo(() => monthCells(monthKey), [monthKey]);

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
    setPendingSlotStart(null);
  }, [selectedDayKey]);

  // Embedded: moving to another step (times, details, booked) asks the
  // host page to scroll the widget's top into view, since scrolling
  // inside the frame can't move the page around it.
  const stepKey = `${Boolean(selectedSlot)}-${mobileTimesOpen}-${Boolean(confirmation)}`;
  const firstStepRef = useRef(true);
  useEffect(() => {
    if (!isFramed) return;
    if (firstStepRef.current) {
      firstStepRef.current = false;
      return;
    }
    window.parent.postMessage({ type: "scalbl:step" }, "*");
  }, [stepKey]);

  // A commitment applies to one specific time — reset it whenever the slot changes.
  useEffect(() => {
    setCommitted(false);
  }, [selectedSlot]);

  // Fetch slots for the whole visible month in one call, not just the
  // selected day — the calendar needs every day's slot count up front
  // to show which days are bookable.
  useEffect(() => {
    setLoadingSlots(true);
    // Query a day either side of the visible window too — a visitor's
    // local calendar day can span two of the host calendar's
    // server-side days near a timezone boundary; slots are grouped
    // back onto their local day below.
    const monthDays = cells.filter(Boolean);
    const firstKey = monthDays[0];
    const lastKey = monthDays[monthDays.length - 1];
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
  }, [monthKey, timezone, slug]);

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
    const firstFree = cells.find((k) => k && k >= todayKey && (slotsByDay[k] || []).length > 0);
    if (firstFree) {
      autoPickRef.current = false;
      setSelectedDayKey(firstFree);
      return;
    }
    // Nothing left this month — look at the next one, up to the booking window.
    const maxMonths = Math.ceil((calendarInfo?.bookingWindowDays || 60) / 28) + 1;
    if (autoMonthsRef.current >= maxMonths) {
      // No availability at all: go back to this month and show today.
      autoPickRef.current = false;
      setMonthKey(todayKey.slice(0, 7));
      setSelectedDayKey(todayKey);
      return;
    }
    autoMonthsRef.current += 1;
    setMonthKey((m) => addMonths(m, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsLoadCount, loadingSlots]);

  const stopAutoPick = () => {
    autoPickRef.current = false;
  };

  async function submitBooking(e) {
    e.preventDefault();
    if (!selectedSlot) return;
    if (requireCommit && !committed) return;
    setSubmitting(true);
    setBookError("");
    try {
      const result = await api.post("/api/calendar-book", {
        slug,
        startUTC: selectedSlot.startUTC,
        endUTC: selectedSlot.endUTC,
        timezone,
        name: `${form.firstName} ${form.lastName}`.trim(),
        email: form.email.trim(),
        phone: phoneForSubmit(form.phone, form.country),
        notes: form.notes,
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
      <div className={`${fullHeight} flex items-center justify-center bg-gray-50 px-4`}>
        <p className="text-gray-500 text-sm">{loadError}</p>
      </div>
    );
  }

  if (!calendarInfo && !showManage) {
    return (
      <div className={`${fullHeight} flex items-center justify-center bg-gray-50`}>
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
      <div className={`${fullHeight} flex items-center justify-center bg-gray-50 px-4`}>
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
      <div className={`${fullHeight} flex items-center justify-center bg-gray-50 px-4`}>
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-1">You're booked!</h1>
          <p className="text-sm text-gray-600 mb-5">{calendarInfo.name}</p>
          {selectedSlot ? (
            (() => {
              // The time they booked, big and unmissable, in the timezone they picked.
              const when = bookingWhenParts(selectedSlot.startUTC, timezone);
              return (
                <div className="rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">Your appointment</p>
                  <p className="text-xl font-semibold text-gray-900">
                    {when.day} {when.year}
                  </p>
                  <p className="text-4xl font-bold text-blue-700 my-1 tabular-nums">{when.time}</p>
                  <p className="text-sm text-gray-600">
                    {when.zone ? `${when.zone} · ` : ""}
                    {timezone.replace(/_/g, " ")} time
                  </p>
                </div>
              );
            })()
          ) : (
            <p className="text-lg font-semibold text-gray-900">{confirmation.whenText}</p>
          )}
          <p className="text-xs text-gray-400 mt-4">A confirmation has been sent to you.</p>
        </div>
      </div>
    );
  }

  const todayKey = dateKeyInZone(new Date(), timezone);
  const atFirstMonth = monthKey <= todayKey.slice(0, 7);
  return (
    <div className={`${fullHeight} bg-gray-50 px-3 sm:px-6 py-4 sm:py-8`}>
      <h1 className="max-w-6xl mx-auto mb-4 sm:mb-6 flex items-center justify-center gap-2 sm:gap-4 text-center text-2xl sm:text-4xl font-extrabold text-gray-900 leading-tight">
        <ArrowDown className="shrink-0 h-7 w-7 sm:h-10 sm:w-10 text-blue-600" strokeWidth={3} aria-hidden="true" />
        <span>Book Your {callTypeLabel(calendarInfo.meetingLocation)} Below</span>
        <ArrowDown className="shrink-0 h-7 w-7 sm:h-10 sm:w-10 text-blue-600" strokeWidth={3} aria-hidden="true" />
      </h1>
      <div className="max-w-6xl mx-auto bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col md:flex-row">
        <aside className={`${mobileTimesOpen && !selectedSlot ? "hidden md:block" : ""} md:w-[30%] shrink-0 p-6 sm:p-8 border-b md:border-b-0 md:border-r border-gray-200`}>
          {selectedSlot && !rescheduling && (
            <button
              type="button"
              aria-label="Pick a different time"
              onClick={backToPicker}
              className="mb-6 h-12 w-12 flex items-center justify-center rounded-full border border-gray-200 text-blue-600 hover:bg-gray-50 bw-pop"
            >
              <ArrowLeft size={22} />
            </button>
          )}
          {(calendarInfo.hostPhoto || calendarInfo.hostName) && (
            <div className="flex items-center gap-3 mb-4">
              {calendarInfo.hostPhoto && (
                <img
                  src={calendarInfo.hostPhoto}
                  alt={calendarInfo.hostName || "Your host"}
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-full object-cover shrink-0 ring-2 ring-white shadow"
                />
              )}
              {calendarInfo.hostName && (
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">You're meeting with</p>
                  <p className="text-base font-semibold text-gray-900 truncate">{calendarInfo.hostName}</p>
                </div>
              )}
            </div>
          )}
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 leading-tight">{calendarInfo.name}</h1>
          <div className="mt-5 space-y-3 text-gray-600">
            <p className="flex items-center gap-3 font-medium">
              <Clock size={18} className="text-gray-500 shrink-0" /> {calendarInfo.eventLengthMinutes} min
            </p>
            {meetingLocation(calendarInfo.meetingLocation) && (
              <p className="flex items-center gap-3 font-medium">
                <LocationLogo value={calendarInfo.meetingLocation} size={20} /> {meetingLocation(calendarInfo.meetingLocation).label}
              </p>
            )}
            {selectedSlot ? (
              <>
                <p key={selectedSlot.startUTC} className="flex items-center gap-3 font-medium bw-fade">
                  <CalendarDays size={18} className="text-gray-500 shrink-0" />
                  {slotTimeLabel(selectedSlot.startUTC, timezone)} - {slotTimeLabel(selectedSlot.endUTC, timezone)} ,{" "}
                  {dayKeyLabel(dateKeyInZone(new Date(selectedSlot.startUTC), timezone))}
                </p>
                <p className="flex items-center gap-3 font-medium bw-fade">
                  <Globe size={18} className="text-gray-500 shrink-0" /> {tzLabel(timezone)}
                </p>
              </>
            ) : (
              selectedDayKey && (
                <p className="flex items-center gap-3 font-medium">
                  <CalendarDays size={18} className="text-gray-500 shrink-0" /> {dayKeyLabel(selectedDayKey)}
                </p>
              )
            )}
          </div>
          {calendarInfo.description && (
            <p className="mt-5 text-sm text-gray-600 leading-relaxed whitespace-pre-line break-words">{calendarInfo.description}</p>
          )}
          {/* The "be somewhere quiet" note is for choosing a time — not shown once a time is picked. */}
          {!selectedSlot && !calendarInfo.hideLocationNote && meetingLocation(calendarInfo.meetingLocation) && (
            <div className="mt-5 flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <LocationLogo value={calendarInfo.meetingLocation} size={28} />
              <p className="text-sm text-gray-800 leading-snug">{meetingLocation(calendarInfo.meetingLocation).note}</p>
            </div>
          )}
          {rescheduling && (
            <p className="text-sm text-gray-700 mt-5">
              Pick a new time.{" "}
              <button type="button" onClick={() => { setRescheduling(false); setSelectedSlot(null); }} className="text-gray-400 hover:text-gray-700 underline">
                Back
              </button>
            </p>
          )}
        </aside>

        <section className="flex-1 min-w-0 flex flex-col">
        {!selectedSlot ? (
          <div className={`p-5 sm:p-8 ${anim === "picker" ? "bw-in-back" : ""}`}>
            <h2 className={`${mobileTimesOpen ? "hidden lg:block" : ""} text-lg sm:text-xl font-medium text-gray-900 mb-5`}>Select Date &amp; Time</h2>
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
              <div
                key={`cal-${mobileTimesOpen}`}
                className={`${mobileTimesOpen ? "hidden lg:block" : ""} ${anim === "calendar" ? "bw-in-back" : ""} flex-1 min-w-0`}
              >
                <div className="flex items-center justify-center gap-4 sm:gap-8 mb-4">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => { stopAutoPick(); setMonthKey((m) => addMonths(m, -1)); }}
                    disabled={atFirstMonth}
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:text-gray-300 disabled:hover:bg-transparent"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="text-base sm:text-lg font-medium text-gray-900 w-44 text-center">{monthLabel(monthKey)}</span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => { stopAutoPick(); setMonthKey((m) => addMonths(m, 1)); }}
                    className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                <div className="grid grid-cols-7 text-center text-sm sm:text-base font-medium text-gray-900 mb-3">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-y-1.5 sm:gap-y-2 text-center">
                  {cells.map((key, i) => {
                    if (!key) return <div key={`blank-${i}`} />;
                    const active = key === selectedDayKey;
                    // Days stay plain while the month is still loading, so they
                    // don't flash as unavailable.
                    const available = (slotsByDay[key] || []).length > 0;
                    const disabled = !active && (loadingSlots || !available);
                    return (
                      <div key={key} className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            stopAutoPick();
                            setSelectedDayKey(key);
                            if (window.matchMedia("(max-width: 1023px)").matches) {
                              setAnim("times");
                              setMobileTimesOpen(true);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }
                          }}
                          disabled={disabled}
                          className={`relative shrink-0 aspect-square h-10 w-10 sm:h-12 sm:w-12 rounded-full text-sm sm:text-base ${
                            active
                              ? "bg-blue-600 text-white font-semibold"
                              : available && !loadingSlots
                              ? "bg-blue-50 text-blue-600 font-semibold hover:bg-blue-100"
                              : "text-gray-400 cursor-default"
                          }`}
                        >
                          {Number(key.slice(8))}
                          {key === todayKey && (
                            <span
                              className={`absolute left-1/2 -translate-x-1/2 bottom-1 h-1 w-1 rounded-full ${
                                active ? "bg-white" : "bg-blue-500"
                              }`}
                            />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-5 max-w-sm">
                  <label className="text-sm sm:text-base font-medium block mb-2 text-gray-900">Time zone</label>
                  <Dropdown value={timezone} onChange={setTimezone} options={tzOptions} searchable />
                </div>
              </div>

              <div
                key={`times-${mobileTimesOpen}`}
                className={`${mobileTimesOpen ? "" : "hidden lg:block"} ${anim === "times" && mobileTimesOpen ? "bw-in" : ""} lg:w-64 xl:w-72 shrink-0`}
              >
                {selectedDayKey && (
                  <div className="lg:hidden mb-5">
                    <div className="relative flex items-center justify-center min-h-[3.5rem]">
                      <button
                        type="button"
                        aria-label="Back to calendar"
                        onClick={() => { setAnim("calendar"); setMobileTimesOpen(false); setPendingSlotStart(null); }}
                        className="absolute left-0 h-12 w-12 flex items-center justify-center rounded-full border border-gray-200 text-blue-600 hover:bg-gray-50"
                      >
                        <ArrowLeft size={22} />
                      </button>
                      <div className="text-center">
                        <p className="text-xl font-semibold text-gray-900">{dayKeyPart(selectedDayKey, { weekday: "long" })}</p>
                        <p className="text-sm text-gray-500 mt-0.5">{dayKeyPart(selectedDayKey, { month: "long", day: "numeric", year: "numeric" })}</p>
                      </div>
                    </div>
                    <div className="mt-5">
                      <label className="text-sm font-medium block mb-2 text-gray-900">Time zone</label>
                      <Dropdown value={timezone} onChange={setTimezone} options={tzOptions} searchable />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 text-center mt-6">Choose Time Slot</h3>
                    <p className="text-sm text-gray-500 text-center mt-1">Duration : {calendarInfo.eventLengthMinutes} min</p>
                  </div>
                )}
                {loadingSlots ? (
                  <div className="flex justify-center py-10">
                    <Loader2 size={18} className="animate-spin text-gray-400" />
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-10">No available times on this day.</p>
                ) : (
                  <div className={`flex flex-col gap-2.5 ${autoSized ? "" : "lg:max-h-[27rem] lg:overflow-y-auto lg:pr-2"}`}>
                    {slots.map((s) =>
                      pendingSlotStart === s.startUTC ? (
                        <div key={s.startUTC} className="shrink-0 grid grid-cols-2 gap-2 bw-pop">
                          <button
                            type="button"
                            onClick={() => setPendingSlotStart(null)}
                            className="rounded py-3 text-sm sm:text-base font-semibold text-white bg-gray-500 border border-gray-500"
                          >
                            {slotTimeLabel(s.startUTC, timezone)}
                          </button>
                          <button
                            type="button"
                            onClick={() => goToForm(s)}
                            className="rounded py-3 text-sm sm:text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 border border-blue-600"
                          >
                            Select
                          </button>
                        </div>
                      ) : (
                        <button
                          key={s.startUTC}
                          onClick={() => setPendingSlotStart(s.startUTC)}
                          className="shrink-0 border border-blue-600 rounded py-3 text-sm sm:text-base font-semibold text-blue-600 hover:bg-blue-50"
                        >
                          {slotTimeLabel(s.startUTC, timezone)}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : rescheduling ? (
          <div className="p-6 max-w-sm mx-auto space-y-4">
            <button type="button" onClick={backToPicker} className="text-xs text-gray-400 hover:text-gray-700">
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
          <form onSubmit={submitBooking} className="flex-1 p-6 sm:p-8 flex flex-col bw-in">
            <h2 className="text-xl sm:text-2xl font-medium text-gray-900 mb-6">Enter details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              <div>
                <label className="text-sm sm:text-base font-medium block mb-2 text-gray-900">First name *</label>
                <input
                  required
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="text-sm sm:text-base font-medium block mb-2 text-gray-900">Last name *</label>
                <input
                  required
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="text-sm sm:text-base font-medium block mb-2 text-gray-900">Phone *</label>
                <div className="flex items-center border border-gray-300 rounded-lg focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600">
                  <label className="relative flex items-center gap-1.5 pl-4 pr-2 py-3 cursor-pointer" aria-label="Country">
                    <Flag code={form.country} />
                    <span className="text-[10px] text-gray-600">▼</span>
                    <select
                      value={form.country}
                      onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    >
                      {PHONE_COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name} (+{c.dial})
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    required
                    type="tel"
                    autoComplete="tel"
                    placeholder={form.country === "AU" ? "0412 345 678" : ""}
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="flex-1 min-w-0 pr-4 py-3 text-base text-gray-900 bg-transparent outline-none placeholder:text-gray-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm sm:text-base font-medium block mb-2 text-gray-900">Email *</label>
                <div className="flex items-center border border-gray-300 rounded-lg focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600">
                  <Mail size={20} className="ml-4 text-gray-500 shrink-0" />
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="flex-1 min-w-0 px-3 py-3 text-base text-gray-900 bg-transparent outline-none"
                  />
                </div>
              </div>
              {!embedOptions.hideNotes && (
                <div className="sm:col-span-2">
                  <label className="text-sm sm:text-base font-medium block mb-2 text-gray-900">Additional information</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={4}
                    placeholder="Is there anything you would like us to know before your appointment?"
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 resize-none placeholder:text-gray-400"
                  />
                </div>
              )}
              {requireCommit && (
                <div className="sm:col-span-2">
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <p className="text-sm text-gray-800 mb-3">
                    {(calendarInfo.attendanceConfirmText || ATTENDANCE_CONFIRM_DEFAULT).split("{time}").map((part, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="font-semibold">{commitWhen(selectedSlot.startUTC, timezone)}</span>}
                        {part}
                      </Fragment>
                    ))}
                  </p>
                  <label className="flex items-start gap-2.5 text-sm font-medium text-gray-900 cursor-pointer">
                    <input
                      type="checkbox"
                      required
                      checked={committed}
                      onChange={(e) => setCommitted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-blue-600"
                    />
                    Yes I keep my word and will show up to the call
                  </label>
                </div>
                </div>
              )}
            </div>
            {bookError && <p className="text-sm text-red-600 mt-5">{bookError}</p>}
            <div className="mt-8 sm:mt-auto pt-2 sm:pt-10 flex justify-end">
              <button
                type="submit"
                disabled={submitting || (requireCommit && !committed)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-base px-7 py-3.5 rounded-lg font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                Schedule meeting
              </button>
            </div>
          </form>
        )}
        </section>
      </div>
    </div>
  );
}
