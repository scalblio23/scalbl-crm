import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import {
  MessageSquare,
  Users,
  Phone,
  Briefcase,
  Settings,
  Search,
  Plus,
  PhoneCall,
  PhoneOff,
  Circle,
  ExternalLink,
  X,
  AlertTriangle,
  ListChecks,
  Trash2,
  ClipboardList,
  Pencil,
  LayoutGrid,
  Table2,
  Upload,
  Loader2,
  LogOut,
  Lock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Filter,
  ChevronDown,
  BarChart3,
  CheckCircle2,
  Copy,
  RefreshCw,
  Send,
  Layers,
  Play,
  Mic,
  Square,
  Calendar,
  Clock,
  Link2,
  Globe,
  MapPin,
} from "lucide-react";
import { placeCall, hangUp, joinConference, playSoundboardClip } from "./lib/twilioDevice";
import { api } from "./lib/api";
import Dropdown from "./components/Dropdown";
import {
  timezoneOptions,
  detectBrowserTimezone,
  timeOfDayOptions,
  EVENT_LENGTH_OPTIONS,
  BUFFER_OPTIONS,
  MIN_NOTICE_OPTIONS,
  BOOKING_WINDOW_OPTIONS,
  WEEKDAYS,
} from "./lib/calendarOptions";

// ---------- Sample data ----------
const initialContacts = [
  {
    id: 1,
    name: "Sarah Mitchell",
    email: "sarah.mitchell@gmail.com",
    phone: "0412 334 556",
    client: "Lux Solar",
    status: "New Lead",
    lastContact: "Today",
    notes: "Interested in the battery rebate, wants a quote by Friday.",
    createdAt: "2026-08-25T10:32:00",
  },
  {
    id: 2,
    name: "David Chen",
    email: "david.chen@outlook.com",
    phone: "0433 221 908",
    client: "Lux Solar",
    status: "Contacted",
    lastContact: "Yesterday",
    notes: "Asked to be called back after 5pm.",
    createdAt: "2026-08-24T15:40:00",
  },
  {
    id: 3,
    name: "Emma Taylor",
    email: "emma.taylor@bigpond.com",
    phone: "0401 887 234",
    client: "Stoprent Properties",
    status: "Booked",
    lastContact: "Mon",
    notes: "Confirmed inspection for Thursday 2pm.",
    createdAt: "2026-08-23T09:00:00",
  },
  {
    id: 4,
    name: "James Wilson",
    email: "james.wilson@yahoo.com",
    phone: "0455 112 763",
    client: "Silverloom Advisory",
    status: "New Lead",
    lastContact: "Today",
    notes: "Referred by an existing client, wants a callback.",
    createdAt: "2026-08-25T08:15:00",
  },
  {
    id: 5,
    name: "Priya Sharma",
    email: "priya.sharma@hotmail.com",
    phone: "0422 645 190",
    client: "Lasertronics",
    status: "No Answer",
    lastContact: "Tue",
    notes: "Left a voicemail, try again next week.",
    createdAt: "2026-08-19T13:20:00",
  },
  {
    id: 6,
    name: "Tom Nguyen",
    email: "tom.nguyen@gmail.com",
    phone: "0466 903 415",
    client: "Stoprent Properties",
    status: "Contacted",
    lastContact: "Today",
    notes: "Asking about deposit requirements.",
    createdAt: "2026-08-25T11:05:00",
  },
];

const initialClients = [
  {
    id: 1,
    name: "Lux Solar",
    industry: "Solar",
    leads: 42,
    adsLive: true,
    script: "https://scripts.scalbl.io/lux-solar",
    scriptSteps: [
      "Introduce yourself and confirm you're calling about their battery rebate enquiry.",
      "Confirm they own the property and have north/west-facing roof space.",
      "Explain the current rebate amount and typical payback period.",
      "Offer a free site assessment and lock in a time.",
      "If hesitant, offer to send the rebate breakdown by email.",
    ],
  },
  {
    id: 2,
    name: "Stoprent Properties",
    industry: "Property",
    leads: 31,
    adsLive: true,
    script: "https://scripts.scalbl.io/stoprent-properties",
    scriptSteps: [
      "Introduce yourself and confirm which listing they enquired about.",
      "Ask their preferred move-in date and household size.",
      "Confirm budget range and any must-have features.",
      "Offer an inspection time and confirm the best contact number.",
      "Send a calendar invite once a time is agreed.",
    ],
  },
  {
    id: 3,
    name: "Silverloom Advisory",
    industry: "Finance",
    leads: 18,
    adsLive: true,
    script: "https://scripts.scalbl.io/silverloom-advisory",
    scriptSteps: [
      "Introduce yourself and confirm they requested a financial review.",
      "Ask what prompted the enquiry (super, investing, insurance, etc.).",
      "Briefly explain the free initial consultation and what it covers.",
      "Book a call with an advisor and confirm timezone.",
      "Note any sensitive details in Notes rather than over email.",
    ],
  },
  {
    id: 4,
    name: "Lasertronics",
    industry: "Office Equipment",
    leads: 9,
    adsLive: false,
    script: "https://scripts.scalbl.io/lasertronics",
    scriptSteps: [
      "Introduce yourself and confirm the equipment they enquired about.",
      "Ask about current setup, page volume, and lease end date if any.",
      "Explain the current promo pricing and service inclusions.",
      "Offer to send a tailored quote by email.",
      "If no answer, leave a voicemail and log a follow-up for next week.",
    ],
  },
];

const initialConversations = [];

const statusColors = {
  "New Lead": "bg-blue-50 text-blue-700 border-blue-200",
  Contacted: "bg-amber-50 text-amber-700 border-amber-200",
  Booked: "bg-green-50 text-green-700 border-green-200",
  "No Answer": "bg-gray-50 text-gray-500 border-gray-200",
};

// ---------- Dynamic columns (shared by the Client table and the
// Contact table — same column types, same storage pattern: a
// `_columns` metadata table plus a `fields` JSONB blob per row) ----------
const COLUMN_TYPES = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency ($)" },
  { value: "url", label: "URL" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown select" },
  { value: "checkbox", label: "Checkbox" },
];

const SELECT_COLORS = {
  gray: "bg-gray-50 text-gray-600 border-gray-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-green-50 text-green-700 border-green-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
};
const SELECT_COLOR_CYCLE = ["blue", "green", "amber", "red", "purple", "gray"];

function formatDynamicCellDisplay(col, value) {
  if (value === null || value === undefined || value === "") return null;
  if (col.type === "currency") {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (col.type === "date") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  return String(value);
}

// One-line/simple input for a dynamic column's value, used by the Add
// Contact modal to collect custom fields on a brand-new row (as
// opposed to renderClientCell/renderContactCell below, which render
// an existing row's cell in view vs. inline-edit mode).
function renderDynamicFieldInput(col, value, onChange) {
  if (col.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300"
      />
    );
  }
  if (col.type === "select") {
    return (
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 bg-white"
      >
        <option value="">—</option>
        {(col.options || []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.value}
          </option>
        ))}
      </select>
    );
  }
  if (col.type === "long_text") {
    return (
      <textarea
        rows={3}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400 resize-y"
      />
    );
  }
  const inputType =
    col.type === "number" || col.type === "currency" ? "number" : col.type === "date" ? "date" : col.type === "url" ? "url" : "text";
  return (
    <input
      type={inputType}
      step={col.type === "currency" ? "0.01" : undefined}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
    />
  );
}

function formatCallDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// One multi-line dial candidate's status → a friendly label/color for
// the "Dialling N lines" panel. Mirrors the statuses a Twilio call
// leg actually reports (see api/multiline-status.js).
const MULTILINE_STATUS_LABELS = {
  placed: "Dialling…",
  queued: "Dialling…",
  initiated: "Dialling…",
  ringing: "Ringing…",
  "in-progress": "Answered",
  completed: "Ended",
  busy: "Busy",
  failed: "Failed",
  "no-answer": "No answer",
  canceled: "Cancelled",
};
function multilineStatusLabel(status) {
  return MULTILINE_STATUS_LABELS[status] || status || "Dialling…";
}
function multilineStatusColor(status) {
  if (status === "in-progress") return "bg-green-100 text-green-700";
  if (status === "placed" || status === "ringing") return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-500";
}

// ---------- Sidebar ----------
const navItems = [
  { key: "conversation", label: "Conversation", icon: MessageSquare },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "powerdialler", label: "Powerdialler", icon: Phone },
  { key: "multiline", label: "Multi Line", icon: Layers },
  { key: "bulk-sms", label: "Bulk SMS", icon: Send },
  { key: "log", label: "Log", icon: ClipboardList },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "clients", label: "Clients", icon: Briefcase },
  { key: "calendars", label: "Calendars", icon: Calendar },
  { key: "settings", label: "Settings", icon: Settings },
];

// Calendar settings' left mini-nav — Integrate → Timezone → Availability
// → Booking rules → Share & embed, per the sidebar tab → Add Calendar →
// Calendar settings → options flow.
const CALENDAR_SETTINGS_SECTIONS = [
  { key: "integrate", label: "Integrate", icon: Globe },
  { key: "timezone", label: "Timezone", icon: Clock },
  { key: "availability", label: "Availability", icon: Calendar },
  { key: "rules", label: "Booking rules", icon: ListChecks },
  { key: "share", label: "Share & embed", icon: Link2 },
];

export default function SimpleCRM() {
  const [page, setPage] = useState("conversation");

  // ---------- Auth ----------
  // Checked once on mount via the session cookie. Everything else in
  // this component (the database bootstrap fetch included) waits for
  // this to resolve — there's no "logged out" flash of real data
  // because nothing else fetches until authUser is set.
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login"); // "login" | "setup"
  const [authForm, setAuthForm] = useState({ email: "", password: "", confirm: "" });
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user } = await api.get("/api/auth-me");
        if (!cancelled) setAuthUser(user);
      } catch {
        // Treated as logged out — the login screen below handles it.
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    const email = authForm.email.trim();
    const password = authForm.password;
    if (!email || !password) {
      setAuthError("Enter your email and password.");
      return;
    }
    if (authMode === "setup" && password !== authForm.confirm) {
      setAuthError("Passwords don't match.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const path = authMode === "setup" ? "/api/auth-set-password" : "/api/auth-login";
      const { user } = await api.post(path, { email, password });
      setAuthUser(user);
    } catch (err) {
      setAuthError(err.message || "Something went wrong.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post("/api/auth-logout", {});
    } catch {
      // Cookie may already be gone — reload regardless.
    }
    window.location.reload();
  };

  // Start empty rather than pre-filled with the sample data — that
  // data is only ever a fallback for when the database fetch below
  // genuinely fails, not something to flash on screen while it's
  // still loading (that made deleted leads look like they'd come
  // back, and real conversations look like they'd disappeared, for
  // however long the initial fetch took).
  const [contacts, setContacts] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientColumns, setClientColumns] = useState([]); // dynamic custom columns for the client table
  const [contactColumns, setContactColumns] = useState([]); // dynamic custom columns for the contact table
  // STAGE is a custom column like any other, but it's the one piece of
  // pipeline state every list of leads needs to show regardless of
  // which client/tag is being viewed — so it's pulled out and shown
  // as its own fixed column (Contacts + Powerdialler tables) instead
  // of being folded into the "imported criteria" columns, which only
  // render when data narrows them into view and can end up scrolled
  // out of sight.
  const stageColumnDef = contactColumns.find((c) => c.key === "stage");

  // Which custom Contacts columns the user has chosen to hide from the
  // table — a display-only preference, kept per-browser since it's not
  // data anyone else needs to see. With 226+ imported criteria columns,
  // letting people trim the table down to what they actually look at
  // matters a lot more than it would with a handful of columns.
  const [hiddenContactColumnKeys, setHiddenContactColumnKeys] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("scalbl:hiddenContactColumns") || "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("scalbl:hiddenContactColumns", JSON.stringify([...hiddenContactColumnKeys]));
    } catch {
      // ignore — private browsing / storage disabled
    }
  }, [hiddenContactColumnKeys]);
  const toggleContactColumnHidden = (key) =>
    setHiddenContactColumnKeys((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [columnSettingsSearch, setColumnSettingsSearch] = useState("");
  const [conversations, setConversations] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [selectedConvoIds, setSelectedConvoIds] = useState([]);
  const [search, setSearch] = useState("");

  // Loads everything from the database on mount. If the request fails
  // (database not configured yet, network issue, …) the sample data
  // above stays in place so the app is still usable, and a banner
  // explains that changes won't be saved until it's fixed.
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  useEffect(() => {
    if (!authUser) return; // wait for login before fetching any CRM data
    let cancelled = false;
    (async () => {
      try {
        const {
          clients: clientsData,
          clientColumns: clientColumnsData,
          contacts: contactsData,
          contactColumns: contactColumnsData,
          conversations: conversationsData,
          dialLists: dialListsData,
          callLog: callLogData,
        } = await api.get("/api/bootstrap");
        if (cancelled) return;
        setClients(clientsData);
        setClientColumns(clientColumnsData);
        setContacts(contactsData);
        setContactColumns(contactColumnsData);
        setConversations(conversationsData);
        setDialLists(dialListsData);
        setCallLog(callLogData);
      } catch (err) {
        if (!cancelled) {
          // Genuine failure (DB not configured, network issue, …) —
          // fall back to the built-in sample data so the app is still
          // usable, rather than sitting empty.
          setClients(initialClients);
          setContacts(initialContacts);
          setConversations(initialConversations);
          setDbError(
            err.message ||
              "Could not load data from the database — showing sample data instead. Changes won't be saved."
          );
        }
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // ---------- Calendars ----------
  // Loaded lazily the first time the tab is opened rather than as
  // part of /api/bootstrap — a brand-new team has zero calendars, and
  // there's no reason to make every page load wait on a fetch for a
  // tab most sessions never visit.
  const [calendars, setCalendars] = useState([]);
  const [calendarsLoaded, setCalendarsLoaded] = useState(false);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const [openCalendarId, setOpenCalendarId] = useState(null);
  const [calendarSettingsTab, setCalendarSettingsTab] = useState("integrate");
  const [showAddCalendarModal, setShowAddCalendarModal] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [addingCalendar, setAddingCalendar] = useState(false);
  const [calendarBookings, setCalendarBookings] = useState([]);
  const [savingCalendar, setSavingCalendar] = useState(false);

  const loadCalendars = async () => {
    setCalendarsLoading(true);
    try {
      const data = await api.get("/api/calendars");
      setCalendars(data);
    } catch {
      // Left as whatever was already loaded — the Calendars tab shows
      // its own inline error state rather than a global banner.
    } finally {
      setCalendarsLoading(false);
      setCalendarsLoaded(true);
    }
  };

  useEffect(() => {
    if (page === "calendars" && !calendarsLoaded && !calendarsLoading) loadCalendars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Picks up ?calendar=<id>&google=connected|error after the "Integrate
  // with Google" OAuth round trip lands back on the CRM (see
  // api/calendar-google-callback.js) — reopens that calendar's
  // Integrate section and refreshes its state so the newly-connected
  // account shows up immediately.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    const calendarParam = params.get("calendar");
    if (!google) return;
    setPage("calendars");
    setCalendarSettingsTab("integrate");
    if (calendarParam) setOpenCalendarId(Number(calendarParam));
    loadCalendars();
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCalendar = calendars.find((c) => c.id === openCalendarId) || null;
  const timezoneDropdownOptions = useMemo(() => timezoneOptions(), []);
  const timeOfDayDropdownOptions = useMemo(() => timeOfDayOptions(), []);

  useEffect(() => {
    if (!openCalendarId) return;
    api
      .get(`/api/calendar-bookings?calendarId=${openCalendarId}`)
      .then(setCalendarBookings)
      .catch(() => setCalendarBookings([]));
  }, [openCalendarId]);

  // Availability and booking-rules edits are drafted locally and saved
  // with an explicit button (like the rest of Settings) rather than
  // patching the server on every click — editing a weekly hours grid
  // one field at a time would otherwise fire a save per keystroke.
  const [availabilityDraft, setAvailabilityDraft] = useState(null);
  const [rulesDraft, setRulesDraft] = useState(null);
  useEffect(() => {
    if (!openCalendar) return;
    setAvailabilityDraft(openCalendar.availability);
    setRulesDraft({
      eventLengthMinutes: String(openCalendar.eventLengthMinutes),
      bufferMinutes: String(openCalendar.bufferMinutes),
      minNoticeHours: String(openCalendar.minNoticeHours),
      bookingWindowDays: String(openCalendar.bookingWindowDays),
      maxBookingsPerDay: openCalendar.maxBookingsPerDay == null ? "" : String(openCalendar.maxBookingsPerDay),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCalendar?.id]);

  const setDayRange = (day, index, key, value) =>
    setAvailabilityDraft((draft) => ({
      ...draft,
      [day]: draft[day].map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    }));
  const addDayRange = (day) =>
    setAvailabilityDraft((draft) => ({ ...draft, [day]: [...(draft[day] || []), { start: "09:00", end: "17:00" }] }));
  const removeDayRange = (day, index) =>
    setAvailabilityDraft((draft) => ({ ...draft, [day]: draft[day].filter((_, i) => i !== index) }));
  const toggleDayEnabled = (day) =>
    setAvailabilityDraft((draft) => ({
      ...draft,
      [day]: draft[day]?.length ? [] : [{ start: "09:00", end: "17:00" }],
    }));

  const handleAddCalendar = async (e) => {
    e.preventDefault();
    if (!newCalendarName.trim()) return;
    setAddingCalendar(true);
    try {
      const calendar = await api.post("/api/calendars", { name: newCalendarName.trim() });
      setCalendars((cs) => [...cs, calendar]);
      setNewCalendarName("");
      setShowAddCalendarModal(false);
      setOpenCalendarId(calendar.id);
      setCalendarSettingsTab("integrate");
    } catch (err) {
      alert(err.message || "Could not create the calendar");
    } finally {
      setAddingCalendar(false);
    }
  };

  const patchCalendar = async (id, patch) => {
    setSavingCalendar(true);
    try {
      const updated = await api.patch(`/api/calendars?id=${id}`, patch);
      setCalendars((cs) => cs.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      alert(err.message || "Could not save that change");
    } finally {
      setSavingCalendar(false);
    }
  };

  const deleteCalendar = async (id) => {
    if (!window.confirm("Delete this calendar? Its booking link will stop working.")) return;
    try {
      await api.delete(`/api/calendars?id=${id}`);
      setCalendars((cs) => cs.filter((c) => c.id !== id));
      if (openCalendarId === id) setOpenCalendarId(null);
    } catch (err) {
      alert(err.message || "Could not delete the calendar");
    }
  };

  const connectGoogleCalendar = (id) => {
    window.location.href = `/api/calendar-google-connect?calendarId=${id}`;
  };

  const disconnectGoogleCalendar = async (id) => {
    try {
      const updated = await api.post("/api/calendar-google-disconnect", { calendarId: id });
      setCalendars((cs) => cs.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      alert(err.message || "Could not disconnect Google");
    }
  };

  const cancelCalendarBooking = async (id) => {
    if (!window.confirm("Cancel this booking?")) return;
    try {
      await api.delete(`/api/calendar-bookings?id=${id}`);
      setCalendarBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)));
    } catch (err) {
      alert(err.message || "Could not cancel the booking");
    }
  };

  // Add-contact modal
  const emptyContactForm = {
    name: "",
    email: "",
    phone: "",
    client: initialClients[0]?.name || "",
    status: "New Lead",
    notes: "",
    fields: {},
    leadDate: "",
    tag: "",
  };
  const [showAddContact, setShowAddContact] = useState(false);
  const [showMoreContactFields, setShowMoreContactFields] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContactForm);
  const updateContactForm = (key, value) =>
    setContactForm((f) => ({ ...f, [key]: value }));
  const updateContactFormField = (key, value) =>
    setContactForm((f) => ({ ...f, fields: { ...f.fields, [key]: value } }));

  const handleAddContact = async (e) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.phone.trim()) return;
    const payload = {
      ...contactForm,
      name: contactForm.name.trim(),
      phone: contactForm.phone.trim(),
      lastContact: "Today",
    };
    try {
      const created = await api.post("/api/contacts", payload);
      setContacts((cs) => [...cs, created]);
      setContactForm(emptyContactForm);
      setShowAddContact(false);
    } catch (err) {
      setDbError(err.message || "Could not save the new contact — try again.");
    }
  };

  // Powerdialler state
  const [calling, setCalling] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState(null);
  const emptyDialFilters = {
    leadDate: "",
    name: "",
    email: "",
    phone: "",
    client: "All",
    notes: "",
    status: "All",
  };
  const [dialFilters, setDialFilters] = useState(emptyDialFilters);
  // Per-custom-column filters, so leads can be filtered/excluded by
  // any imported criteria too, not just the fixed columns above.
  // Select/checkbox columns (e.g. Stage) get an exclude-checklist —
  // check "Booked" and "Not Interested" to hide those leads from the
  // dial queue. Everything else gets a plain substring text filter.
  const [dialFieldExcludes, setDialFieldExcludes] = useState({}); // { [columnKey]: string[] of values to hide }
  const [dialFieldTextFilters, setDialFieldTextFilters] = useState({}); // { [columnKey]: string }
  const toggleDialFieldExclude = (key, value) =>
    setDialFieldExcludes((f) => {
      const current = f[key] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...f, [key]: next };
    });
  const updateDialFieldTextFilter = (key, value) => setDialFieldTextFilters((f) => ({ ...f, [key]: value }));
  const [openDialExcludeMenu, setOpenDialExcludeMenu] = useState(null); // column key whose checklist is open, or null

  // Filter-row cell for one custom column in the Powerdialler table —
  // an exclude-checklist for select/checkbox columns, a plain text
  // filter for everything else. Shared by the fixed Stage column and
  // every column in visibleDialColumns, so both filter the same way.
  const renderDialColumnFilter = (col) =>
    col.type === "select" || col.type === "checkbox" ? (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenDialExcludeMenu((k) => (k === col.key ? null : col.key))}
          className={`w-full flex items-center justify-between gap-1 border rounded-md px-2 py-1.5 text-xs font-normal normal-case bg-white ${
            (dialFieldExcludes[col.key] || []).length ? "border-red-300 text-red-700" : "border-gray-200 text-gray-500"
          }`}
        >
          <span className="truncate">
            {(dialFieldExcludes[col.key] || []).length ? `Hiding ${dialFieldExcludes[col.key].length}` : "Hide…"}
          </span>
          <Filter size={11} className="shrink-0" />
        </button>
        {openDialExcludeMenu === col.key && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenDialExcludeMenu(null)} />
            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-48 max-h-56 overflow-y-auto normal-case">
              <div className="text-xs font-semibold text-gray-400 px-1 pb-1">Hide leads where {col.label} is…</div>
              {(col.type === "checkbox" ? ["Yes", "No"] : col.options || []).map((opt) => {
                const value = typeof opt === "string" ? opt : opt.value;
                const checked = (dialFieldExcludes[col.key] || []).includes(value);
                return (
                  <label
                    key={value}
                    className="flex items-center gap-2 px-1 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDialFieldExclude(col.key, value)}
                      className="w-3.5 h-3.5 rounded border-gray-300"
                    />
                    <span className="truncate">{value}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>
    ) : (
      <input
        value={dialFieldTextFilters[col.key] || ""}
        onChange={(e) => updateDialFieldTextFilter(col.key, e.target.value)}
        placeholder="Filter…"
        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
      />
    );

  // Secondary sidebar (Contacts) — quick-click tag list, "All" shows
  // everyone. A contact's tag is free text — for imported leads, the
  // name of the sheet tab/client they came from (e.g. "9. Khan
  // Legal"); for anything else it's whatever was typed into the Add
  // Contact modal, or left blank ("Untagged").
  const contactTagCounts = contacts.reduce((acc, c) => {
    const t = c.tag || "Untagged";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const contactTagNames = Array.from(new Set(contacts.map((c) => c.tag).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  // Stable color per tag — cycles through the same palette used for
  // client-column select options, keyed by each tag's position in the
  // sorted list so a given tag always gets the same color this session.
  const tagColorClasses = (tag) => {
    const idx = contactTagNames.indexOf(tag);
    if (idx === -1) return SELECT_COLORS.gray;
    return SELECT_COLORS[SELECT_COLOR_CYCLE[idx % SELECT_COLOR_CYCLE.length]] || SELECT_COLORS.gray;
  };

  // Filter bar (Contacts) — any number of filters, each on any
  // column (fixed fields or any of the imported criteria), each with
  // is / is not / is empty / is not empty. "is"/"is not" means
  // "equals" for a select/checkbox column and "contains" (substring,
  // case-insensitive) for anything else, so free-text columns still
  // get useful search-style filtering. All filters AND together.
  const contactFilterColumns = [
    { key: "__name", label: "Name", kind: "text", get: (c) => c.name },
    { key: "__email", label: "Email", kind: "text", get: (c) => c.email },
    { key: "__phone", label: "Phone", kind: "text", get: (c) => c.phone },
    { key: "__client", label: "Client", kind: "text", get: (c) => c.client },
    { key: "__tag", label: "Tag", kind: "select", options: contactTagNames, get: (c) => c.tag },
    {
      key: "__status",
      label: "Status",
      kind: "select",
      options: Object.keys(statusColors),
      optionColor: (v) => statusColors[v],
      get: (c) => c.status,
    },
    { key: "__leadDate", label: "Date", kind: "text", get: (c) => c.leadDate },
    { key: "__notes", label: "Notes", kind: "text", get: (c) => c.notes },
    { key: "__lastContact", label: "Last contact", kind: "text", get: (c) => c.lastContact },
    ...contactColumns.map((col) => ({
      key: col.key,
      label: col.label,
      kind: col.type === "select" || col.type === "checkbox" ? "select" : "text",
      options: col.type === "select" ? (col.options || []).map((o) => o.value) : col.type === "checkbox" ? ["Yes", "No"] : null,
      optionColor:
        col.type === "select"
          ? (v) => selectOptionColor(col, v)
          : col.type === "checkbox"
          ? (v) => (v === "Yes" ? SELECT_COLORS.green : SELECT_COLORS.gray)
          : null,
      get: (c) => (col.type === "checkbox" ? (c.fields?.[col.key] ? "Yes" : "No") : c.fields?.[col.key]),
    })),
  ];
  const contactFilterColumnsByKey = Object.fromEntries(contactFilterColumns.map((c) => [c.key, c]));

  const nextContactFilterIdRef = useRef(1);
  const [contactFilters, setContactFilters] = useState([]); // [{ id, column, op, value }]
  const [editingContactFilterId, setEditingContactFilterId] = useState(null);
  const addContactFilter = () => {
    const id = nextContactFilterIdRef.current++;
    setContactFilters((fs) => [...fs, { id, column: "__tag", op: "is", value: "" }]);
    setEditingContactFilterId(id);
  };
  const updateContactFilter = (id, patch) =>
    setContactFilters((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeContactFilter = (id) => {
    setContactFilters((fs) => fs.filter((f) => f.id !== id));
    setEditingContactFilterId((cur) => (cur === id ? null : cur));
  };
  // Sidebar shortcut — sets/replaces the one Tag filter rather than
  // stacking duplicates when you click around the tag list.
  const setTagQuickFilter = (op, value) =>
    setContactFilters((fs) => {
      const without = fs.filter((f) => f.column !== "__tag");
      if (op === null) return without;
      const existing = fs.find((f) => f.column === "__tag");
      return [...without, { id: existing?.id ?? nextContactFilterIdRef.current++, column: "__tag", op, value: value ?? "" }];
    });
  const tagQuickFilter = contactFilters.find((f) => f.column === "__tag");

  const contactMatchesFilters = (c) =>
    contactFilters.every((f) => {
      const colDef = contactFilterColumnsByKey[f.column];
      if (!colDef) return true;
      const raw = colDef.get(c);
      const val = raw === null || raw === undefined ? "" : String(raw);
      if (f.op === "is empty") return val === "";
      if (f.op === "is not empty") return val !== "";
      if (colDef.kind === "select") {
        const eq = val === f.value;
        return f.op === "is" ? eq : !eq;
      }
      const contains = val.toLowerCase().includes((f.value || "").toLowerCase());
      return f.op === "is" ? contains : !contains;
    });

  const filteredContacts = contacts.filter(
    (c) =>
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.client.toLowerCase().includes(search.toLowerCase())) &&
      contactMatchesFilters(c)
  );

  // Sortable by clicking any column header — Date and every other
  // fixed/custom column. null key = whatever order the database
  // returned (newest-created first).
  const [contactSort, setContactSort] = useState({ key: null, dir: "asc" });
  const toggleContactSort = (key) =>
    setContactSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  // "24/11/2025" -> Date. Falls back to a plain Date() parse for
  // anything not in that shape, so a manually-typed date still sorts.
  const parseAuDate = (str) => {
    if (!str) return null;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str).trim());
    if (m) {
      const [, dd, mm, yyyy] = m;
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const FIXED_SORT_KEYS = {
    __leadDate: (c) => parseAuDate(c.leadDate),
    __name: (c) => c.name?.toLowerCase() || null,
    __phone: (c) => c.phone?.toLowerCase() || null,
    __client: (c) => c.client?.toLowerCase() || null,
    __tag: (c) => c.tag?.toLowerCase() || null,
    __status: (c) => c.status?.toLowerCase() || null,
    __lastContact: (c) => c.lastContact?.toLowerCase() || null,
  };
  const getContactSortValue = (c, key) => {
    if (FIXED_SORT_KEYS[key]) return FIXED_SORT_KEYS[key](c);
    const col = contactColumns.find((cc) => cc.key === key);
    const v = c.fields?.[key];
    if (v === null || v === undefined || v === "") return null;
    if (col?.type === "number" || col?.type === "currency") return Number(v);
    if (col?.type === "date") return parseAuDate(v);
    return String(v).toLowerCase();
  };

  const sortedContacts = contactSort.key
    ? [...filteredContacts].sort((a, b) => {
        const va = getContactSortValue(a, contactSort.key);
        const vb = getContactSortValue(b, contactSort.key);
        // Blanks always sink to the bottom, regardless of direction.
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        let cmp;
        if (va instanceof Date && vb instanceof Date) cmp = va.getTime() - vb.getTime();
        else if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        return contactSort.dir === "asc" ? cmp : -cmp;
      })
    : filteredContacts;

  const sortIndicator = (key) => {
    if (contactSort.key !== key) return <ArrowUpDown size={11} className="text-gray-300 shrink-0" />;
    return contactSort.dir === "asc" ? (
      <ArrowUp size={11} className="text-gray-700 shrink-0" />
    ) : (
      <ArrowDown size={11} className="text-gray-700 shrink-0" />
    );
  };

  // Paginated — with thousands of imported leads, rendering every
  // matching row (some tags alone run to 800+) froze the tab. This
  // caps what actually hits the DOM at once; filteredContacts above
  // still drives counts/select-all/export, just not the render.
  const CONTACTS_PAGE_SIZE = 100;
  const [contactsPage, setContactsPage] = useState(0);
  useEffect(() => {
    setContactsPage(0);
  }, [contactFilters, search, contactSort.key, contactSort.dir]);
  const totalContactsPages = Math.max(1, Math.ceil(sortedContacts.length / CONTACTS_PAGE_SIZE));
  const pagedContacts = sortedContacts.slice(
    contactsPage * CONTACTS_PAGE_SIZE,
    (contactsPage + 1) * CONTACTS_PAGE_SIZE
  );

  // Custom columns are per-lead-source (226 of them across every
  // imported tab) — showing all of them for every view meant mostly
  // blank cells and, combined with row count, was the other half of
  // the freeze. Narrow to whatever actually has a value somewhere in
  // the current filter, so picking a tag shows that tag's own
  // criteria instead of 226 columns.
  const hasFieldValue = (v) => v !== null && v !== undefined && v !== "" && v !== false;
  const visibleContactColumns = contactColumns.filter(
    (col) =>
      col.key !== "stage" && // shown as its own fixed column instead — see stageColumnDef
      !hiddenContactColumnKeys.has(col.key) &&
      filteredContacts.some((c) => hasFieldValue(c.fields?.[col.key]))
  );

  // Bulk-select + delete on the Contacts table
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const toggleContactSelected = (id) =>
    setSelectedContactIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const allVisibleContactsSelected =
    pagedContacts.length > 0 && pagedContacts.every((c) => selectedContactIds.includes(c.id));
  const toggleSelectAllContacts = () =>
    setSelectedContactIds((ids) =>
      allVisibleContactsSelected
        ? ids.filter((id) => !pagedContacts.some((c) => c.id === id))
        : [...ids, ...pagedContacts.filter((c) => !ids.includes(c.id)).map((c) => c.id)]
    );

  const deleteSelectedContacts = async () => {
    if (!selectedContactIds.length) return;
    const count = selectedContactIds.length;
    if (!window.confirm(`Delete ${count} contact${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    const ids = selectedContactIds;
    setSelectedContactIds([]);
    setContacts((cs) => cs.filter((c) => !ids.includes(c.id)));
    try {
      await api.delete(`/api/contacts?ids=${ids.join(",")}`);
    } catch (err) {
      setDbError(err.message || "Could not delete the selected contacts.");
    }
  };

  // Bulk-select + delete on the Conversation list
  const toggleConvoSelected = (id) =>
    setSelectedConvoIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const deleteSelectedConvos = async () => {
    if (!selectedConvoIds.length) return;
    const count = selectedConvoIds.length;
    if (!window.confirm(`Delete ${count} conversation${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    const ids = selectedConvoIds;
    setSelectedConvoIds([]);
    setConversations((cs) => cs.filter((c) => !ids.includes(c.id)));
    setActiveConvo((prev) => (ids.includes(prev) ? null : prev));
    try {
      await api.delete(`/api/conversations?ids=${ids.join(",")}`);
    } catch (err) {
      setDbError(err.message || "Could not delete the selected conversations.");
    }
  };

  // Starts a text thread with a contact who doesn't have one yet. Just
  // a client-side placeholder — it becomes a real, saved conversation
  // the moment the first message actually sends.
  const [showNewMessage, setShowNewMessage] = useState(false);
  const startNewConversation = (contactId) => {
    const contact = contacts.find((c) => c.id === Number(contactId));
    if (!contact) return;
    const existing = conversations.find((c) => c.leadId === contact.id);
    setShowNewMessage(false);
    if (existing) {
      setActiveConvo(existing.id);
      return;
    }
    const tempId = `new-${contact.id}`;
    setConversations((cs) => [
      { id: tempId, leadId: contact.id, name: contact.name, preview: "", time: "", unread: false, messages: [] },
      ...cs,
    ]);
    setActiveConvo(tempId);
  };

  const activeConversation = conversations.find((c) => c.id === activeConvo) || null;

  // Outbound SMS — the phone to send to is the linked contact's, or
  // (for a conversation started by an inbound text from an unknown
  // number) the raw number that texted in, which we stash as `name`.
  const activeConversationPhone = activeConversation
    ? contacts.find((c) => c.id === activeConversation.leadId)?.phone ||
      (!activeConversation.leadId ? activeConversation.name : null)
    : null;
  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const handleSendMessage = async () => {
    const text = messageDraft.trim();
    if (!text || !activeConversation || !activeConversationPhone || sendingMessage) return;
    const leadId = activeConversation.leadId;
    setMessageDraft("");
    setSendingMessage(true);
    try {
      await api.post("/api/sms-send", {
        leadId,
        name: activeConversation.name,
        phone: activeConversationPhone,
        text,
      });
      const updated = await api.get("/api/conversations");
      setConversations(updated);
      // A brand-new conversation (started via "New message") had a
      // client-side-only temp id — swap it for the real one the
      // server just created so the thread stays selected.
      const real = leadId ? updated.find((c) => c.leadId === leadId) : null;
      if (real) setActiveConvo(real.id);
    } catch (err) {
      setDbError(err.message || "Could not send the message.");
    } finally {
      setSendingMessage(false);
    }
  };

  // ----- Bulk SMS tab — pick contacts individually or by tag, send
  // the same text to all of them via /api/sms-bulk-send. Its own
  // selection state, independent of the Contacts table's, since it
  // filters/selects over the full `contacts` list rather than one
  // filtered/paginated view. -----
  const [bulkSmsTag, setBulkSmsTag] = useState(""); // "" = all tags
  const [bulkSmsSearch, setBulkSmsSearch] = useState("");
  const [bulkSmsSelectedIds, setBulkSmsSelectedIds] = useState([]);
  const [bulkSmsMessage, setBulkSmsMessage] = useState("");
  const [bulkSmsSending, setBulkSmsSending] = useState(false);
  const [bulkSmsResult, setBulkSmsResult] = useState(null); // { total, sent, failed, skipped } | null

  const BULK_SMS_DISPLAY_LIMIT = 500;
  const bulkSmsFiltered = contacts.filter((c) => {
    if (!c.phone) return false;
    if (bulkSmsTag && (c.tag || "Untagged") !== bulkSmsTag) return false;
    const q = bulkSmsSearch.trim().toLowerCase();
    if (!q) return true;
    return c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q);
  });
  const bulkSmsVisible = bulkSmsFiltered.slice(0, BULK_SMS_DISPLAY_LIMIT);

  const toggleBulkSmsContact = (id) =>
    setBulkSmsSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const allBulkSmsFilteredSelected =
    bulkSmsFiltered.length > 0 && bulkSmsFiltered.every((c) => bulkSmsSelectedIds.includes(c.id));
  const toggleSelectAllBulkSmsFiltered = () =>
    setBulkSmsSelectedIds((ids) =>
      allBulkSmsFilteredSelected
        ? ids.filter((id) => !bulkSmsFiltered.some((c) => c.id === id))
        : [...ids, ...bulkSmsFiltered.filter((c) => !ids.includes(c.id)).map((c) => c.id)]
    );

  const handleSendBulkSms = async () => {
    const text = bulkSmsMessage.trim();
    const count = bulkSmsSelectedIds.length;
    if (!text || !count || bulkSmsSending) return;
    if (!window.confirm(`Send this text to ${count} contact${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulkSmsSending(true);
    setBulkSmsResult(null);
    try {
      const result = await api.post("/api/sms-bulk-send", { contactIds: bulkSmsSelectedIds, text });
      setBulkSmsResult(result);
      setBulkSmsMessage("");
      setBulkSmsSelectedIds([]);
    } catch (err) {
      setDbError(err.message || "Could not send the bulk message.");
    } finally {
      setBulkSmsSending(false);
    }
  };

  // ----- Client table (Grid / List view, dynamic column types) -----
  const [clientView, setClientView] = useState("list"); // 'list' | 'grid'
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [editingClientCell, setEditingClientCell] = useState(null); // `${clientId}:${key}` or null
  const [clientEditValue, setClientEditValue] = useState("");

  const toggleClientSelected = (id) =>
    setSelectedClientIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const deleteSelectedClients = async () => {
    if (!selectedClientIds.length) return;
    const count = selectedClientIds.length;
    if (!window.confirm(`Delete ${count} client${count === 1 ? "" : "s"}? This can't be undone.`)) return;
    const ids = selectedClientIds;
    setSelectedClientIds([]);
    setClients((cs) => cs.filter((c) => !ids.includes(c.id)));
    try {
      await api.delete(`/api/clients?ids=${ids.join(",")}`);
    } catch (err) {
      setDbError(err.message || "Could not delete the selected clients.");
    }
  };

  const updateClientField = async (clientId, key, value) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, fields: { ...c.fields, [key]: value } } : c)));
    try {
      await api.patch("/api/clients", { id: clientId, fields: { [key]: value } });
    } catch (err) {
      setDbError(err.message || "Could not save the change.");
    }
  };

  const updateClientName = async (clientId, name) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, name } : c)));
    try {
      await api.patch("/api/clients", { id: clientId, name });
    } catch (err) {
      setDbError(err.message || "Could not save the change.");
    }
  };

  const startEditClientCell = (clientId, key, currentValue) => {
    setEditingClientCell(`${clientId}:${key}`);
    setClientEditValue(currentValue === null || currentValue === undefined ? "" : String(currentValue));
  };

  const commitEditClientCell = (client, col) => {
    let value = clientEditValue;
    if (col.type === "number" || col.type === "currency") {
      value = value === "" ? null : Number(value);
      if (Number.isNaN(value)) value = null;
    } else if (value === "") {
      value = null;
    }
    setEditingClientCell(null);
    updateClientField(client.id, col.key, value);
  };

  // Add-column modal
  const emptyColumnForm = { label: "", type: "text", options: "" };
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [columnForm, setColumnForm] = useState(emptyColumnForm);

  const handleAddColumn = async (e) => {
    e.preventDefault();
    if (!columnForm.label.trim()) return;
    const options =
      columnForm.type === "select"
        ? columnForm.options
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((value, i) => ({ value, color: SELECT_COLOR_CYCLE[i % SELECT_COLOR_CYCLE.length] }))
        : [];
    try {
      const created = await api.post("/api/client-columns", {
        label: columnForm.label.trim(),
        type: columnForm.type,
        options,
      });
      setClientColumns((cols) => [...cols, created]);
      setColumnForm(emptyColumnForm);
      setShowAddColumn(false);
    } catch (err) {
      setDbError(err.message || "Could not create the column.");
    }
  };

  const handleDeleteColumn = async (id) => {
    if (!window.confirm("Delete this column? It will be removed from every client.")) return;
    setClientColumns((cols) => cols.filter((c) => c.id !== id));
    try {
      await api.delete(`/api/client-columns?id=${id}`);
    } catch (err) {
      setDbError(err.message || "Could not delete the column.");
    }
  };

  const handleImportClients = async () => {
    if (
      !window.confirm(
        "Import the real client list? This replaces every current client and column with the data from the CSV."
      )
    )
      return;
    try {
      await api.post("/api/clients-import", {});
      const [clientsData, columnsData] = await Promise.all([
        api.get("/api/clients"),
        api.get("/api/client-columns"),
      ]);
      setClients(clientsData);
      setClientColumns(columnsData);
      setSelectedClientIds([]);
    } catch (err) {
      setDbError(err.message || "Could not import the client list.");
    }
  };

  // Bulk lead import — a few thousand rows. A single request trying
  // to insert all of them at once was hitting Vercel's serverless
  // request timeout (504), so this drives its own paging loop instead
  // — each call only imports a few hundred rows and returns where to
  // resume from, well inside any timeout.
  const [importingContacts, setImportingContacts] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { inserted, total } or null
  const handleImportContacts = async () => {
    if (
      !window.confirm(
        "Import the real lead list? This replaces every current contact and column with the imported data. This can take a minute for a few thousand leads."
      )
    )
      return;
    setImportingContacts(true);
    setImportProgress(null);
    try {
      // Wipe + seed the column list as its own request first — this
      // used to happen inline on the first page of rows and, at 226
      // columns, was slow enough on its own to time out before a
      // single lead got inserted.
      const { total } = await api.post("/api/contacts-import", { reset: true });
      let offset = 0;
      let done = total === 0;
      setImportProgress({ inserted: 0, total });
      while (!done) {
        const result = await api.post("/api/contacts-import", { offset, limit: 500 });
        offset = result.nextOffset;
        done = result.done;
        setImportProgress({ inserted: offset, total: result.total });
      }
      const [contactsData, columnsData] = await Promise.all([
        api.get("/api/contacts"),
        api.get("/api/contact-columns"),
      ]);
      setContacts(contactsData);
      setContactColumns(columnsData);
      setSelectedContactIds([]);
    } catch (err) {
      setDbError(err.message || "Could not import the lead list.");
    } finally {
      setImportingContacts(false);
      setImportProgress(null);
    }
  };

  // ----- API key (Settings page) — one single key/token that lets a
  // script or agent read/write this CRM without a browser login, and
  // that also authenticates /api/lead-webhook (see api/api-keys.js).
  // Loaded lazily since it's only needed while actually on the
  // Settings page. Always shown in full (not just once at creation),
  // since it doubles as a webhook token that needs to stay copyable.
  const [apiKey, setApiKey] = useState(null); // { key, keyPrefix, createdAt, lastUsedAt, createdByName } | null
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);

  useEffect(() => {
    if (page !== "settings" || !authUser) return;
    let cancelled = false;
    setApiKeyLoading(true);
    api
      .get("/api/api-keys")
      .then((key) => {
        if (!cancelled) setApiKey(key);
      })
      .catch((err) => {
        if (!cancelled) setDbError(err.message || "Could not load the API key.");
      })
      .finally(() => {
        if (!cancelled) setApiKeyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, authUser]);

  // ---------- Users (Settings → Team, role management) ----------
  const canManageUsers = authUser?.role === "owner" || authUser?.role === "super_admin";
  // Mirrors server/auth.js's tabsForRole — a client role only ever
  // sees their own leads, so Powerdialler/Log/Clients/Settings (which
  // are either full-roster tools or nothing-to-do-with-leads config)
  // are hidden rather than just data-scoped.
  const CLIENT_NAV_KEYS = ["conversation", "contacts", "reports"];
  const visibleNavItems =
    authUser?.role === "client" ? navItems.filter((item) => CLIENT_NAV_KEYS.includes(item.key)) : navItems;
  useEffect(() => {
    if (authUser?.role === "client" && !CLIENT_NAV_KEYS.includes(page)) setPage("conversation");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, page]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const emptyInviteForm = { name: "", email: "", role: "admin", allowedTags: [] };
  const [inviteForm, setInviteForm] = useState(emptyInviteForm);
  const [invitingUser, setInvitingUser] = useState(false);

  useEffect(() => {
    if (page !== "settings" || !authUser) return;
    let cancelled = false;
    setTeamUsersLoading(true);
    api
      .get("/api/users")
      .then((list) => {
        if (!cancelled) setTeamUsers(list);
      })
      .catch((err) => {
        if (!cancelled) setDbError(err.message || "Could not load the team list.");
      })
      .finally(() => {
        if (!cancelled) setTeamUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, authUser]);

  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) return;
    setInvitingUser(true);
    try {
      const created = await api.post("/api/users", {
        name: inviteForm.name.trim(),
        email: inviteForm.email.trim(),
        role: inviteForm.role,
        allowedTags: inviteForm.role === "client" ? inviteForm.allowedTags : [],
      });
      setTeamUsers((us) => [...us, created]);
      setInviteForm(emptyInviteForm);
    } catch (err) {
      setDbError(err.message || "Could not invite that user.");
    } finally {
      setInvitingUser(false);
    }
  };

  const patchTeamUser = async (id, patch) => {
    try {
      const updated = await api.patch("/api/users", { id, ...patch });
      setTeamUsers((us) => us.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      setDbError(err.message || "Could not update that user.");
    }
  };

  const handleDeleteTeamUser = async (id) => {
    try {
      await api.delete(`/api/users?id=${id}`);
      setTeamUsers((us) => us.filter((u) => u.id !== id));
    } catch (err) {
      setDbError(err.message || "Could not remove that user.");
    }
  };

  const toggleInviteAllowedTag = (tag) =>
    setInviteForm((f) => ({
      ...f,
      allowedTags: f.allowedTags.includes(tag) ? f.allowedTags.filter((t) => t !== tag) : [...f.allowedTags, tag],
    }));
  const [tagMenuUserId, setTagMenuUserId] = useState(null); // which team row's tag-picker popover is open
  const toggleTeamUserTag = (u, tag) => {
    const next = u.allowedTags.includes(tag) ? u.allowedTags.filter((t) => t !== tag) : [...u.allowedTags, tag];
    setTeamUsers((us) => us.map((x) => (x.id === u.id ? { ...x, allowedTags: next } : x)));
    patchTeamUser(u.id, { allowedTags: next });
  };
  const canDeleteTeamUser = (targetRole) => canManageUsers && targetRole !== "owner";

  // Generates the key the first time, or replaces the existing one —
  // there's only ever at most one (see api/api-keys.js). Regenerating
  // immediately breaks anything still using the old value, so confirm
  // when one's already live.
  const handleGenerateApiKey = async () => {
    if (
      apiKey &&
      !window.confirm(
        "Generate a new API key? The current one — and any webhook URL built from it — will stop working immediately."
      )
    )
      return;
    setGeneratingKey(true);
    try {
      setApiKey(await api.post("/api/api-keys", {}));
    } catch (err) {
      setDbError(err.message || "Could not generate the API key.");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleDeleteApiKey = async () => {
    if (!window.confirm("Revoke the API key? Anything using it — including the lead webhook — will stop working immediately."))
      return;
    setApiKey(null);
    try {
      await api.delete("/api/api-keys");
    } catch (err) {
      setDbError(err.message || "Could not revoke the API key.");
    }
  };

  const webhookUrl = apiKey ? `${window.location.origin}/api/lead-webhook?token=${apiKey.key}` : "";
  const copyApiKeyValue = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey.key);
      setCopiedApiKey(true);
      setTimeout(() => setCopiedApiKey(false), 2000);
    } catch {
      window.prompt("Copy this API key:", apiKey.key);
    }
  };
  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhookUrl(true);
      setTimeout(() => setCopiedWebhookUrl(false), 2000);
    } catch {
      window.prompt("Copy this webhook URL:", webhookUrl);
    }
  };

  const selectOptionColor = (col, value) => {
    const opt = (col.options || []).find((o) => o.value === value);
    return SELECT_COLORS[opt?.color] || SELECT_COLORS.gray;
  };

  // Renders one cell of the client table, in view or edit mode
  // depending on the column's type — this is what makes columns
  // behave like text / dropdown / url / etc.
  const renderClientCell = (client, col) => {
    const cellKey = `${client.id}:${col.key}`;
    const value = client.fields?.[col.key];
    const isEditing = editingClientCell === cellKey;

    if (col.type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => updateClientField(client.id, col.key, e.target.checked)}
          className="w-4 h-4 rounded border-gray-300"
        />
      );
    }

    if (col.type === "select") {
      if (isEditing) {
        return (
          <select
            autoFocus
            defaultValue={value || ""}
            onChange={(e) => {
              setEditingClientCell(null);
              updateClientField(client.id, col.key, e.target.value || null);
            }}
            onBlur={() => setEditingClientCell(null)}
            className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs outline-none bg-white"
          >
            <option value="">—</option>
            {(col.options || []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.value}
              </option>
            ))}
          </select>
        );
      }
      return (
        <button onClick={() => setEditingClientCell(cellKey)} className="w-full text-left">
          {value ? (
            <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(col, value)}`}>
              {value}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">—</span>
          )}
        </button>
      );
    }

    if (col.type === "url") {
      if (isEditing) {
        return (
          <input
            autoFocus
            type="text"
            value={clientEditValue}
            onChange={(e) => setClientEditValue(e.target.value)}
            onBlur={() => commitEditClientCell(client, col)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEditClientCell(client, col);
              if (e.key === "Escape") setEditingClientCell(null);
            }}
            className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs outline-none"
          />
        );
      }
      return (
        <div className="flex items-center gap-1.5 group/cell">
          {value ? (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-600 hover:text-blue-700 truncate max-w-[140px] inline-block"
            >
              {value}
            </a>
          ) : (
            <span className="text-gray-300 text-xs">—</span>
          )}
          <button
            onClick={() => startEditClientCell(client.id, col.key, value)}
            className="opacity-0 group-hover/cell:opacity-100 text-gray-300 hover:text-gray-600 shrink-0"
          >
            <Pencil size={11} />
          </button>
        </div>
      );
    }

    if (isEditing) {
      if (col.type === "long_text") {
        return (
          <textarea
            autoFocus
            rows={3}
            value={clientEditValue}
            onChange={(e) => setClientEditValue(e.target.value)}
            onBlur={() => commitEditClientCell(client, col)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingClientCell(null);
            }}
            className="w-full min-w-[200px] border border-gray-300 rounded-md px-2 py-1 text-xs outline-none resize-y"
          />
        );
      }
      const inputType = col.type === "number" || col.type === "currency" ? "number" : col.type === "date" ? "date" : "text";
      return (
        <input
          autoFocus
          type={inputType}
          step={col.type === "currency" ? "0.01" : undefined}
          value={clientEditValue}
          onChange={(e) => setClientEditValue(e.target.value)}
          onBlur={() => commitEditClientCell(client, col)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEditClientCell(client, col);
            if (e.key === "Escape") setEditingClientCell(null);
          }}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs outline-none"
        />
      );
    }

    const display = formatDynamicCellDisplay(col, value);
    const isNumeric = col.type === "number" || col.type === "currency";
    return (
      <button
        onClick={() => startEditClientCell(client.id, col.key, value ?? "")}
        title={typeof display === "string" && display.length > 30 ? display : undefined}
        className={`w-full text-left text-xs truncate ${isNumeric ? "text-right tabular-nums" : ""}`}
      >
        {display !== null ? display : <span className="text-gray-300">—</span>}
      </button>
    );
  };

  // ----- Contact table (dynamic column types) — same pattern as the
  // Client table above, so lead data can carry whatever extra
  // criteria a given client needs (source, budget, campaign, …)
  // without every contact being forced onto one fixed schema. -----
  const [editingContactCell, setEditingContactCell] = useState(null); // `${contactId}:${key}` or null
  const [contactEditValue, setContactEditValue] = useState("");

  const updateContactField = async (contactId, key, value) => {
    setContacts((cs) => cs.map((c) => (c.id === contactId ? { ...c, fields: { ...c.fields, [key]: value } } : c)));
    try {
      await api.patch("/api/contacts", { id: contactId, fields: { [key]: value } });
    } catch (err) {
      setDbError(err.message || "Could not save the change.");
    }
  };

  const startEditContactCell = (contactId, key, currentValue) => {
    setEditingContactCell(`${contactId}:${key}`);
    setContactEditValue(currentValue === null || currentValue === undefined ? "" : String(currentValue));
  };

  const commitEditContactCell = (contact, col) => {
    let value = contactEditValue;
    if (col.type === "number" || col.type === "currency") {
      value = value === "" ? null : Number(value);
      if (Number.isNaN(value)) value = null;
    } else if (value === "") {
      value = null;
    }
    setEditingContactCell(null);
    updateContactField(contact.id, col.key, value);
  };

  // Add-column modal (Contacts)
  const emptyContactColumnForm = { label: "", type: "text", options: "" };
  const [showAddContactColumn, setShowAddContactColumn] = useState(false);
  const [contactColumnForm, setContactColumnForm] = useState(emptyContactColumnForm);

  const handleAddContactColumn = async (e) => {
    e.preventDefault();
    if (!contactColumnForm.label.trim()) return;
    const options =
      contactColumnForm.type === "select"
        ? contactColumnForm.options
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((value, i) => ({ value, color: SELECT_COLOR_CYCLE[i % SELECT_COLOR_CYCLE.length] }))
        : [];
    try {
      const created = await api.post("/api/contact-columns", {
        label: contactColumnForm.label.trim(),
        type: contactColumnForm.type,
        options,
      });
      setContactColumns((cols) => [...cols, created]);
      setContactColumnForm(emptyContactColumnForm);
      setShowAddContactColumn(false);
    } catch (err) {
      setDbError(err.message || "Could not create the column.");
    }
  };

  const handleDeleteContactColumn = async (id) => {
    if (!window.confirm("Delete this column? It will be removed from every contact.")) return;
    setContactColumns((cols) => cols.filter((c) => c.id !== id));
    try {
      await api.delete(`/api/contact-columns?id=${id}`);
    } catch (err) {
      setDbError(err.message || "Could not delete the column.");
    }
  };

  // Renders one cell of the contact table, in view or edit mode
  // depending on the column's type — identical behaviour to
  // renderClientCell, just backed by the contact's own fields blob.
  const renderContactCell = (contact, col) => {
    const cellKey = `${contact.id}:${col.key}`;
    const value = contact.fields?.[col.key];
    const isEditing = editingContactCell === cellKey;

    if (col.type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => updateContactField(contact.id, col.key, e.target.checked)}
          className="w-4 h-4 rounded border-gray-300"
        />
      );
    }

    if (col.type === "select") {
      if (isEditing) {
        return (
          <select
            autoFocus
            defaultValue={value || ""}
            onChange={(e) => {
              setEditingContactCell(null);
              updateContactField(contact.id, col.key, e.target.value || null);
            }}
            onBlur={() => setEditingContactCell(null)}
            className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs outline-none bg-white"
          >
            <option value="">—</option>
            {(col.options || []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.value}
              </option>
            ))}
          </select>
        );
      }
      return (
        <button onClick={() => setEditingContactCell(cellKey)} className="w-full text-left">
          {value ? (
            <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(col, value)}`}>
              {value}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">—</span>
          )}
        </button>
      );
    }

    if (col.type === "url") {
      if (isEditing) {
        return (
          <input
            autoFocus
            type="text"
            value={contactEditValue}
            onChange={(e) => setContactEditValue(e.target.value)}
            onBlur={() => commitEditContactCell(contact, col)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEditContactCell(contact, col);
              if (e.key === "Escape") setEditingContactCell(null);
            }}
            className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs outline-none"
          />
        );
      }
      return (
        <div className="flex items-center gap-1.5 group/cell">
          {value ? (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-600 hover:text-blue-700 truncate max-w-[140px] inline-block"
            >
              {value}
            </a>
          ) : (
            <span className="text-gray-300 text-xs">—</span>
          )}
          <button
            onClick={() => startEditContactCell(contact.id, col.key, value)}
            className="opacity-0 group-hover/cell:opacity-100 text-gray-300 hover:text-gray-600 shrink-0"
          >
            <Pencil size={11} />
          </button>
        </div>
      );
    }

    if (isEditing) {
      if (col.type === "long_text") {
        return (
          <textarea
            autoFocus
            rows={3}
            value={contactEditValue}
            onChange={(e) => setContactEditValue(e.target.value)}
            onBlur={() => commitEditContactCell(contact, col)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingContactCell(null);
            }}
            className="w-full min-w-[200px] border border-gray-300 rounded-md px-2 py-1 text-xs outline-none resize-y"
          />
        );
      }
      const inputType = col.type === "number" || col.type === "currency" ? "number" : col.type === "date" ? "date" : "text";
      return (
        <input
          autoFocus
          type={inputType}
          step={col.type === "currency" ? "0.01" : undefined}
          value={contactEditValue}
          onChange={(e) => setContactEditValue(e.target.value)}
          onBlur={() => commitEditContactCell(contact, col)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEditContactCell(contact, col);
            if (e.key === "Escape") setEditingContactCell(null);
          }}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs outline-none"
        />
      );
    }

    const display = formatDynamicCellDisplay(col, value);
    const isNumeric = col.type === "number" || col.type === "currency";
    return (
      <button
        onClick={() => startEditContactCell(contact.id, col.key, value ?? "")}
        title={typeof display === "string" && display.length > 30 ? display : undefined}
        className={`w-full text-left text-xs truncate ${isNumeric ? "text-right tabular-nums" : ""}`}
      >
        {display !== null ? display : <span className="text-gray-300">—</span>}
      </button>
    );
  };

  // A lead's client record, derived from the Client column: look up the
  // client by name in the client list to read its script link/content.
  const getClient = (clientName) =>
    clients.find((cl) => cl.name === clientName);

  // Leads for the powerdialler, newest first, filterable by every column
  const dialQueue = [...contacts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const dialClientOptions = ["All", ...clients.map((cl) => cl.name)];
  const dialStatusOptions = ["All", ...Object.keys(statusColors)];
  // Custom columns worth showing/filtering in the Powerdialler table —
  // whatever actually has a value somewhere in the queue. Computed
  // from the full queue (not the currently-filtered set) so the
  // column list stays put as filters change instead of flickering.
  const visibleDialColumns = contactColumns.filter(
    (col) => col.key !== "stage" && dialQueue.some((l) => hasFieldValue(l.fields?.[col.key]))
  );
  // Stage gets its own fixed header/filter cell (rendered separately,
  // right after Client) rather than living in visibleDialColumns, but
  // it still needs to participate in the same exclude/text filtering
  // as every other criteria column below.
  const dialFilterableColumns = stageColumnDef ? [stageColumnDef, ...visibleDialColumns] : visibleDialColumns;
  const dialFieldFiltersActive =
    Object.values(dialFieldExcludes).some((vals) => vals && vals.length > 0) ||
    Object.values(dialFieldTextFilters).some((v) => v);
  const dialFiltersActive =
    Object.entries(dialFilters).some(([key, value]) => value !== emptyDialFilters[key]) || dialFieldFiltersActive;
  const updateDialFilter = (key, value) =>
    setDialFilters((f) => ({ ...f, [key]: value }));
  const clearAllDialFilters = () => {
    setDialFilters(emptyDialFilters);
    setDialFieldExcludes({});
    setDialFieldTextFilters({});
  };
  const filteredDialQueueBase = dialQueue.filter(
    (l) =>
      (l.leadDate || "").toLowerCase().includes(dialFilters.leadDate.toLowerCase()) &&
      l.name.toLowerCase().includes(dialFilters.name.toLowerCase()) &&
      l.email.toLowerCase().includes(dialFilters.email.toLowerCase()) &&
      l.phone.toLowerCase().includes(dialFilters.phone.toLowerCase()) &&
      (dialFilters.client === "All" || l.client === dialFilters.client) &&
      l.notes.toLowerCase().includes(dialFilters.notes.toLowerCase()) &&
      (dialFilters.status === "All" || l.status === dialFilters.status) &&
      dialFilterableColumns.every((col) => {
        const val = l.fields?.[col.key];
        if (col.type === "select" || col.type === "checkbox") {
          const excluded = dialFieldExcludes[col.key] || [];
          if (!excluded.length) return true;
          const displayVal = col.type === "checkbox" ? (val ? "Yes" : "No") : val || "";
          return !excluded.includes(displayVal);
        }
        const textFilter = (dialFieldTextFilters[col.key] || "").toLowerCase();
        if (!textFilter) return true;
        return String(val ?? "")
          .toLowerCase()
          .includes(textFilter);
      })
  );
  const activeLead = dialQueue.find((l) => l.id === activeLeadId) || null;

  // Live calling — same model as GoHighLevel's power dialler: the
  // browser registers as a Twilio Voice "device" and calls ring
  // through the rep's mic/speakers via the backend in /server.
  const [callStatus, setCallStatus] = useState("idle"); // idle | connecting | in-progress
  const [callError, setCallError] = useState("");
  const [activeCallerId, setActiveCallerId] = useState(""); // which of the rotated Twilio numbers is placing the current call
  // The number actually being dialled for the live call — usually
  // just activeLead.phone, but "Call again with a different number"
  // (below) overrides it, so the hotseat always shows what's really
  // ringing rather than the contact's stored number.
  const [activeCallPhone, setActiveCallPhone] = useState("");
  // The most recent call placed outside a Power Dialler session (no
  // wrap-up screen forces a stop for those) — kept just long enough to
  // offer "Call again"/"Call again with a different number" on it too,
  // cleared the moment another call starts or the rep dismisses it.
  const [lastAdHocCall, setLastAdHocCall] = useState(null); // { lead, durationMs } | null
  const activeCallRef = useRef(null);
  const callStartRef = useRef(null); // when the current call was placed, for duration
  const callEndedRef = useRef(false); // guards against double-processing one call's end

  // Multi-line dialling (Multi Line tab only — Powerdialler always
  // dials one at a time) — how many leads to ring simultaneously per
  // round, chosen once when a session starts and carried on `session`
  // itself (session.lines) so it can't change mid-session. See
  // startMultilineCall/dialNextInQueue below for how this plugs into
  // the same session/queue engine Powerdialler uses.
  const [multiLines, setMultiLines] = useState(4);
  const [multilineBatch, setMultilineBatch] = useState(null); // { id, candidates: [{leadId,name,phone,status}] } | null
  const multilineBatchIdRef = useRef(null); // current batch id, for cancelling on an early hang-up
  const multilineWinnerRef = useRef(null); // resolved winning lead, read once the rep's own leg disconnects
  const multilinePollRef = useRef(null);
  // Kept in sync with dialQueue so the polling loop below (a
  // setInterval callback, not re-created every render) always reads
  // the current contact list rather than whatever it was when the
  // batch started — same pattern as sessionRef.
  const dialQueueRef = useRef(dialQueue);
  useEffect(() => {
    dialQueueRef.current = dialQueue;
  }, [dialQueue]);

  // Soundboard — short pre-recorded clips a rep can fire off mid-call
  // (see src/lib/soundboardProcessor.js), e.g. a quick canned response
  // to a phone's call-screening prompt ("please state your name and
  // reason for calling"). Shared across the whole team, loaded lazily
  // the first time either dialling tab is opened.
  const [soundboardClips, setSoundboardClips] = useState([]);
  const [soundboardLoaded, setSoundboardLoaded] = useState(false);
  const [playingClipId, setPlayingClipId] = useState(null);
  const [showSoundboardRecorder, setShowSoundboardRecorder] = useState(false);
  const [recordingLabel, setRecordingLabel] = useState("");
  const [recorderStatus, setRecorderStatus] = useState("idle"); // idle | recording | recorded | saving
  const [recordedClip, setRecordedClip] = useState(null); // { blob, url } | null
  const [recorderError, setRecorderError] = useState("");
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  useEffect(() => {
    if (soundboardLoaded) return;
    if (page !== "powerdialler" && page !== "multiline") return;
    setSoundboardLoaded(true);
    api
      .get("/api/soundboard-clips")
      .then(setSoundboardClips)
      .catch((err) => setDbError(err.message || "Could not load the soundboard."));
  }, [page, soundboardLoaded]);

  const handlePlaySoundboardClip = async (clip) => {
    if (playingClipId) return; // one at a time
    setPlayingClipId(clip.id);
    try {
      await playSoundboardClip(clip.audioData);
    } catch (err) {
      setDbError(err.message || "Could not play that clip — is there a live call to play it into?");
    } finally {
      setPlayingClipId(null);
    }
  };

  const deleteSoundboardClipRow = async (id) => {
    if (!window.confirm("Delete this clip?")) return;
    setSoundboardClips((cs) => cs.filter((c) => c.id !== id));
    try {
      await api.delete(`/api/soundboard-clips?id=${id}`);
    } catch (err) {
      setDbError(err.message || "Could not delete the clip.");
    }
  };

  const closeSoundboardRecorder = () => {
    mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    setShowSoundboardRecorder(false);
    setRecorderStatus("idle");
    setRecordedClip(null);
    setRecordingLabel("");
    setRecorderError("");
  };

  const startRecordingClip = async () => {
    setRecorderError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecordedClip({ blob, url: URL.createObjectURL(blob) });
        setRecorderStatus("recorded");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecorderStatus("recording");
    } catch (err) {
      setRecorderError(err.message || "Could not access the microphone.");
    }
  };

  const stopRecordingClip = () => mediaRecorderRef.current?.stop();

  const reRecordClip = () => {
    setRecordedClip(null);
    setRecorderStatus("idle");
  };

  const saveRecordedClip = async () => {
    if (!recordedClip || !recordingLabel.trim()) return;
    setRecorderStatus("saving");
    try {
      const audioData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result); // a data: URL, mime type baked in
        reader.onerror = () => reject(new Error("Could not read the recording."));
        reader.readAsDataURL(recordedClip.blob);
      });
      const created = await api.post("/api/soundboard-clips", {
        label: recordingLabel.trim(),
        audioData,
        mimeType: recordedClip.blob.type || "audio/webm",
      });
      setSoundboardClips((cs) => [...cs, created]);
      closeSoundboardRecorder();
    } catch (err) {
      setRecorderError(err.message || "Could not save the clip.");
      setRecorderStatus("recorded");
    }
  };

  // Shared by every system message logged into a lead's conversation
  // thread (call summaries, stage/outcome updates, …) — creates a new
  // thread if one doesn't exist yet, otherwise appends to it and bumps
  // it to the top of the list, then persists it.
  const logSystemMessageToConversation = (lead, { type, text, preview }) => {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const previewText = preview ?? text;
    const message = { id: `${type}-${lead.id}-${now.getTime()}`, type, text, time: timeLabel };

    const existing = conversations.find((c) => c.leadId === lead.id);
    let tempId = existing?.id;
    if (existing) {
      const updated = {
        ...existing,
        preview: previewText,
        time: timeLabel,
        unread: false,
        messages: [...(existing.messages || []), message],
      };
      setConversations((cs) => [updated, ...cs.filter((c) => c.id !== existing.id)]);
      setActiveConvo(updated.id);
    } else {
      tempId = conversations.length ? Math.max(...conversations.map((c) => c.id)) + 1 : 1;
      const newConvo = {
        id: tempId,
        leadId: lead.id,
        name: lead.name,
        preview: previewText,
        time: timeLabel,
        unread: false,
        messages: [message],
      };
      setConversations((cs) => [newConvo, ...cs]);
      setActiveConvo(tempId);
    }

    // Persist to the database. For a brand-new conversation, reconcile
    // our locally-guessed id with the real one the server generated.
    api
      .post("/api/conversations", { leadId: lead.id, name: lead.name, text, time: timeLabel, type })
      .then(({ conversationId }) => {
        if (!existing && conversationId && conversationId !== tempId) {
          setConversations((cs) => cs.map((c) => (c.id === tempId ? { ...c, id: conversationId } : c)));
          setActiveConvo((prev) => (prev === tempId ? conversationId : prev));
        }
      })
      .catch((err) => setDbError(err.message || "Could not save this to the conversation."));
  };

  // Logs a completed call into that lead's conversation thread.
  // Applies to every call, whether placed ad hoc or as part of a
  // Power Dialler session.
  const logCallToConversation = (lead, durationMs) => {
    const timeLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const summary = `Outgoing call · ${timeLabel} · ${formatCallDuration(durationMs)} · by ${authUser?.name || "You"}`;
    logSystemMessageToConversation(lead, { type: "call", text: summary });
  };

  // Logs the wrap-up's chosen STAGE as its own message — separate from
  // the "Outgoing call" line above, since the outcome isn't known
  // until wrap-up finishes, a beat after the call itself ends. This is
  // what makes a "Booked" outcome show up in the Conversation tab.
  const logStageToConversation = (lead, stage) => {
    if (!stage) return;
    logSystemMessageToConversation(lead, { type: "outcome", text: stage, preview: `Outcome: ${stage}` });
  };

  // ----- Power Dialler session (auto-dial through a list) -----
  const [dialLists, setDialLists] = useState([]); // [{ id, name, leadIds }]

  // "Add to Powerlist" — from the Contacts page's bulk-select, add the
  // selected contacts to an existing powerlist or create a new one
  // from them, without leaving Contacts.
  const [showAddToPowerlist, setShowAddToPowerlist] = useState(false);
  const [newPowerlistName, setNewPowerlistName] = useState("");
  const [addingToPowerlist, setAddingToPowerlist] = useState(false);

  const handleAddSelectedToExistingPowerlist = async (listId) => {
    if (!selectedContactIds.length) return;
    setAddingToPowerlist(true);
    try {
      const updated = await api.patch("/api/dial-lists", { id: listId, leadIds: selectedContactIds });
      setDialLists((lists) => lists.map((l) => (l.id === listId ? updated : l)));
      setShowAddToPowerlist(false);
      setSelectedContactIds([]);
    } catch (err) {
      setDbError(err.message || "Could not add to the powerlist.");
    } finally {
      setAddingToPowerlist(false);
    }
  };

  const handleCreatePowerlistFromSelection = async (e) => {
    e.preventDefault();
    if (!newPowerlistName.trim() || !selectedContactIds.length) return;
    setAddingToPowerlist(true);
    try {
      const created = await api.post("/api/dial-lists", {
        name: newPowerlistName.trim(),
        leadIds: selectedContactIds,
      });
      setDialLists((lists) => [...lists, created]);
      setNewPowerlistName("");
      setShowAddToPowerlist(false);
      setSelectedContactIds([]);
    } catch (err) {
      setDbError(err.message || "Could not create the powerlist.");
    } finally {
      setAddingToPowerlist(false);
    }
  };

  // Secondary sidebar (Powerdialler) — narrows the queue below to one
  // saved powerlist at a time, "all" shows every lead.
  const [dialListFilter, setDialListFilter] = useState("all");
  const filteredDialQueue = filteredDialQueueBase.filter(
    (l) =>
      dialListFilter === "all" ||
      (dialLists.find((dl) => dl.id === dialListFilter)?.leadIds || []).includes(l.id)
  );

  // Paginated for the same reason as Contacts — with thousands of
  // imported leads, "All leads" alone was enough rows to freeze the
  // tab. filteredDialQueue above (the full matching set) still drives
  // the dial session queue, "Start Power Dialler," and Save-as-list —
  // only what actually renders in the table is capped.
  const DIAL_QUEUE_PAGE_SIZE = 30;
  const [dialQueuePage, setDialQueuePage] = useState(0);
  useEffect(() => {
    setDialQueuePage(0);
  }, [dialFilters, dialFieldExcludes, dialFieldTextFilters, dialListFilter]);
  const totalDialQueuePages = Math.max(1, Math.ceil(filteredDialQueue.length / DIAL_QUEUE_PAGE_SIZE));
  const pagedDialQueue = filteredDialQueue.slice(
    dialQueuePage * DIAL_QUEUE_PAGE_SIZE,
    (dialQueuePage + 1) * DIAL_QUEUE_PAGE_SIZE
  );

  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [newListName, setNewListName] = useState("");
  // A Powerlist's own leadIds *are* the "still to call" queue — once a
  // call to a lead actually completes, it's removed from every list
  // it's in (see removeLeadFromLists below), so "N to call" always
  // just reflects the list's current membership. No separate
  // called/not-called flag to keep in sync.
  const removeLeadFromLists = (leadId) => {
    setDialLists((lists) => lists.map((l) => ({ ...l, leadIds: l.leadIds.filter((id) => id !== leadId) })));
    api.patch("/api/dial-lists", { removeLeadId: leadId }).catch((err) => {
      setDbError(err.message || "Could not update the Powerlist.");
    });
  };
  const [session, setSession] = useState(null); // { listName, queue: [leadId,...] }
  const [sessionPaused, setSessionPaused] = useState(false);
  const [wrapUp, setWrapUp] = useState(null); // { lead, customStage, notes, secondsLeft }
  const [wrapUpStatusMenuOpen, setWrapUpStatusMenuOpen] = useState(false);
  const [callLog, setCallLog] = useState([]);

  // ---------- Reports ----------
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const isoDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const [reportsFrom, setReportsFrom] = useState(() => isoDaysAgo(30));
  const [reportsTo, setReportsTo] = useState(() => isoToday());
  const [reportsUserFilter, setReportsUserFilter] = useState("All");

  const reportsUserNames = [...new Set(callLog.map((e) => e.userName || "Unknown"))].sort();
  const reportsCallLog = callLog.filter((e) => {
    if (!e.calledAt) return false;
    const d = String(e.calledAt).slice(0, 10);
    if (reportsFrom && d < reportsFrom) return false;
    if (reportsTo && d > reportsTo) return false;
    if (reportsUserFilter !== "All" && (e.userName || "Unknown") !== reportsUserFilter) return false;
    return true;
  });
  const reportsTotalCalls = reportsCallLog.length;
  const reportsTotalSeconds = reportsCallLog.reduce((sum, e) => sum + (e.durationSeconds || 0), 0);
  const reportsAvgSeconds = reportsTotalCalls ? reportsTotalSeconds / reportsTotalCalls : 0;
  const reportsUniqueLeads = new Set(reportsCallLog.map((e) => e.leadId)).size;
  // "Successful booking" = a call whose outcome (STAGE) was moved to
  // Booked — the one number a Client-role user gets in place of the
  // internal talk-time metrics they don't see.
  const reportsBookedCalls = reportsCallLog.filter((e) => e.status === "Booked").length;
  const reportsIsClientView = authUser?.role === "client";

  // Groups call log entries by a key (rep, client, or tag) and rolls
  // up call count + duration for each — the source for every
  // breakdown table below.
  const summarizeCallsBy = (items, keyFn) => {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item) || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()]
      .map(([key, group]) => {
        const calls = group.length;
        const totalSeconds = group.reduce((s, e) => s + (e.durationSeconds || 0), 0);
        const bookedCalls = group.filter((e) => e.status === "Booked").length;
        return { key, calls, totalSeconds, avgSeconds: calls ? totalSeconds / calls : 0, bookedCalls };
      })
      .sort((a, b) => b.calls - a.calls);
  };
  const reportsByUser = summarizeCallsBy(reportsCallLog, (e) => e.userName || "Unknown");
  const reportsByClient = summarizeCallsBy(reportsCallLog, (e) => e.client);
  const reportsByTag = summarizeCallsBy(reportsCallLog, (e) => e.tag || "Untagged");

  // "Activity Stream" — dial attempts bucketed by time of day (local
  // clock time), collapsed across every day in the selected range.
  // The point isn't the trend over the date range, it's the shape of
  // a working day: a rep who's clocked in but has gone quiet shows up
  // as a flat-to-zero stretch between two active buckets, which is
  // exactly what the gap-detection below flags.
  const ACTIVITY_BUCKET_MINUTES = 30;
  const reportsActivity = useMemo(() => {
    const bucketsPerHour = 60 / ACTIVITY_BUCKET_MINUTES;
    const totalBuckets = 24 * bucketsPerHour;
    const counts = new Array(totalBuckets).fill(0);
    for (const e of reportsCallLog) {
      if (!e.calledAt) continue;
      const d = new Date(e.calledAt);
      if (Number.isNaN(d.getTime())) continue;
      const idx = d.getHours() * bucketsPerHour + Math.floor(d.getMinutes() / ACTIVITY_BUCKET_MINUTES);
      counts[idx] += 1;
    }

    const bucketLabel = (idx) => {
      const h = Math.floor(idx / bucketsPerHour);
      const m = (idx % bucketsPerHour) * ACTIVITY_BUCKET_MINUTES;
      const h12 = h % 12 || 12;
      return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
    };

    const activeIdx = counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
    if (activeIdx.length === 0) return { buckets: [], gaps: [] };

    // Frame the chart on the working window actually seen in the data
    // (padded by one bucket either side) instead of a full, mostly-empty
    // 24 hours.
    const first = Math.max(0, activeIdx[0] - 1);
    const last = Math.min(totalBuckets - 1, activeIdx[activeIdx.length - 1] + 1);
    const buckets = [];
    for (let i = first; i <= last; i++) {
      buckets.push({ time: bucketLabel(i), calls: counts[i] });
    }

    // Flag any stretch of 60+ minutes with zero dial attempts that sits
    // *between* two active buckets — quiet time in the middle of a
    // working stretch, not just before the first call or after the last.
    const gaps = [];
    let runStart = null;
    for (let i = activeIdx[0]; i <= activeIdx[activeIdx.length - 1]; i++) {
      if (counts[i] === 0) {
        if (runStart === null) runStart = i;
      } else if (runStart !== null) {
        if (i - runStart >= bucketsPerHour) {
          gaps.push({
            start: bucketLabel(runStart),
            end: bucketLabel(i - 1),
            minutes: (i - runStart) * ACTIVITY_BUCKET_MINUTES,
          });
        }
        runStart = null;
      }
    }
    return { buckets, gaps };
  }, [reportsCallLog]);
  // The actual list behind the Bookings tile — every call in range
  // whose outcome was Booked, most recent first.
  const reportsBookedList = reportsCallLog
    .filter((e) => e.status === "Booked")
    .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt));

  // Call log "status"/"outcome" is written from the imported STAGE
  // column's value (see finishWrapUp) — colored the same way STAGE
  // pills are everywhere else, rather than the app's built-in
  // statusColors (which only covers manually-created contacts).
  const callOutcomeColor = (value) => (value ? selectOptionColor(stageColumnDef || {}, value) : "");

  // Kept in sync with `session` so the long-lived Twilio call event
  // handlers below (registered once per call, not re-created each
  // render) always see whether a session is *currently* active rather
  // than whichever one was active when the call started.
  const sessionRef = useRef(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const WRAP_UP_SECONDS = 15;

  const toggleLeadSelected = (id) =>
    setSelectedLeadIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // A list's leadIds already only ever contains leads still worth
  // calling (removeLeadFromLists drops one the moment its call
  // actually completes) — this just filters out any that no longer
  // exist as contacts at all.
  const remainingInList = (leadIds) => leadIds.filter((id) => dialQueue.some((l) => l.id === id));

  const saveSelectedAsList = async () => {
    if (!newListName.trim() || selectedLeadIds.length === 0) return;
    const name = newListName.trim();
    const leadIds = selectedLeadIds;
    setSelectedLeadIds([]);
    setNewListName("");
    try {
      const created = await api.post("/api/dial-lists", { name, leadIds });
      setDialLists((ls) => [...ls, created]);
    } catch (err) {
      setDbError(err.message || "Could not save the list.");
    }
  };

  const deleteDialList = (id) => {
    setDialLists((ls) => ls.filter((l) => l.id !== id));
    api.delete(`/api/dial-lists?id=${id}`).catch((err) => setDbError(err.message || "Could not delete the list."));
  };

  // Kicks off a Power Dialler (or Multi Line) session: works through
  // `leadIds` in order, top to bottom, placing the first call/round
  // immediately. `lines` — 1 for a normal single-line session,
  // Multi Line's chosen line count otherwise — is stuck onto the
  // session itself so it stays fixed for its whole duration.
  const startSession = (listName, leadIds, lines = 1) => {
    const queue = remainingInList(leadIds);
    if (!queue.length) return;
    setWrapUp(null);
    setSessionPaused(false);
    setSession({ listName, queue, lines });
    dialNextInQueue(queue, lines);
  };

  const stopSession = () => {
    setSession(null);
    setSessionPaused(false);
    setWrapUp(null);
    if (multilineBatchIdRef.current) cancelMultilineBatch(multilineBatchIdRef.current);
    if (calling) {
      hangUp();
      activeCallRef.current = null;
      setCalling(false);
      setCallStatus("idle");
    }
  };

  // Pausing doesn't hang up a call in progress or freeze the current
  // wrap-up's fields — it just stops the session from auto-dialing
  // the next lead once the current one wraps up. Resuming either
  // unfreezes an in-progress wrap-up countdown, or — if nothing is
  // currently happening — immediately dials the next lead in queue.
  const togglePause = () => {
    const next = !sessionPaused;
    setSessionPaused(next);
    if (!next && !calling && !wrapUp && session?.queue.length) {
      dialNextInQueue(session.queue, session.lines);
    }
  };

  // Logs a completed call straight to the call log — used for ad hoc
  // calls placed outside a dialler session, where no wrap-up screen
  // opens to capture it. Keeps the Reports tab's call counts/durations
  // complete instead of only covering session calls.
  const logCallDirect = (lead, durationMs) => {
    const durationSeconds = Math.round((durationMs || 0) / 1000);
    const status = lead.fields?.stage || lead.status;
    const tempLogId = `${lead.id}-${Date.now()}`;
    setCallLog((log) => [
      {
        id: tempLogId,
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        client: lead.client,
        tag: lead.tag,
        status,
        notes: lead.notes,
        durationSeconds,
        userName: authUser?.name,
        calledAt: new Date().toISOString(),
      },
      ...log,
    ]);
    api
      .post("/api/call-log", {
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        client: lead.client,
        tag: lead.tag,
        status,
        notes: lead.notes,
        durationSeconds,
      })
      .then((saved) => {
        if (saved?.id) setCallLog((log) => log.map((e) => (e.id === tempLogId ? saved : e)));
      })
      .catch((err) => setDbError(err.message || "Could not save the call log entry."));
    removeLeadFromLists(lead.id);
  };

  // Called whenever a call ends (hung up, disconnected, or failed).
  // Mid-session, this opens the wrap-up screen. A one-off call from
  // the table has no wrap-up to force, so it's logged directly — but
  // still remembered (lastAdHocCall) so "Call again"/"Call again with
  // a different number" can offer an immediate redial on it too.
  const handleCallEnded = (lead, durationMs) => {
    if (!lead) return;
    if (!sessionRef.current) {
      logCallDirect(lead, durationMs);
      setLastAdHocCall({ lead, durationMs });
      return;
    }
    // A redial via "Call again" carries the wrap-up screen's in-
    // progress stage/notes forward (see callLeadAgain) rather than
    // losing what was already typed — everything else about this
    // call's outcome still starts fresh.
    const draft = lead.__wrapUpDraft;
    // customStage edits the imported STAGE column (contacts.fields.stage)
    // — the real per-lead pipeline state — rather than the app's fixed
    // status field, which every imported lead defaults to "New Lead".
    setWrapUp({
      lead,
      customStage: draft ? draft.customStage : lead.fields?.stage || "",
      notes: draft ? draft.notes : lead.notes || "",
      durationMs,
      secondsLeft: WRAP_UP_SECONDS,
    });
  };

  // Saves the wrap-up's stage/notes onto the lead, logs the call, and
  // advances the session to the next lead — auto-triggered by the
  // countdown reaching zero, or manually via "Next lead".
  const finishWrapUp = () => {
    if (!wrapUp) return;
    const { lead, customStage, notes, durationMs } = wrapUp;
    // customStage edits the imported STAGE column (contacts.fields.stage)
    // — the real per-lead pipeline state — rather than the app's fixed
    // status field, which every imported lead defaults to "New Lead".
    const status = customStage;
    const durationSeconds = Math.round((durationMs || 0) / 1000);

    // Only log an outcome message when the stage actually changed in
    // this session — re-confirming the same stage isn't news.
    if (customStage && customStage !== (lead.fields?.stage || "")) {
      logStageToConversation(lead, customStage);
    }

    setContacts((cs) =>
      cs.map((c) =>
        c.id === lead.id
          ? { ...c, notes, lastContact: "Today", fields: { ...c.fields, stage: customStage } }
          : c
      )
    );
    const tempLogId = `${lead.id}-${Date.now()}`;
    setCallLog((log) => [
      {
        id: tempLogId,
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        client: lead.client,
        tag: lead.tag,
        status,
        notes,
        durationSeconds,
        userName: authUser?.name,
        calledAt: new Date().toISOString(),
      },
      ...log,
    ]);
    setWrapUp(null);

    // Persist to the database — fire-and-forget, surfaced as a banner
    // on failure rather than blocking the session from moving on.
    api
      .patch("/api/contacts", { id: lead.id, notes, lastContact: "Today", fields: { stage: customStage } })
      .catch((err) => setDbError(err.message || "Could not save the updated lead."));
    api
      .post("/api/call-log", {
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        client: lead.client,
        tag: lead.tag,
        status,
        notes,
        durationSeconds,
      })
      .then((saved) => {
        if (saved?.id) setCallLog((log) => log.map((e) => (e.id === tempLogId ? saved : e)));
      })
      .catch((err) => setDbError(err.message || "Could not save the call log entry."));
    removeLeadFromLists(lead.id);

    if (!session) return;
    const remainingQueue = session.queue.filter((id) => id !== lead.id);
    if (!remainingQueue.length) {
      setSession(null);
      setSessionPaused(false);
      return;
    }
    setSession({ ...session, queue: remainingQueue });
    if (sessionPaused) return; // stay put — Resume will dial the next lead
    dialNextInQueue(remainingQueue, session.lines);
  };

  // Wrap-up countdown — ticks every second, auto-advancing at zero.
  // Frozen while the session is paused, so notes aren't rushed.
  useEffect(() => {
    if (!wrapUp || sessionPaused) return;
    if (wrapUp.secondsLeft <= 0) {
      finishWrapUp();
      return;
    }
    const t = setTimeout(() => {
      setWrapUp((w) => (w ? { ...w, secondsLeft: w.secondsLeft - 1 } : w));
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapUp, sessionPaused]);

  const startCall = async (lead) => {
    setCallError("");
    setActiveLeadId(lead.id);
    setCalling(true);
    setCallStatus("connecting");
    setActiveCallerId("");
    setActiveCallPhone(lead.phone);
    setLastAdHocCall(null); // starting any call retires the previous one's redial card
    callEndedRef.current = false;
    try {
      const { call, callerId } = await placeCall(lead.phone);
      activeCallRef.current = call;
      callStartRef.current = Date.now();
      setActiveCallerId(callerId);

      // Shared end-of-call handling for disconnect/cancel/error alike —
      // guarded so it only ever runs once per call, however it ends
      // (Twilio's own event, or the user hitting "End call" below).
      const onCallEnded = (err) => {
        if (callEndedRef.current) return;
        callEndedRef.current = true;
        setCalling(false);
        setCallStatus("idle");
        setActiveCallerId("");
        activeCallRef.current = null;
        const durationMs = callStartRef.current ? Date.now() - callStartRef.current : 0;
        callStartRef.current = null;

        if (err) {
          // A technical/connection-level failure (bad caller ID,
          // signaling error, …) never actually reached the lead —
          // it isn't a real dial attempt, so don't log it and don't
          // mark the lead called. Pausing an active session here also
          // matters: a failure like this is usually systemic (it'll
          // repeat for every subsequent lead too), so auto-advancing
          // straight into the next call would just as silently mark
          // the whole rest of the list "called" without ever actually
          // ringing anyone — surface the error and let the rep decide
          // instead of burning through the list.
          setCallError(err.message || "The call failed.");
          if (sessionRef.current) setSessionPaused(true);
          return;
        }

        logCallToConversation(lead, durationMs);
        handleCallEnded(lead, durationMs);
      };

      call.on("accept", () => setCallStatus("in-progress"));
      call.on("disconnect", () => onCallEnded());
      call.on("cancel", () => onCallEnded());
      call.on("error", (err) => onCallEnded(err));
    } catch (err) {
      setCallError(err.message || "Could not start the call — check your Twilio setup.");
      setCalling(false);
      setCallStatus("idle");
      setActiveCallerId("");
    }
  };

  const endCall = () => {
    // Just hang up — the call's own 'disconnect' event (registered in
    // startCall/startMultilineCall) does the actual state reset,
    // logging, and wrap-up, so it only ever happens once no matter how
    // the call ends. Also doubles as "Cancel" on a multi-line dial in
    // progress — same hang-up, just before anyone's answered yet.
    hangUp();
  };

  const stopMultilinePolling = () => {
    if (multilinePollRef.current) {
      clearInterval(multilinePollRef.current);
      multilinePollRef.current = null;
    }
  };

  // Best-effort — drops every still-ringing/placed leg in a batch.
  // Used whenever a multi-line dial ends without a winner (the rep
  // hung up early, or their own leg never connected) so the other
  // lines don't keep ringing out on their own. Safe to call even
  // after a winner's already been decided — nothing's left pending to
  // cancel at that point, so it's just a no-op.
  const cancelMultilineBatch = (batchId) => {
    api.post("/api/multiline-cancel", { batchId }).catch(() => {});
  };

  // `giveUpAt` is a client-side backstop, independent of Twilio's own
  // per-leg ring timeout and its status-callback webhooks actually
  // reaching this server — if either of those silently fails to
  // report back (a bad PUBLIC_URL, a dropped webhook, …), the batch
  // would otherwise sit in "dialling" forever with no visible sign
  // anything had gone wrong. A little past when every line should've
  // been given up on Twilio's side (see MULTILINE_RING_SECONDS
  // server-side), give up here too rather than ring indefinitely.
  const startMultilinePolling = (batchId, giveUpAt) => {
    stopMultilinePolling();
    multilinePollRef.current = setInterval(async () => {
      let data;
      try {
        data = await api.get(`/api/multiline-batch?id=${batchId}`);
      } catch {
        return; // transient — try again next tick
      }
      setMultilineBatch((b) => (b && b.id === batchId ? { ...b, candidates: data.calls } : b));

      if (data.status === "connected" && data.winner && !multilineWinnerRef.current) {
        stopMultilinePolling();
        // Prefer the live contact (has notes/fields/tag/etc. for the
        // wrap-up screen and call script) — data.winner is just the
        // id/name/phone snapshot taken when the batch started, used
        // only as a fallback if the contact's since disappeared.
        const winnerLead = dialQueueRef.current.find((l) => l.id === data.winner.leadId) || {
          id: data.winner.leadId,
          name: data.winner.name,
          phone: data.winner.phone,
        };
        multilineWinnerRef.current = winnerLead;
        callStartRef.current = Date.now();
        setActiveLeadId(winnerLead.id);
        setActiveCallPhone(data.winner.phone);
        // Overrides the rep's own conference-join caller id with the
        // number this particular lead was actually dialled from —
        // that's what shows up as "Calling from…" in the live-call
        // view, and it's the number that matters to the lead/rep here.
        if (data.winner.fromNumber) setActiveCallerId(data.winner.fromNumber);
        setCallStatus("in-progress");
        setMultilineBatch(null);
      } else if (data.status === "no-answer" || Date.now() >= giveUpAt) {
        stopMultilinePolling();
        setCallError(
          data.status === "no-answer"
            ? "No answer on any line."
            : "No answer on any line (gave up waiting — Twilio didn't report back in time)."
        );
        // Ends the rep's own conference leg — same 'disconnect' path
        // as hanging up any other call, just with no winner to log.
        hangUp();
        if (batchId) cancelMultilineBatch(batchId); // best-effort — drop any leg still stuck ringing
      }
    }, 1200);
  };

  // Dials several leads at once (see startSession/togglePause/
  // finishWrapUp below), bridging the rep to whichever answers first.
  // The rep's browser leg joins the shared conference immediately;
  // the backend places every lead's leg via the REST API (see
  // api/multiline-start.js), and polling (above) is how the browser
  // finds out who — if anyone — actually picked up.
  const startMultilineCall = async (leadsToTry) => {
    if (!leadsToTry.length || calling) return;
    setCallError("");
    setCalling(true);
    setCallStatus("connecting");
    setActiveLeadId(null);
    setActiveCallPhone("");
    setActiveCallerId("");
    setLastAdHocCall(null);
    multilineWinnerRef.current = null;
    callEndedRef.current = false;

    let batchId;
    try {
      const started = await api.post("/api/multiline-start", { leadIds: leadsToTry.map((l) => l.id) });
      batchId = started.batchId;
      multilineBatchIdRef.current = batchId;
      const ringSeconds = started.ringSeconds || 25;
      const startedAt = Date.now();
      setMultilineBatch({
        id: batchId,
        candidates: started.candidates.map((c) => ({ ...c, status: "placed" })),
        startedAt,
        ringSeconds,
      });

      const { call, callerId } = await joinConference(started.conferenceName);
      activeCallRef.current = call;
      setActiveCallerId(callerId);

      // Same shared end-of-call handling as startCall, plus tearing
      // down whatever's left of the batch.
      const onCallEnded = (err) => {
        if (callEndedRef.current) return;
        callEndedRef.current = true;
        setCalling(false);
        setCallStatus("idle");
        setActiveCallerId("");
        activeCallRef.current = null;
        stopMultilinePolling();
        setMultilineBatch(null);
        if (multilineBatchIdRef.current) {
          cancelMultilineBatch(multilineBatchIdRef.current);
          multilineBatchIdRef.current = null;
        }
        const winner = multilineWinnerRef.current;
        multilineWinnerRef.current = null;
        const durationMs = callStartRef.current ? Date.now() - callStartRef.current : 0;
        callStartRef.current = null;

        if (err) {
          setCallError(err.message || "The call failed.");
          if (sessionRef.current) setSessionPaused(true);
          return;
        }
        if (!winner) return; // rep hung up (or nothing answered) before anyone was bridged — nothing to log

        logCallToConversation(winner, durationMs);
        handleCallEnded(winner, durationMs);
      };

      call.on("disconnect", () => onCallEnded());
      call.on("cancel", () => onCallEnded());
      call.on("error", (err) => onCallEnded(err));

      // A few seconds of slack on top of Twilio's own per-leg ring
      // timeout, so a normal "genuinely nobody answered" resolution
      // (which arrives via the status callback around ringSeconds)
      // isn't raced by this backstop firing first.
      startMultilinePolling(batchId, startedAt + ringSeconds * 1000 + 8000);
    } catch (err) {
      setCallError(err.message || "Could not start multi-line dialling.");
      setCalling(false);
      setCallStatus("idle");
      setMultilineBatch(null);
      if (batchId) cancelMultilineBatch(batchId);
      multilineBatchIdRef.current = null;
    }
  };

  // Shared by session start/resume/advance — dials the next lead(s)
  // in the queue, using multi-line dialling when `lines` > 1 and more
  // than one lead is left to try this round (falls back to a normal
  // single call otherwise, same as lines === 1 always does).
  const dialNextInQueue = (leadIds, lines = 1) => {
    if (!leadIds.length) return;
    if (lines > 1) {
      const batch = leadIds
        .slice(0, lines)
        .map((id) => dialQueue.find((l) => l.id === id))
        .filter(Boolean);
      if (batch.length > 1) return startMultilineCall(batch);
      if (batch.length === 1) return startCall(batch[0]);
      return;
    }
    const lead = dialQueue.find((l) => l.id === leadIds[0]);
    if (lead) startCall(lead);
  };

  // Double-dialling — offered on the wrap-up screen (mid-session) and
  // on the "call ended" card for a one-off call alike. Dismisses
  // whichever post-call screen triggered it and immediately redials
  // the same lead, same number, without advancing a session's queue
  // or logging any outcome yet — that only happens once the *next*
  // call's wrap-up actually finishes (or this one's logged directly,
  // for an ad hoc redial).
  const callLeadAgain = (lead, draft) => {
    setWrapUp(null);
    setLastAdHocCall(null);
    startCall(draft ? { ...lead, __wrapUpDraft: draft } : lead);
  };

  // Same, but for when the number on file turned out to be wrong/
  // disconnected — prompts for the number to actually dial instead.
  // The contact's stored phone number is left untouched; the
  // alternate number is only used for this one redial (and whatever
  // gets logged from it).
  const callLeadAgainWithDifferentNumber = (lead, draft) => {
    const input = window.prompt(`Call ${lead.name} at a different number:`, lead.phone || "");
    const newNumber = input?.trim();
    if (!newNumber) return;
    callLeadAgain({ ...lead, phone: newNumber }, draft);
  };

  if (authLoading) {
    return (
      <div
        className="flex h-screen items-center justify-center gap-2 bg-white text-sm text-gray-400"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  if (!authUser) {
    return (
      <div
        className="flex h-screen items-center justify-center bg-gray-50"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-xl font-bold tracking-tight text-gray-900">Scalbl CRM</div>
            <div className="text-xs text-gray-400 mt-0.5">Lead operations</div>
          </div>
          <form onSubmit={handleAuthSubmit} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-gray-800">
              <Lock size={15} />
              {authMode === "setup" ? "Set your password" : "Log in"}
            </div>

            {authError && (
              <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {authError}
              </div>
            )}

            <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={authForm.email}
              onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full mb-3 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
              placeholder="you@example.com"
            />

            <label className="block text-xs font-medium text-gray-500 mb-1">
              {authMode === "setup" ? "Choose a password" : "Password"}
            </label>
            <input
              type="password"
              autoComplete={authMode === "setup" ? "new-password" : "current-password"}
              value={authForm.password}
              onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full mb-3 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
              placeholder={authMode === "setup" ? "At least 8 characters" : "••••••••"}
            />

            {authMode === "setup" && (
              <>
                <label className="block text-xs font-medium text-gray-500 mb-1">Confirm password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={authForm.confirm}
                  onChange={(e) => setAuthForm((f) => ({ ...f, confirm: e.target.value }))}
                  className="w-full mb-3 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400"
                  placeholder="••••••••"
                />
              </>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full mt-1 flex items-center justify-center gap-2 rounded-md bg-gray-900 text-white text-sm font-medium py-2 hover:bg-gray-800 disabled:opacity-60"
            >
              {authSubmitting && <Loader2 size={14} className="animate-spin" />}
              {authMode === "setup" ? "Set password & log in" : "Log in"}
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode((m) => (m === "setup" ? "login" : "setup"));
                setAuthError("");
              }}
              className="w-full mt-3 text-xs text-gray-400 hover:text-gray-600"
            >
              {authMode === "setup"
                ? "Already have a password? Log in instead"
                : "First time here? Set your password"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (dbLoading) {
    return (
      <div
        className="flex h-screen items-center justify-center gap-2 bg-white text-sm text-gray-400"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white text-gray-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Sidebar */}
      <aside className="w-56 border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="text-lg font-bold tracking-tight">Scalbl CRM</div>
          <div className="text-xs text-gray-400 mt-0.5">Lead operations</div>
        </div>
        <nav className="flex-1 py-3">
          {visibleNavItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setPage(key)}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                page === key
                  ? "bg-gray-100 font-semibold text-gray-900 border-r-2 border-gray-900"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
              }`}
            >
              <Icon size={17} strokeWidth={page === key ? 2.4 : 1.8} />
              {label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400 truncate">{authUser?.name || "Signed in"}</span>
          <button
            onClick={handleLogout}
            title="Log out"
            className="text-gray-300 hover:text-gray-600 shrink-0"
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* Secondary sidebar — narrower + a touch darker than the main
          nav, lets you browse Contacts by client and Powerdialler (or
          Multi Line, which shares the same powerlists) by saved
          powerlist without leaving the page. */}
      {(page === "contacts" || page === "powerdialler" || page === "multiline") && (
        <aside className="w-44 border-r border-gray-200 bg-gray-50 flex flex-col shrink-0 overflow-y-auto">
          {page === "contacts" && (
            <>
              <div className="px-4 pt-5 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Tags</span>
              </div>
              <nav className="flex-1 pb-4">
                <button
                  onClick={() => setTagQuickFilter(null)}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                    !tagQuickFilter
                      ? "bg-white font-semibold text-gray-900 border-r-2 border-gray-900"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                >
                  <span className="truncate">All contacts</span>
                  <span className="text-xs text-gray-400 shrink-0">{contacts.length}</span>
                </button>
                {contactTagNames.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setTagQuickFilter("is", tag)}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                      tagQuickFilter?.op === "is" && tagQuickFilter.value === tag
                        ? "bg-white font-semibold text-gray-900 border-r-2 border-gray-900"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <span className={`truncate text-xs px-2.5 py-1 rounded-full border ${tagColorClasses(tag)}`}>
                      {tag}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{contactTagCounts[tag] || 0}</span>
                  </button>
                ))}
                {contactTagCounts["Untagged"] > 0 && (
                  <button
                    onClick={() => setTagQuickFilter("is empty", "")}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                      tagQuickFilter?.op === "is empty"
                        ? "bg-white font-semibold text-gray-900 border-r-2 border-gray-900"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <span className="truncate text-xs px-2.5 py-1 rounded-full border bg-gray-50 text-gray-400 border-gray-200">
                      Untagged
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{contactTagCounts["Untagged"]}</span>
                  </button>
                )}
                {contactTagNames.length === 0 && !contactTagCounts["Untagged"] && (
                  <div className="px-4 py-2 text-xs text-gray-400">No tags yet</div>
                )}
              </nav>
            </>
          )}

          {(page === "powerdialler" || page === "multiline") && (
            <>
              <div className="px-4 pt-5 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Powerlists
              </div>
              <nav className="flex-1 pb-4">
                <button
                  onClick={() => setDialListFilter("all")}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                    dialListFilter === "all"
                      ? "bg-white font-semibold text-gray-900 border-r-2 border-gray-900"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  }`}
                >
                  <span className="truncate">All leads</span>
                  <span className="text-xs text-gray-400 shrink-0">{dialQueue.length}</span>
                </button>
                {dialLists.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => setDialListFilter(list.id)}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                      dialListFilter === list.id
                        ? "bg-white font-semibold text-gray-900 border-r-2 border-gray-900"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    }`}
                  >
                    <span className="truncate">{list.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{list.leadIds.length}</span>
                  </button>
                ))}
                {dialLists.length === 0 && (
                  <div className="px-4 py-2 text-xs text-gray-400">No saved powerlists yet</div>
                )}
              </nav>
            </>
          )}
        </aside>
      )}

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {dbError && (
          <div className="flex items-start gap-2.5 bg-red-50 border-b border-red-200 px-4 py-2.5 text-sm text-red-700 shrink-0">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">{dbError}</div>
            <button onClick={() => setDbError("")} className="text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Conversation */}
        {page === "conversation" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-80 border-r border-gray-200 flex flex-col">
              <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
                <span className="font-semibold">Conversations</span>
                <div className="flex items-center gap-3">
                  {selectedConvoIds.length > 0 && authUser?.role !== "client" && (
                    <button
                      onClick={deleteSelectedConvos}
                      className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800"
                    >
                      <Trash2 size={13} /> Delete {selectedConvoIds.length}
                    </button>
                  )}
                  <button
                    onClick={() => setShowNewMessage((v) => !v)}
                    className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
                  >
                    <Plus size={13} /> New
                  </button>
                </div>
              </div>
              {showNewMessage && (
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <select
                    autoFocus
                    defaultValue=""
                    onChange={(e) => e.target.value && startNewConversation(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                  >
                    <option value="" disabled>
                      Text a contact…
                    </option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.phone}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {conversations.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-gray-400">
                    No conversations yet — they'll appear automatically after a call or text, or start one with "New".
                  </div>
                )}
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-start gap-2 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${
                      activeConvo === c.id ? "bg-gray-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedConvoIds.includes(c.id)}
                      onChange={() => toggleConvoSelected(c.id)}
                      className="w-4 h-4 rounded border-gray-300 mt-1 shrink-0"
                    />
                    <button onClick={() => setActiveConvo(c.id)} className="flex-1 min-w-0 text-left">
                      <div className="flex justify-between items-center">
                        <span className={`text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.name}</span>
                        <span className="text-xs text-gray-400">{c.time}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {c.unread && <Circle size={7} className="fill-blue-500 text-blue-500 shrink-0" />}
                        <span className="text-xs text-gray-500 truncate">{c.preview}</span>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              {activeConversation ? (
                <>
                  <div className="px-6 py-4 border-b border-gray-100 font-semibold">{activeConversation.name}</div>
                  <div className="flex-1 p-6 space-y-3 overflow-y-auto bg-gray-50/50">
                    {(activeConversation.messages || []).map((m) =>
                      m.type === "call" ? (
                        <div key={m.id} className="flex justify-center">
                          <div className="flex items-center gap-1.5 bg-gray-200/70 text-gray-600 text-xs px-3 py-1.5 rounded-full">
                            <PhoneCall size={12} /> {m.text}
                          </div>
                        </div>
                      ) : m.type === "outcome" ? (
                        <div key={m.id} className="flex justify-center">
                          <div
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${selectOptionColor(
                              stageColumnDef || {},
                              m.text
                            )}`}
                          >
                            <CheckCircle2 size={12} /> Outcome: {m.text}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={m.id}
                          className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm ${
                            m.outgoing
                              ? "bg-gray-900 text-white rounded-tr-sm ml-auto"
                              : "bg-gray-100 rounded-tl-sm"
                          }`}
                        >
                          {m.text}
                        </div>
                      )
                    )}
                  </div>
                  <div className="p-4 border-t border-gray-100 flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <input
                        value={messageDraft}
                        onChange={(e) => setMessageDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendMessage();
                        }}
                        disabled={!activeConversationPhone}
                        placeholder={activeConversationPhone ? "Type a message…" : "No phone number on file"}
                        className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
                      />
                      <button
                        onClick={handleSendMessage}
                        disabled={!messageDraft.trim() || !activeConversationPhone || sendingMessage}
                        className={`flex items-center justify-center bg-gray-900 text-white text-sm px-5 rounded-lg font-medium min-w-[72px] ${
                          sendingMessage ? "" : "disabled:opacity-40 disabled:cursor-not-allowed"
                        }`}
                      >
                        {sendingMessage ? <Loader2 size={15} className="animate-spin" /> : "Send"}
                      </button>
                    </div>
                    <div className="text-xs text-gray-400">Sent as a real SMS via Twilio to {activeConversationPhone || "—"}</div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                  {conversations.length === 0
                    ? 'No conversations yet — they\'ll appear automatically after a call or text, or start one with "New".'
                    : "Select a conversation"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Contacts */}
        {page === "contacts" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
              <div>
                <h1 className="text-xl font-bold">Contacts</h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {contactFilters.map((f) => {
                    const colDef = contactFilterColumnsByKey[f.column];
                    if (!colDef) return null;
                    const isOpen = editingContactFilterId === f.id;
                    return (
                      <div className="relative" key={f.id}>
                        <button
                          onClick={() => setEditingContactFilterId((cur) => (cur === f.id ? null : f.id))}
                          className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white text-gray-800 text-xs font-medium px-3 py-1.5"
                        >
                          <Filter size={12} />
                          {colDef.label} {f.op}
                          {(f.op === "is" || f.op === "is not") && f.value && `: ${f.value}`}
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              removeContactFilter(f.id);
                            }}
                            className="ml-0.5 text-gray-400 hover:text-red-600"
                          >
                            ✕
                          </span>
                        </button>

                        {isOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setEditingContactFilterId(null)} />
                            <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-72">
                              <select
                                value={f.column}
                                onChange={(e) => updateContactFilter(f.id, { column: e.target.value, value: "" })}
                                className="w-full mb-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-gray-400 bg-white"
                              >
                                <optgroup label="Fixed fields">
                                  {contactFilterColumns
                                    .filter((c) => c.key.startsWith("__"))
                                    .map((c) => (
                                      <option key={c.key} value={c.key}>
                                        {c.label}
                                      </option>
                                    ))}
                                </optgroup>
                                <optgroup label="Imported criteria">
                                  {contactFilterColumns
                                    .filter((c) => !c.key.startsWith("__"))
                                    .map((c) => (
                                      <option key={c.key} value={c.key}>
                                        {c.label}
                                      </option>
                                    ))}
                                </optgroup>
                              </select>

                              <select
                                value={f.op}
                                onChange={(e) => updateContactFilter(f.id, { op: e.target.value })}
                                className="w-full mb-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-gray-400 bg-white"
                              >
                                <option value="is">is</option>
                                <option value="is not">is not</option>
                                <option value="is empty">is empty</option>
                                <option value="is not empty">is not empty</option>
                              </select>

                              {(f.op === "is" || f.op === "is not") && (
                                <>
                                  <input
                                    autoFocus
                                    value={f.value}
                                    onChange={(e) => updateContactFilter(f.id, { value: e.target.value })}
                                    placeholder={colDef.kind === "select" ? "Type or pick below…" : "Value…"}
                                    className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-gray-400"
                                  />
                                  {colDef.kind === "select" && (colDef.options || []).length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2 max-h-32 overflow-y-auto">
                                      {colDef.options.map((opt) => (
                                        <button
                                          key={opt}
                                          onClick={() => updateContactFilter(f.id, { value: opt })}
                                          className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${
                                            colDef.optionColor ? colDef.optionColor(opt) : "bg-gray-50 text-gray-600 border-gray-200"
                                          } ${f.value === opt ? "ring-2 ring-offset-1 ring-gray-400" : ""}`}
                                        >
                                          {opt}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}

                              <button
                                onClick={() => removeContactFilter(f.id)}
                                className="mt-3 text-xs text-gray-400 hover:text-red-600"
                              >
                                Remove filter
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  <button
                    onClick={addContactFilter}
                    className="flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 text-xs font-medium px-3 py-1.5"
                  >
                    <Filter size={12} /> + Filter
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                {selectedContactIds.length > 0 && authUser?.role !== "client" && (
                  <button
                    onClick={() => setShowAddToPowerlist(true)}
                    className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-sm px-4 py-2 rounded-lg font-medium"
                  >
                    <ListChecks size={15} /> Add to Powerlist
                  </button>
                )}
                {selectedContactIds.length > 0 && authUser?.role !== "client" && (
                  <button
                    onClick={deleteSelectedContacts}
                    className="flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-sm px-4 py-2 rounded-lg font-medium"
                  >
                    <Trash2 size={15} /> Delete {selectedContactIds.length} selected
                  </button>
                )}
                <div className="relative">
                  <button
                    onClick={() => {
                      setColumnSettingsSearch("");
                      setShowColumnSettings((v) => !v);
                    }}
                    className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-4 py-2 rounded-lg font-medium"
                  >
                    <Settings size={15} /> Columns
                    {hiddenContactColumnKeys.size > 0 && (
                      <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-1.5">
                        {hiddenContactColumnKeys.size} hidden
                      </span>
                    )}
                  </button>
                  {showColumnSettings && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowColumnSettings(false)} />
                      <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-80">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">Show / hide criteria columns</span>
                          {hiddenContactColumnKeys.size > 0 && (
                            <button
                              onClick={() => setHiddenContactColumnKeys(new Set())}
                              className="text-xs text-gray-400 hover:text-red-600"
                            >
                              Show all
                            </button>
                          )}
                        </div>
                        <input
                          autoFocus
                          value={columnSettingsSearch}
                          onChange={(e) => setColumnSettingsSearch(e.target.value)}
                          placeholder="Search columns…"
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-gray-400 mb-2"
                        />
                        <div className="max-h-72 overflow-y-auto space-y-0.5">
                          {contactColumns
                            .filter((col) => col.label.toLowerCase().includes(columnSettingsSearch.toLowerCase()))
                            .map((col) => (
                              <label
                                key={col.id}
                                className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-gray-50 text-sm cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={!hiddenContactColumnKeys.has(col.key)}
                                  onChange={() => toggleContactColumnHidden(col.key)}
                                  className="w-3.5 h-3.5 rounded border-gray-300 shrink-0"
                                />
                                <span className="truncate">{col.label}</span>
                              </label>
                            ))}
                          {contactColumns.filter((col) => col.key !== "stage" && col.label.toLowerCase().includes(columnSettingsSearch.toLowerCase())).length === 0 && (
                            <div className="text-xs text-gray-400 px-1.5 py-2">No columns match "{columnSettingsSearch}"</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search contacts"
                    className="border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-gray-400 w-64"
                  />
                </div>
                {authUser?.role !== "client" && (
                  <button
                    onClick={handleImportContacts}
                    disabled={importingContacts}
                    className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importingContacts ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Upload size={15} />
                    )}
                    {importingContacts
                      ? importProgress
                        ? `Importing ${importProgress.inserted}/${importProgress.total}…`
                        : "Importing…"
                      : "Import leads"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowMoreContactFields(false);
                    setShowAddContact(true);
                  }}
                  className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium"
                >
                  <Plus size={15} /> Add contact
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="pl-8 pr-2 py-2 font-medium w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleContactsSelected}
                        onChange={toggleSelectAllContacts}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    </th>
                    <th className="px-5 py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__leadDate")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Date {sortIndicator("__leadDate")}
                      </button>
                    </th>
                    <th className="px-5 py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__name")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Name {sortIndicator("__name")}
                      </button>
                    </th>
                    <th className="py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__phone")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Phone {sortIndicator("__phone")}
                      </button>
                    </th>
                    <th className="py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__client")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Client {sortIndicator("__client")}
                      </button>
                    </th>
                    <th className="py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__tag")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Tag {sortIndicator("__tag")}
                      </button>
                    </th>
                    <th className="py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("stage")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Stage {sortIndicator("stage")}
                      </button>
                    </th>
                    <th className="py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__status")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Status {sortIndicator("__status")}
                      </button>
                    </th>
                    <th className="py-2 font-medium whitespace-nowrap">
                      <button
                        onClick={() => toggleContactSort("__lastContact")}
                        className="flex items-center gap-1 hover:text-gray-700"
                      >
                        Last contact {sortIndicator("__lastContact")}
                      </button>
                    </th>
                    {visibleContactColumns.map((col) => (
                      <th key={col.id} className="px-3 py-2 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleContactSort(col.key)}
                            className="flex items-center gap-1 hover:text-gray-700"
                          >
                            <span>{col.label}</span>
                            {sortIndicator(col.key)}
                          </button>
                          <button
                            onClick={() => handleDeleteContactColumn(col.id)}
                            className="text-gray-300 hover:text-red-500"
                            title="Delete column"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2">
                      <button
                        onClick={() => setShowAddContactColumn(true)}
                        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 whitespace-nowrap"
                      >
                        <Plus size={13} /> Add column
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedContacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="pl-8 pr-2 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedContactIds.includes(c.id)}
                          onChange={() => toggleContactSelected(c.id)}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                      </td>
                      <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{c.leadDate || "—"}</td>
                      <td className="px-5 py-2.5 font-medium whitespace-nowrap">{c.name}</td>
                      <td className="py-2.5 text-gray-600 whitespace-nowrap">{c.phone}</td>
                      <td className="py-2.5 text-gray-600 whitespace-nowrap">{c.client}</td>
                      <td className="py-2.5 whitespace-nowrap">
                        {c.tag ? (
                          <span className={`text-xs px-2.5 py-1 rounded-full border ${tagColorClasses(c.tag)}`}>
                            {c.tag}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        {stageColumnDef ? (
                          renderContactCell(c, stageColumnDef)
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span className={`text-xs px-2.5 py-1 rounded-full border ${statusColors[c.status]}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-gray-500 whitespace-nowrap">{c.lastContact}</td>
                      {visibleContactColumns.map((col) => (
                        <td key={col.id} className="px-3 py-2.5 min-w-[130px] max-w-[220px]">
                          {renderContactCell(c, col)}
                        </td>
                      ))}
                      <td />
                    </tr>
                  ))}
                  {filteredContacts.length === 0 && (
                    <tr>
                      <td
                        colSpan={visibleContactColumns.length + 10}
                        className="px-8 py-10 text-center text-sm text-gray-400"
                      >
                        No contacts
                        {contactFilters.length > 0 ? ` matching ${contactFilters.length} filter${contactFilters.length === 1 ? "" : "s"}` : ""}
                        {search ? ` match "${search}"` : ""}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredContacts.length > CONTACTS_PAGE_SIZE && (
              <div className="flex items-center justify-between px-8 py-3 border-t border-gray-100 text-sm text-gray-500">
                <span>
                  {contactsPage * CONTACTS_PAGE_SIZE + 1}–
                  {Math.min((contactsPage + 1) * CONTACTS_PAGE_SIZE, filteredContacts.length)} of{" "}
                  {filteredContacts.length}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setContactsPage((p) => Math.max(0, p - 1))}
                    disabled={contactsPage === 0}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-gray-400">
                    Page {contactsPage + 1} of {totalContactsPages}
                  </span>
                  <button
                    onClick={() => setContactsPage((p) => Math.min(totalContactsPages - 1, p + 1))}
                    disabled={contactsPage >= totalContactsPages - 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bulk SMS */}
        {page === "bulk-sms" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Contact picker */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-xl font-bold">Bulk SMS</h1>
                  <div className="text-sm text-gray-400 mt-0.5">
                    {bulkSmsSelectedIds.length} selected
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={bulkSmsTag}
                    onChange={(e) => setBulkSmsTag(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                  >
                    <option value="">All tags</option>
                    {contactTagNames.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input
                      value={bulkSmsSearch}
                      onChange={(e) => setBulkSmsSearch(e.target.value)}
                      placeholder="Search name or phone"
                      className="border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:border-gray-400 w-48"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-2.5 border-b border-gray-100 flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={allBulkSmsFilteredSelected} onChange={toggleSelectAllBulkSmsFiltered} />
                  Select all {bulkSmsFiltered.length} matching contact{bulkSmsFiltered.length === 1 ? "" : "s"}
                </label>
                {bulkSmsSelectedIds.length > 0 && (
                  <button
                    onClick={() => setBulkSmsSelectedIds([])}
                    className="text-gray-400 hover:text-gray-700 font-medium"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {bulkSmsVisible.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-12">
                    No contacts with a phone number match this filter.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {bulkSmsVisible.map((c) => (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                          <td className="pl-6 pr-2 py-2 w-8">
                            <input
                              type="checkbox"
                              checked={bulkSmsSelectedIds.includes(c.id)}
                              onChange={() => toggleBulkSmsContact(c.id)}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium">{c.name}</td>
                          <td className="px-2 py-2 text-gray-500">{c.phone}</td>
                          <td className="px-2 py-2">
                            {c.tag ? (
                              <span className={`text-xs px-2.5 py-1 rounded-full border ${tagColorClasses(c.tag)}`}>
                                {c.tag}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {bulkSmsFiltered.length > BULK_SMS_DISPLAY_LIMIT && (
                  <div className="text-xs text-gray-400 text-center py-3">
                    Showing first {BULK_SMS_DISPLAY_LIMIT} of {bulkSmsFiltered.length} — narrow your search or tag
                    to see more ("Select all" still selects every match, not just what's shown).
                  </div>
                )}
              </div>
            </div>

            {/* Compose */}
            <div className="w-96 flex flex-col shrink-0">
              <div className="px-6 py-4 border-b border-gray-100">
                <span className="font-semibold">Message</span>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
                <textarea
                  value={bulkSmsMessage}
                  onChange={(e) => setBulkSmsMessage(e.target.value)}
                  placeholder="Type the message to send…"
                  rows={8}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
                />
                <div className="text-xs text-gray-400">{bulkSmsMessage.length} characters</div>

                {bulkSmsResult && (
                  <div className="border border-gray-200 rounded-lg p-3 text-xs space-y-1">
                    <div className="font-medium text-gray-700">
                      Sent to {bulkSmsResult.sent} of {bulkSmsResult.total} contact
                      {bulkSmsResult.total === 1 ? "" : "s"}
                    </div>
                    {bulkSmsResult.skipped > 0 && (
                      <div className="text-gray-400">{bulkSmsResult.skipped} skipped (no phone number)</div>
                    )}
                    {bulkSmsResult.failed?.length > 0 && (
                      <div className="text-red-600">
                        {bulkSmsResult.failed.length} failed: {bulkSmsResult.failed.map((f) => f.name).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100">
                <button
                  onClick={handleSendBulkSms}
                  disabled={bulkSmsSending || !bulkSmsMessage.trim() || !bulkSmsSelectedIds.length}
                  className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {bulkSmsSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Send to {bulkSmsSelectedIds.length} contact{bulkSmsSelectedIds.length === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Powerdialler */}
        {page === "powerdialler" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
              <div>
                <h1 className="text-xl font-bold">Powerdialler</h1>
                <div className="text-sm text-gray-400 mt-0.5">
                  {filteredDialQueue.length} lead{filteredDialQueue.length === 1 ? "" : "s"} · newest first
                  {dialListFilter !== "all" &&
                    ` · ${dialLists.find((dl) => dl.id === dialListFilter)?.name || "list"}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {dialListFilter !== "all" && (
                  <button
                    onClick={() => setDialListFilter("all")}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
                  >
                    <X size={14} /> Clear powerlist
                  </button>
                )}
                {dialFiltersActive && (
                  <button
                    onClick={clearAllDialFilters}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
                  >
                    <X size={14} /> Clear filters
                  </button>
                )}
              </div>
            </div>

            {/* Dialler lists — segments the Power Dialler can run through */}
            <div className="px-8 pt-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Dialler lists
              </div>
              <div className="flex flex-wrap gap-3">
                {(() => {
                  const allLeadsIds = filteredDialQueue.map((l) => l.id);
                  const allLeadsRemaining = remainingInList(allLeadsIds);
                  return (
                    <div className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 min-w-[220px]">
                      <div className="flex-1">
                        <div className="text-sm font-semibold">All leads</div>
                        <div className="text-xs text-gray-400">
                          {allLeadsRemaining.length} to call{dialFiltersActive ? " (filtered)" : ""}
                        </div>
                      </div>
                      <button
                        disabled={!!session || !allLeadsRemaining.length}
                        onClick={() => startSession("All leads", allLeadsIds)}
                        className="flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <PhoneCall size={13} /> Start Power Dialler
                      </button>
                    </div>
                  );
                })()}
                {dialLists.map((list) => {
                  const remaining = remainingInList(list.leadIds);
                  return (
                    <div
                      key={list.id}
                      className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 min-w-[220px]"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{list.name}</div>
                        <div className="text-xs text-gray-400">{remaining.length} to call</div>
                      </div>
                      <button
                        disabled={!!session || !remaining.length}
                        onClick={() => startSession(list.name, list.leadIds)}
                        className="flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <PhoneCall size={13} /> Start Power Dialler
                      </button>
                      <button
                        onClick={() => deleteDialList(list.id)}
                        title="Delete list"
                        className="text-gray-300 hover:text-red-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected-rows → save as a new dialler list */}
            {selectedLeadIds.length > 0 && (
              <div className="mx-8 mt-4 flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <ListChecks size={16} className="text-blue-600 shrink-0" />
                <span className="text-sm font-medium text-blue-800">{selectedLeadIds.length} selected</span>
                <input
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Name this list…"
                  className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400 bg-white flex-1 min-w-[160px]"
                />
                <button
                  disabled={!newListName.trim()}
                  onClick={saveSelectedAsList}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save as list
                </button>
                <button
                  onClick={() => setSelectedLeadIds([])}
                  className="text-sm text-blue-700/70 hover:text-blue-900"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Active Power Dialler session */}
            {session && (
              <div
                className={`mx-8 mt-4 flex items-center justify-between border rounded-xl px-4 py-3 ${
                  sessionPaused ? "bg-gray-50 border-gray-200" : "bg-indigo-50 border-indigo-200"
                }`}
              >
                <div className={`text-sm ${sessionPaused ? "text-gray-700" : "text-indigo-800"}`}>
                  <span className="font-semibold">
                    {sessionPaused ? "Power Dialler paused:" : "Power Dialler running:"}
                  </span>{" "}
                  {session.listName} — {session.queue.length} lead{session.queue.length === 1 ? "" : "s"} remaining
                </div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePause}
                    className={`text-sm font-medium ${
                      sessionPaused ? "text-gray-700 hover:text-gray-900" : "text-indigo-700 hover:text-indigo-900"
                    }`}
                  >
                    {sessionPaused ? "Resume" : "Pause"}
                  </button>
                  <button onClick={stopSession} className="text-sm font-medium text-red-600 hover:text-red-800">
                    Stop session
                  </button>
                </div>
              </div>
            )}

            {callError && (
              <div className="mx-8 mt-4 flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="flex-1">{callError}</div>
                <button onClick={() => setCallError("")} className="text-red-400 hover:text-red-600">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Hotseat — the live call, or the post-call wrap-up */}
            <div className="px-8 pt-6">
              {wrapUp ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-widest text-amber-700">
                        Wrap up
                      </div>
                      <div className="text-xl font-bold mt-0.5">{wrapUp.lead.name}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {wrapUp.lead.phone} · {wrapUp.lead.client}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-3xl font-bold tabular-nums ${
                          sessionPaused ? "text-gray-400" : "text-amber-600"
                        }`}
                      >
                        {wrapUp.secondsLeft}s
                      </div>
                      <div className="text-xs text-gray-400">{sessionPaused ? "paused" : "auto-advancing"}</div>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 bg-amber-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ease-linear ${
                        sessionPaused ? "bg-gray-300" : "bg-amber-500"
                      }`}
                      style={{ width: `${(wrapUp.secondsLeft / WRAP_UP_SECONDS) * 100}%` }}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                      <label className="text-xs font-medium text-gray-500 block mb-1">Stage</label>
                      {(() => {
                        const stageCol = contactColumns.find((c) => c.key === "stage");
                        const options = stageCol?.options || [];
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => setWrapUpStatusMenuOpen((v) => !v)}
                              className="w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-gray-400"
                            >
                              {wrapUp.customStage ? (
                                <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(stageCol || {}, wrapUp.customStage)}`}>
                                  {wrapUp.customStage}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                              <ChevronDown size={14} className="text-gray-400" />
                            </button>
                            {wrapUpStatusMenuOpen && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setWrapUpStatusMenuOpen(false)} />
                                <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-full max-h-64 overflow-y-auto">
                                  <button
                                    onClick={() => {
                                      setWrapUp((w) => (w ? { ...w, customStage: "" } : w));
                                      setWrapUpStatusMenuOpen(false);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50 text-xs text-gray-400"
                                  >
                                    —
                                  </button>
                                  {options.map((o) => (
                                    <button
                                      key={o.value}
                                      onClick={() => {
                                        setWrapUp((w) => (w ? { ...w, customStage: o.value } : w));
                                        setWrapUpStatusMenuOpen(false);
                                      }}
                                      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50"
                                    >
                                      <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${SELECT_COLORS[o.color] || SELECT_COLORS.gray}`}>
                                        {o.value}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Notes</label>
                      <textarea
                        value={wrapUp.notes}
                        onChange={(e) => setWrapUp((w) => (w ? { ...w, notes: e.target.value } : w))}
                        rows={2}
                        placeholder="What happened on this call?"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          callLeadAgain(wrapUp.lead, { customStage: wrapUp.customStage, notes: wrapUp.notes })
                        }
                        className="flex items-center gap-1.5 border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                      >
                        <PhoneCall size={14} /> Call again
                      </button>
                      <button
                        onClick={() =>
                          callLeadAgainWithDifferentNumber(wrapUp.lead, {
                            customStage: wrapUp.customStage,
                            notes: wrapUp.notes,
                          })
                        }
                        className="flex items-center gap-1.5 border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                      >
                        <PhoneCall size={14} /> Call again with different number
                      </button>
                    </div>
                    <button
                      onClick={finishWrapUp}
                      className="bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-semibold"
                    >
                      Next lead
                    </button>
                  </div>
                </div>
              ) : calling && activeLead ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3 w-3 shrink-0">
                        <span
                          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            callStatus === "connecting" ? "bg-amber-400" : "bg-green-400"
                          }`}
                        />
                        <span
                          className={`relative inline-flex rounded-full h-3 w-3 ${
                            callStatus === "connecting" ? "bg-amber-500" : "bg-green-600"
                          }`}
                        />
                      </span>
                      <div
                        className={`text-xs font-semibold uppercase tracking-widest ${
                          callStatus === "connecting" ? "text-amber-700" : "text-green-700"
                        }`}
                      >
                        {callStatus === "connecting" ? "Connecting…" : "Live call"}
                      </div>
                      {activeCallerId && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 bg-white/70 border border-green-100 rounded-full px-2.5 py-1">
                          <PhoneCall size={11} /> Calling from {activeCallerId}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={endCall}
                      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-full font-semibold shrink-0"
                    >
                      <PhoneOff size={15} /> End call
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1.3fr] gap-6 md:items-center">
                    {/* Left: who you're talking to */}
                    <div>
                      <div className="text-xl font-bold">{activeLead.name}</div>
                      <div className="text-sm text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>
                          {activeCallPhone || activeLead.phone}
                          {activeCallPhone && activeCallPhone !== activeLead.phone && (
                            <span className="ml-1.5 text-xs text-amber-600 font-medium">(different number)</span>
                          )}
                        </span>
                        <span>{activeLead.email}</span>
                        <span>{activeLead.client}</span>
                      </div>
                      {activeLead.notes && (
                        <div className="mt-3 bg-white/70 border border-green-100 rounded-lg px-3 py-2 text-sm text-gray-600">
                          {activeLead.notes}
                        </div>
                      )}
                    </div>

                    {/* Right: the client's call script, front and centre */}
                    {(() => {
                      const activeClient = getClient(activeLead.client);
                      return (
                        <div className="bg-white border border-green-100 rounded-xl px-5 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                              {activeLead.client} script
                            </div>
                            {activeClient?.script && (
                              <a
                                href={activeClient.script}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink size={12} /> Full script
                              </a>
                            )}
                          </div>
                          {activeClient?.scriptSteps?.length ? (
                            <ol className="space-y-1.5 text-sm text-gray-700 list-decimal list-inside">
                              {activeClient.scriptSteps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          ) : (
                            <div className="text-sm text-gray-400">No script on file for this client.</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Soundboard — quick-play clips that go through the
                      call itself, e.g. a canned response to a phone's
                      call-screening prompt. */}
                  <div className="mt-4 pt-4 border-t border-green-100">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Soundboard — plays through the call
                      </div>
                      <button
                        onClick={() => setShowSoundboardRecorder(true)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
                      >
                        <Mic size={12} /> Record clip
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {soundboardClips.map((clip) => (
                        <div key={clip.id} className="group relative">
                          <button
                            onClick={() => handlePlaySoundboardClip(clip)}
                            disabled={!!playingClipId}
                            title="Play into the call"
                            className="flex items-center gap-1.5 bg-white border border-green-200 text-gray-700 hover:bg-green-50 text-xs pl-2.5 pr-6 py-1.5 rounded-full font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {playingClipId === clip.id ? (
                              <Loader2 size={12} className="animate-spin shrink-0" />
                            ) : (
                              <Play size={12} className="shrink-0" />
                            )}
                            {clip.label}
                          </button>
                          <button
                            onClick={() => deleteSoundboardClipRow(clip.id)}
                            title="Delete this clip"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                      {soundboardClips.length === 0 && (
                        <span className="text-xs text-gray-400">
                          No clips yet — record a quick reply for things like a phone's call-screening prompt.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : lastAdHocCall ? (
                // A one-off call (outside a session) has no forced wrap-up,
                // but still gets offered a quick redial before this card is
                // replaced by the next call or dismissed.
                <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                        Call ended
                      </div>
                      <div className="text-xl font-bold mt-0.5">{lastAdHocCall.lead.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {lastAdHocCall.lead.phone} · {formatCallDuration(lastAdHocCall.durationMs)}
                      </div>
                    </div>
                    <button
                      onClick={() => setLastAdHocCall(null)}
                      title="Dismiss"
                      className="text-gray-300 hover:text-gray-600 shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => callLeadAgain(lastAdHocCall.lead)}
                      className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                    >
                      <PhoneCall size={14} /> Call again
                    </button>
                    <button
                      onClick={() => callLeadAgainWithDifferentNumber(lastAdHocCall.lead)}
                      className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                    >
                      <PhoneCall size={14} /> Call again with different number
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 border border-dashed border-gray-200 rounded-2xl px-6 py-5 text-gray-400">
                  <Phone size={18} />
                  <span className="text-sm">
                    No live call — hit <span className="font-medium text-gray-500">Call</span> on a lead below to start the hotseat.
                  </span>
                </div>
              )}
            </div>

            <div className="p-8">
              <div className="border border-gray-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                      <th className="pl-5 pr-2 py-3 font-medium w-8" />
                      <th className="px-5 py-3 font-medium whitespace-nowrap">Date</th>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Email</th>
                      <th className="px-5 py-3 font-medium">Phone</th>
                      <th className="px-5 py-3 font-medium">Client</th>
                      <th className="px-5 py-3 font-medium whitespace-nowrap">Stage</th>
                      <th className="px-5 py-3 font-medium">Notes</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      {visibleDialColumns.map((col) => (
                        <th key={col.id} className="px-5 py-3 font-medium whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      <th className="px-5 py-3 font-medium">Script</th>
                      <th className="px-5 py-3 font-medium text-right">Action</th>
                    </tr>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="pl-5 pr-2 pb-3" />
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.leadDate}
                          onChange={(e) => updateDialFilter("leadDate", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.name}
                          onChange={(e) => updateDialFilter("name", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.email}
                          onChange={(e) => updateDialFilter("email", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.phone}
                          onChange={(e) => updateDialFilter("phone", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <select
                          value={dialFilters.client}
                          onChange={(e) => updateDialFilter("client", e.target.value)}
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        >
                          {dialClientOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        {stageColumnDef && renderDialColumnFilter(stageColumnDef)}
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.notes}
                          onChange={(e) => updateDialFilter("notes", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <select
                          value={dialFilters.status}
                          onChange={(e) => updateDialFilter("status", e.target.value)}
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        >
                          {dialStatusOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </th>
                      {visibleDialColumns.map((col) => (
                        <th key={col.id} className="px-5 pb-3 font-normal">
                          {renderDialColumnFilter(col)}
                        </th>
                      ))}
                      <th className="px-5 pb-3" />
                      <th className="px-5 pb-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedDialQueue.map((lead) => (
                      <tr
                        key={lead.id}
                        className={`border-b border-gray-50 last:border-0 hover:bg-gray-50 ${
                          activeLead?.id === lead.id ? "bg-gray-50" : ""
                        }`}
                      >
                        <td className="pl-5 pr-2 py-3.5">
                          <input
                            type="checkbox"
                            checked={selectedLeadIds.includes(lead.id)}
                            onChange={() => toggleLeadSelected(lead.id)}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 whitespace-nowrap">{lead.leadDate || "—"}</td>
                        <td className="px-5 py-3.5 font-medium">{lead.name}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.email}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.phone}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.client}</td>
                        <td className="px-5 py-3.5">
                          {lead.fields?.stage ? (
                            <span
                              className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(
                                stageColumnDef || {},
                                lead.fields.stage
                              )}`}
                            >
                              {lead.fields.stage}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 max-w-xs truncate" title={lead.notes}>
                          {lead.notes}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2.5 py-1 rounded-full border ${statusColors[lead.status]}`}>
                            {lead.status}
                          </span>
                        </td>
                        {visibleDialColumns.map((col) => {
                          const val = lead.fields?.[col.key];
                          if (col.type === "checkbox") {
                            return (
                              <td key={col.id} className="px-5 py-3.5 text-gray-500">
                                {val ? "Yes" : "No"}
                              </td>
                            );
                          }
                          if (col.type === "select") {
                            return (
                              <td key={col.id} className="px-5 py-3.5">
                                {val ? (
                                  <span
                                    className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(
                                      col,
                                      val
                                    )}`}
                                  >
                                    {val}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>
                            );
                          }
                          const display = formatDynamicCellDisplay(col, val);
                          return (
                            <td key={col.id} className="px-5 py-3.5 text-gray-500 max-w-xs truncate" title={display}>
                              {display !== null ? display : <span className="text-gray-300">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-5 py-3.5">
                          {getClient(lead.client)?.script ? (
                            <a
                              href={getClient(lead.client).script}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                            >
                              <ExternalLink size={13} /> Script
                            </a>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {calling && activeLead?.id === lead.id ? (
                            <button
                              onClick={endCall}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              <PhoneOff size={14} /> End
                            </button>
                          ) : (
                            <button
                              disabled={calling}
                              onClick={() => startCall(lead)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <PhoneCall size={14} /> Call
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredDialQueue.length === 0 && (
                      <tr>
                        <td
                          colSpan={11 + visibleDialColumns.length}
                          className="px-5 py-10 text-center text-sm text-gray-400"
                        >
                          No leads match the current filters
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredDialQueue.length > DIAL_QUEUE_PAGE_SIZE && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
                  <span>
                    {dialQueuePage * DIAL_QUEUE_PAGE_SIZE + 1}–
                    {Math.min((dialQueuePage + 1) * DIAL_QUEUE_PAGE_SIZE, filteredDialQueue.length)} of{" "}
                    {filteredDialQueue.length}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setDialQueuePage((p) => Math.max(0, p - 1))}
                      disabled={dialQueuePage === 0}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-400">
                      Page {dialQueuePage + 1} of {totalDialQueuePages}
                    </span>
                    <button
                      onClick={() => setDialQueuePage((p) => Math.min(totalDialQueuePages - 1, p + 1))}
                      disabled={dialQueuePage >= totalDialQueuePages - 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Multi Line — same dialler lists/queue/wrap-up engine as
            Powerdialler, forced into multi-line mode (see startSession's
            `lines` argument and dialNextInQueue) */}
        {page === "multiline" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
              <div>
                <h1 className="text-xl font-bold">Multi Line</h1>
                <div className="text-sm text-gray-400 mt-0.5">
                  {filteredDialQueue.length} lead{filteredDialQueue.length === 1 ? "" : "s"} · newest first
                  {dialListFilter !== "all" &&
                    ` · ${dialLists.find((dl) => dl.id === dialListFilter)?.name || "list"}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {dialListFilter !== "all" && (
                  <button
                    onClick={() => setDialListFilter("all")}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
                  >
                    <X size={14} /> Clear powerlist
                  </button>
                )}
                {dialFiltersActive && (
                  <button
                    onClick={clearAllDialFilters}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
                  >
                    <X size={14} /> Clear filters
                  </button>
                )}
              </div>
            </div>

            {/* Dialler lists — segments the Power Dialler can run through */}
            <div className="px-8 pt-6">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Dialler lists</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500">Lines</span>
                  <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                    {[2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={!!session || calling}
                        onClick={() => setMultiLines(n)}
                        title={`Dial ${n} leads at once — first to answer gets connected, the rest hang up`}
                        className={`px-2.5 py-1 text-xs font-semibold border-r border-gray-200 last:border-r-0 disabled:cursor-not-allowed disabled:opacity-40 ${
                          multiLines === n ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {(() => {
                  const allLeadsIds = filteredDialQueue.map((l) => l.id);
                  const allLeadsRemaining = remainingInList(allLeadsIds);
                  return (
                    <div className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 min-w-[220px]">
                      <div className="flex-1">
                        <div className="text-sm font-semibold">All leads</div>
                        <div className="text-xs text-gray-400">
                          {allLeadsRemaining.length} to call{dialFiltersActive ? " (filtered)" : ""}
                        </div>
                      </div>
                      <button
                        disabled={!!session || !allLeadsRemaining.length}
                        onClick={() => startSession("All leads", allLeadsIds, multiLines)}
                        className="flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <PhoneCall size={13} /> Start Multi-Line Dialler
                      </button>
                    </div>
                  );
                })()}
                {dialLists.map((list) => {
                  const remaining = remainingInList(list.leadIds);
                  return (
                    <div
                      key={list.id}
                      className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 min-w-[220px]"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{list.name}</div>
                        <div className="text-xs text-gray-400">{remaining.length} to call</div>
                      </div>
                      <button
                        disabled={!!session || !remaining.length}
                        onClick={() => startSession(list.name, list.leadIds, multiLines)}
                        className="flex items-center gap-1.5 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <PhoneCall size={13} /> Start Multi-Line Dialler
                      </button>
                      <button
                        onClick={() => deleteDialList(list.id)}
                        title="Delete list"
                        className="text-gray-300 hover:text-red-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected-rows → save as a new dialler list */}
            {selectedLeadIds.length > 0 && (
              <div className="mx-8 mt-4 flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <ListChecks size={16} className="text-blue-600 shrink-0" />
                <span className="text-sm font-medium text-blue-800">{selectedLeadIds.length} selected</span>
                <input
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Name this list…"
                  className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400 bg-white flex-1 min-w-[160px]"
                />
                <button
                  disabled={!newListName.trim()}
                  onClick={saveSelectedAsList}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save as list
                </button>
                <button
                  onClick={() => setSelectedLeadIds([])}
                  className="text-sm text-blue-700/70 hover:text-blue-900"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Active Power Dialler session */}
            {session && (
              <div
                className={`mx-8 mt-4 flex items-center justify-between border rounded-xl px-4 py-3 ${
                  sessionPaused ? "bg-gray-50 border-gray-200" : "bg-indigo-50 border-indigo-200"
                }`}
              >
                <div className={`text-sm ${sessionPaused ? "text-gray-700" : "text-indigo-800"}`}>
                  <span className="font-semibold">
                    {sessionPaused ? "Multi-Line Dialler paused:" : "Multi-Line Dialler running:"}
                  </span>{" "}
                  {session.listName} — {session.queue.length} lead{session.queue.length === 1 ? "" : "s"} remaining
                </div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePause}
                    className={`text-sm font-medium ${
                      sessionPaused ? "text-gray-700 hover:text-gray-900" : "text-indigo-700 hover:text-indigo-900"
                    }`}
                  >
                    {sessionPaused ? "Resume" : "Pause"}
                  </button>
                  <button onClick={stopSession} className="text-sm font-medium text-red-600 hover:text-red-800">
                    Stop session
                  </button>
                </div>
              </div>
            )}

            {callError && (
              <div className="mx-8 mt-4 flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="flex-1">{callError}</div>
                <button onClick={() => setCallError("")} className="text-red-400 hover:text-red-600">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Hotseat — the live call, or the post-call wrap-up */}
            <div className="px-8 pt-6">
              {multilineBatch ? (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl px-6 py-5">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2.5">
                      <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />
                      <div className="text-sm font-semibold text-blue-800">
                        Dialling {multilineBatch.candidates.length} lines at once — first to answer gets connected
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const elapsed = Math.max(
                          0,
                          Math.floor((Date.now() - multilineBatch.startedAt) / 1000)
                        );
                        const remaining = Math.max(0, multilineBatch.ringSeconds - elapsed);
                        return (
                          <span className="text-xs text-blue-700/70 font-medium tabular-nums shrink-0">
                            {remaining > 0
                              ? `Ringing… gives up in ${remaining}s`
                              : "Wrapping up — waiting on the last line…"}
                          </span>
                        );
                      })()}
                      <button
                        onClick={endCall}
                        className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-full font-semibold shrink-0"
                      >
                        <PhoneOff size={15} /> Cancel
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {multilineBatch.candidates.map((c) => (
                      <div
                        key={c.leadId}
                        className="flex items-center justify-between gap-3 bg-white border border-blue-100 rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          <div className="text-xs text-gray-400 truncate">
                            {c.phone}
                            {c.fromNumber && <span> · from {c.fromNumber}</span>}
                          </div>
                          {/* The call never actually reached Twilio's dial queue at
                              all — e.g. a badly-formatted number, or an unverified
                              number on a trial Twilio account — as opposed to a
                              normal ring-then-no-answer. */}
                          {c.status === "failed" && c.errorMessage && (
                            <div className="text-xs text-red-500 truncate mt-0.5" title={c.errorMessage}>
                              {c.errorMessage}
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${multilineStatusColor(c.status)}`}
                        >
                          {multilineStatusLabel(c.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : wrapUp ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-widest text-amber-700">
                        Wrap up
                      </div>
                      <div className="text-xl font-bold mt-0.5">{wrapUp.lead.name}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {wrapUp.lead.phone} · {wrapUp.lead.client}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-3xl font-bold tabular-nums ${
                          sessionPaused ? "text-gray-400" : "text-amber-600"
                        }`}
                      >
                        {wrapUp.secondsLeft}s
                      </div>
                      <div className="text-xs text-gray-400">{sessionPaused ? "paused" : "auto-advancing"}</div>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 bg-amber-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ease-linear ${
                        sessionPaused ? "bg-gray-300" : "bg-amber-500"
                      }`}
                      style={{ width: `${(wrapUp.secondsLeft / WRAP_UP_SECONDS) * 100}%` }}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                      <label className="text-xs font-medium text-gray-500 block mb-1">Stage</label>
                      {(() => {
                        const stageCol = contactColumns.find((c) => c.key === "stage");
                        const options = stageCol?.options || [];
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => setWrapUpStatusMenuOpen((v) => !v)}
                              className="w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-gray-400"
                            >
                              {wrapUp.customStage ? (
                                <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(stageCol || {}, wrapUp.customStage)}`}>
                                  {wrapUp.customStage}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                              <ChevronDown size={14} className="text-gray-400" />
                            </button>
                            {wrapUpStatusMenuOpen && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setWrapUpStatusMenuOpen(false)} />
                                <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-full max-h-64 overflow-y-auto">
                                  <button
                                    onClick={() => {
                                      setWrapUp((w) => (w ? { ...w, customStage: "" } : w));
                                      setWrapUpStatusMenuOpen(false);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50 text-xs text-gray-400"
                                  >
                                    —
                                  </button>
                                  {options.map((o) => (
                                    <button
                                      key={o.value}
                                      onClick={() => {
                                        setWrapUp((w) => (w ? { ...w, customStage: o.value } : w));
                                        setWrapUpStatusMenuOpen(false);
                                      }}
                                      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-gray-50"
                                    >
                                      <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${SELECT_COLORS[o.color] || SELECT_COLORS.gray}`}>
                                        {o.value}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Notes</label>
                      <textarea
                        value={wrapUp.notes}
                        onChange={(e) => setWrapUp((w) => (w ? { ...w, notes: e.target.value } : w))}
                        rows={2}
                        placeholder="What happened on this call?"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          callLeadAgain(wrapUp.lead, { customStage: wrapUp.customStage, notes: wrapUp.notes })
                        }
                        className="flex items-center gap-1.5 border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                      >
                        <PhoneCall size={14} /> Call again
                      </button>
                      <button
                        onClick={() =>
                          callLeadAgainWithDifferentNumber(wrapUp.lead, {
                            customStage: wrapUp.customStage,
                            notes: wrapUp.notes,
                          })
                        }
                        className="flex items-center gap-1.5 border border-amber-300 bg-white text-amber-700 hover:bg-amber-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                      >
                        <PhoneCall size={14} /> Call again with different number
                      </button>
                    </div>
                    <button
                      onClick={finishWrapUp}
                      className="bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-semibold"
                    >
                      Next lead
                    </button>
                  </div>
                </div>
              ) : calling && activeLead ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3 w-3 shrink-0">
                        <span
                          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            callStatus === "connecting" ? "bg-amber-400" : "bg-green-400"
                          }`}
                        />
                        <span
                          className={`relative inline-flex rounded-full h-3 w-3 ${
                            callStatus === "connecting" ? "bg-amber-500" : "bg-green-600"
                          }`}
                        />
                      </span>
                      <div
                        className={`text-xs font-semibold uppercase tracking-widest ${
                          callStatus === "connecting" ? "text-amber-700" : "text-green-700"
                        }`}
                      >
                        {callStatus === "connecting" ? "Connecting…" : "Live call"}
                      </div>
                      {activeCallerId && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 bg-white/70 border border-green-100 rounded-full px-2.5 py-1">
                          <PhoneCall size={11} /> Calling from {activeCallerId}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={endCall}
                      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-full font-semibold shrink-0"
                    >
                      <PhoneOff size={15} /> End call
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1.3fr] gap-6 md:items-center">
                    {/* Left: who you're talking to */}
                    <div>
                      <div className="text-xl font-bold">{activeLead.name}</div>
                      <div className="text-sm text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>
                          {activeCallPhone || activeLead.phone}
                          {activeCallPhone && activeCallPhone !== activeLead.phone && (
                            <span className="ml-1.5 text-xs text-amber-600 font-medium">(different number)</span>
                          )}
                        </span>
                        <span>{activeLead.email}</span>
                        <span>{activeLead.client}</span>
                      </div>
                      {activeLead.notes && (
                        <div className="mt-3 bg-white/70 border border-green-100 rounded-lg px-3 py-2 text-sm text-gray-600">
                          {activeLead.notes}
                        </div>
                      )}
                    </div>

                    {/* Right: the client's call script, front and centre */}
                    {(() => {
                      const activeClient = getClient(activeLead.client);
                      return (
                        <div className="bg-white border border-green-100 rounded-xl px-5 py-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                              {activeLead.client} script
                            </div>
                            {activeClient?.script && (
                              <a
                                href={activeClient.script}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink size={12} /> Full script
                              </a>
                            )}
                          </div>
                          {activeClient?.scriptSteps?.length ? (
                            <ol className="space-y-1.5 text-sm text-gray-700 list-decimal list-inside">
                              {activeClient.scriptSteps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          ) : (
                            <div className="text-sm text-gray-400">No script on file for this client.</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Soundboard — quick-play clips that go through the
                      call itself, e.g. a canned response to a phone's
                      call-screening prompt. */}
                  <div className="mt-4 pt-4 border-t border-green-100">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Soundboard — plays through the call
                      </div>
                      <button
                        onClick={() => setShowSoundboardRecorder(true)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
                      >
                        <Mic size={12} /> Record clip
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {soundboardClips.map((clip) => (
                        <div key={clip.id} className="group relative">
                          <button
                            onClick={() => handlePlaySoundboardClip(clip)}
                            disabled={!!playingClipId}
                            title="Play into the call"
                            className="flex items-center gap-1.5 bg-white border border-green-200 text-gray-700 hover:bg-green-50 text-xs pl-2.5 pr-6 py-1.5 rounded-full font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {playingClipId === clip.id ? (
                              <Loader2 size={12} className="animate-spin shrink-0" />
                            ) : (
                              <Play size={12} className="shrink-0" />
                            )}
                            {clip.label}
                          </button>
                          <button
                            onClick={() => deleteSoundboardClipRow(clip.id)}
                            title="Delete this clip"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                      {soundboardClips.length === 0 && (
                        <span className="text-xs text-gray-400">
                          No clips yet — record a quick reply for things like a phone's call-screening prompt.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : lastAdHocCall ? (
                // A one-off call (outside a session) has no forced wrap-up,
                // but still gets offered a quick redial before this card is
                // replaced by the next call or dismissed.
                <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                        Call ended
                      </div>
                      <div className="text-xl font-bold mt-0.5">{lastAdHocCall.lead.name}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {lastAdHocCall.lead.phone} · {formatCallDuration(lastAdHocCall.durationMs)}
                      </div>
                    </div>
                    <button
                      onClick={() => setLastAdHocCall(null)}
                      title="Dismiss"
                      className="text-gray-300 hover:text-gray-600 shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => callLeadAgain(lastAdHocCall.lead)}
                      className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                    >
                      <PhoneCall size={14} /> Call again
                    </button>
                    <button
                      onClick={() => callLeadAgainWithDifferentNumber(lastAdHocCall.lead)}
                      className="flex items-center gap-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 text-sm px-3.5 py-2 rounded-lg font-medium"
                    >
                      <PhoneCall size={14} /> Call again with different number
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 border border-dashed border-gray-200 rounded-2xl px-6 py-5 text-gray-400">
                  <Phone size={18} />
                  <span className="text-sm">
                    No live call — hit <span className="font-medium text-gray-500">Call</span> on a lead below to start the hotseat.
                  </span>
                </div>
              )}
            </div>

            <div className="p-8">
              <div className="border border-gray-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                      <th className="pl-5 pr-2 py-3 font-medium w-8" />
                      <th className="px-5 py-3 font-medium whitespace-nowrap">Date</th>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Email</th>
                      <th className="px-5 py-3 font-medium">Phone</th>
                      <th className="px-5 py-3 font-medium">Client</th>
                      <th className="px-5 py-3 font-medium whitespace-nowrap">Stage</th>
                      <th className="px-5 py-3 font-medium">Notes</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      {visibleDialColumns.map((col) => (
                        <th key={col.id} className="px-5 py-3 font-medium whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      <th className="px-5 py-3 font-medium">Script</th>
                      <th className="px-5 py-3 font-medium text-right">Action</th>
                    </tr>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="pl-5 pr-2 pb-3" />
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.leadDate}
                          onChange={(e) => updateDialFilter("leadDate", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.name}
                          onChange={(e) => updateDialFilter("name", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.email}
                          onChange={(e) => updateDialFilter("email", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.phone}
                          onChange={(e) => updateDialFilter("phone", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <select
                          value={dialFilters.client}
                          onChange={(e) => updateDialFilter("client", e.target.value)}
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        >
                          {dialClientOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        {stageColumnDef && renderDialColumnFilter(stageColumnDef)}
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <input
                          value={dialFilters.notes}
                          onChange={(e) => updateDialFilter("notes", e.target.value)}
                          placeholder="Filter…"
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        />
                      </th>
                      <th className="px-5 pb-3 font-normal">
                        <select
                          value={dialFilters.status}
                          onChange={(e) => updateDialFilter("status", e.target.value)}
                          className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs font-normal normal-case outline-none focus:border-gray-400 bg-white"
                        >
                          {dialStatusOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </th>
                      {visibleDialColumns.map((col) => (
                        <th key={col.id} className="px-5 pb-3 font-normal">
                          {renderDialColumnFilter(col)}
                        </th>
                      ))}
                      <th className="px-5 pb-3" />
                      <th className="px-5 pb-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedDialQueue.map((lead) => (
                      <tr
                        key={lead.id}
                        className={`border-b border-gray-50 last:border-0 hover:bg-gray-50 ${
                          activeLead?.id === lead.id ? "bg-gray-50" : ""
                        }`}
                      >
                        <td className="pl-5 pr-2 py-3.5">
                          <input
                            type="checkbox"
                            checked={selectedLeadIds.includes(lead.id)}
                            onChange={() => toggleLeadSelected(lead.id)}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 whitespace-nowrap">{lead.leadDate || "—"}</td>
                        <td className="px-5 py-3.5 font-medium">{lead.name}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.email}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.phone}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.client}</td>
                        <td className="px-5 py-3.5">
                          {lead.fields?.stage ? (
                            <span
                              className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(
                                stageColumnDef || {},
                                lead.fields.stage
                              )}`}
                            >
                              {lead.fields.stage}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 max-w-xs truncate" title={lead.notes}>
                          {lead.notes}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2.5 py-1 rounded-full border ${statusColors[lead.status]}`}>
                            {lead.status}
                          </span>
                        </td>
                        {visibleDialColumns.map((col) => {
                          const val = lead.fields?.[col.key];
                          if (col.type === "checkbox") {
                            return (
                              <td key={col.id} className="px-5 py-3.5 text-gray-500">
                                {val ? "Yes" : "No"}
                              </td>
                            );
                          }
                          if (col.type === "select") {
                            return (
                              <td key={col.id} className="px-5 py-3.5">
                                {val ? (
                                  <span
                                    className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${selectOptionColor(
                                      col,
                                      val
                                    )}`}
                                  >
                                    {val}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>
                            );
                          }
                          const display = formatDynamicCellDisplay(col, val);
                          return (
                            <td key={col.id} className="px-5 py-3.5 text-gray-500 max-w-xs truncate" title={display}>
                              {display !== null ? display : <span className="text-gray-300">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-5 py-3.5">
                          {getClient(lead.client)?.script ? (
                            <a
                              href={getClient(lead.client).script}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                            >
                              <ExternalLink size={13} /> Script
                            </a>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {calling && activeLead?.id === lead.id ? (
                            <button
                              onClick={endCall}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              <PhoneOff size={14} /> End
                            </button>
                          ) : (
                            <button
                              disabled={calling}
                              onClick={() => startCall(lead)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <PhoneCall size={14} /> Call
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredDialQueue.length === 0 && (
                      <tr>
                        <td
                          colSpan={11 + visibleDialColumns.length}
                          className="px-5 py-10 text-center text-sm text-gray-400"
                        >
                          No leads match the current filters
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredDialQueue.length > DIAL_QUEUE_PAGE_SIZE && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
                  <span>
                    {dialQueuePage * DIAL_QUEUE_PAGE_SIZE + 1}–
                    {Math.min((dialQueuePage + 1) * DIAL_QUEUE_PAGE_SIZE, filteredDialQueue.length)} of{" "}
                    {filteredDialQueue.length}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setDialQueuePage((p) => Math.max(0, p - 1))}
                      disabled={dialQueuePage === 0}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-400">
                      Page {dialQueuePage + 1} of {totalDialQueuePages}
                    </span>
                    <button
                      onClick={() => setDialQueuePage((p) => Math.min(totalDialQueuePages - 1, p + 1))}
                      disabled={dialQueuePage >= totalDialQueuePages - 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Log */}
        {page === "log" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 border-b border-gray-100">
              <h1 className="text-xl font-bold">Call log</h1>
              <div className="text-sm text-gray-400 mt-0.5">
                {callLog.length} call{callLog.length === 1 ? "" : "s"} logged
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-8 py-3 font-medium">Lead</th>
                  <th className="py-3 font-medium">Client</th>
                  <th className="py-3 font-medium">Phone</th>
                  <th className="py-3 font-medium">Outcome</th>
                  <th className="py-3 font-medium">Notes</th>
                  <th className="py-3 font-medium">Rep</th>
                  <th className="py-3 font-medium">Duration</th>
                  <th className="py-3 font-medium">Called</th>
                </tr>
              </thead>
              <tbody>
                {callLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-8 py-3.5 font-medium">{entry.name}</td>
                    <td className="py-3.5 text-gray-600">{entry.client}</td>
                    <td className="py-3.5 text-gray-600">{entry.phone}</td>
                    <td className="py-3.5">
                      {entry.status ? (
                        <span className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${callOutcomeColor(entry.status)}`}>
                          {entry.status}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3.5 text-gray-500 max-w-xs truncate" title={entry.notes}>
                      {entry.notes || "—"}
                    </td>
                    <td className="py-3.5 text-gray-500 whitespace-nowrap">{entry.userName || "—"}</td>
                    <td className="py-3.5 text-gray-500 whitespace-nowrap">
                      {entry.durationSeconds != null ? formatCallDuration(entry.durationSeconds * 1000) : "—"}
                    </td>
                    <td className="py-3.5 text-gray-400">
                      {new Date(entry.calledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
                {callLog.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-8 py-10 text-center text-sm text-gray-400">
                      No calls logged yet — run the Power Dialler to start logging calls.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Reports */}
        {page === "reports" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100 flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-bold">Reports</h1>
                <div className="text-sm text-gray-400 mt-0.5">
                  {reportsTotalCalls} call{reportsTotalCalls === 1 ? "" : "s"} in range
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={reportsFrom}
                  onChange={(e) => setReportsFrom(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
                <span className="text-sm text-gray-400">to</span>
                <input
                  type="date"
                  value={reportsTo}
                  onChange={(e) => setReportsTo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
                <select
                  value={reportsUserFilter}
                  onChange={(e) => setReportsUserFilter(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                >
                  <option value="All">All reps</option>
                  {reportsUserNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setReportsFrom(isoDaysAgo(30));
                    setReportsTo(isoToday());
                    setReportsUserFilter("All");
                  }}
                  className="text-sm text-gray-400 hover:text-gray-700 px-2"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="p-8 space-y-8">
              {/* Big-number KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="border border-gray-200 rounded-2xl p-5">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Calls made</div>
                  <div className="text-4xl font-bold mt-2 tabular-nums">{reportsTotalCalls}</div>
                </div>
                <div className="border border-green-200 bg-green-50/40 rounded-2xl p-5">
                  <div className="text-xs font-medium text-green-700 uppercase tracking-wide">Bookings</div>
                  <div className="text-4xl font-bold mt-2 tabular-nums text-green-800">{reportsBookedCalls}</div>
                </div>
                <div className="border border-gray-200 rounded-2xl p-5">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Booking rate</div>
                  <div className="text-4xl font-bold mt-2 tabular-nums">
                    {reportsTotalCalls ? Math.round((reportsBookedCalls / reportsTotalCalls) * 100) : 0}%
                  </div>
                </div>
                {!reportsIsClientView && (
                  <>
                    <div className="border border-gray-200 rounded-2xl p-5">
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                        Avg. minutes / call
                      </div>
                      <div className="text-4xl font-bold mt-2 tabular-nums">
                        {(reportsAvgSeconds / 60).toFixed(1)}
                      </div>
                    </div>
                    <div className="border border-gray-200 rounded-2xl p-5">
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                        Total talk time
                      </div>
                      <div className="text-4xl font-bold mt-2 tabular-nums">
                        {formatCallDuration(reportsTotalSeconds * 1000)}
                      </div>
                    </div>
                  </>
                )}
                <div className="border border-gray-200 rounded-2xl p-5">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Leads contacted</div>
                  <div className="text-4xl font-bold mt-2 tabular-nums">{reportsUniqueLeads}</div>
                </div>
              </div>

              {/* Breakdown tables — rep/client performance is internal,
                  so it's skipped entirely for the Client role. */}
              {!reportsIsClientView && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="border border-gray-200 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-gray-100 font-semibold text-sm">Calls per rep</div>
                    <div className="max-h-80 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                            <th className="px-5 py-2.5 font-medium">Rep</th>
                            <th className="px-5 py-2.5 font-medium text-right">Calls</th>
                            <th className="px-5 py-2.5 font-medium text-right">Booked</th>
                            <th className="px-5 py-2.5 font-medium text-right">Avg / call</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportsByUser.map((row) => (
                            <tr key={row.key} className="border-b border-gray-50 last:border-0">
                              <td className="px-5 py-2.5 font-medium whitespace-nowrap">{row.key}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">{row.calls}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-green-700">{row.bookedCalls}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">
                                {formatCallDuration(row.avgSeconds * 1000)}
                              </td>
                            </tr>
                          ))}
                          {reportsByUser.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">
                                No calls in this range
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-gray-100 font-semibold text-sm">Calls per client</div>
                    <div className="max-h-80 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                            <th className="px-5 py-2.5 font-medium">Client</th>
                            <th className="px-5 py-2.5 font-medium text-right">Calls</th>
                            <th className="px-5 py-2.5 font-medium text-right">Booked</th>
                            <th className="px-5 py-2.5 font-medium text-right">Avg / call</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportsByClient.map((row) => (
                            <tr key={row.key} className="border-b border-gray-50 last:border-0">
                              <td className="px-5 py-2.5 font-medium whitespace-nowrap">{row.key}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">{row.calls}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-green-700">{row.bookedCalls}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">
                                {formatCallDuration(row.avgSeconds * 1000)}
                              </td>
                            </tr>
                          ))}
                          {reportsByClient.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-5 py-8 text-center text-sm text-gray-400">
                                No calls in this range
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Activity Stream — dial attempts across the time of day,
                  so a quiet stretch between two active buckets reads as
                  a rep having stepped away while still logged in. */}
              {!reportsIsClientView && (
                <div className="border border-gray-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-1">
                    <div>
                      <div className="font-semibold text-sm">Activity stream</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        Dial attempts by time of day &middot; {ACTIVITY_BUCKET_MINUTES}-min buckets, all days in range combined
                      </div>
                    </div>
                    {reportsActivity.gaps.length > 0 && (
                      <div className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
                        {reportsActivity.gaps.length} downtime gap{reportsActivity.gaps.length === 1 ? "" : "s"} detected
                      </div>
                    )}
                  </div>
                  <div className="px-5 py-4">
                    {reportsActivity.buckets.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-14">No calls in this range</div>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={260}>
                          <AreaChart data={reportsActivity.buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="activityStreamFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            {reportsActivity.gaps.map((gap) => (
                              <ReferenceArea
                                key={`${gap.start}-${gap.end}`}
                                x1={gap.start}
                                x2={gap.end}
                                fill="#ef4444"
                                fillOpacity={0.12}
                                strokeOpacity={0}
                              />
                            ))}
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis
                              dataKey="time"
                              tick={{ fontSize: 11, fill: "#9ca3af" }}
                              tickLine={false}
                              axisLine={{ stroke: "#e5e7eb" }}
                              interval="preserveStartEnd"
                              minTickGap={28}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 11, fill: "#9ca3af" }}
                              tickLine={false}
                              axisLine={false}
                              width={28}
                            />
                            <Tooltip
                              formatter={(value) => [`${value} call${value === 1 ? "" : "s"}`, "Dial attempts"]}
                              labelFormatter={(label) => label}
                              contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
                            />
                            <Area
                              type="monotone"
                              dataKey="calls"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              fill="url(#activityStreamFill)"
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                        {reportsActivity.gaps.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {reportsActivity.gaps.map((gap) => (
                              <span
                                key={`${gap.start}-${gap.end}-label`}
                                className="text-xs px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-red-700"
                              >
                                Quiet {gap.start}–{gap.end} ({Math.floor(gap.minutes / 60) > 0 ? `${Math.floor(gap.minutes / 60)}h ` : ""}
                                {gap.minutes % 60 > 0 ? `${gap.minutes % 60}m` : ""})
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 font-semibold text-sm">Calls per tag</div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-5 py-2.5 font-medium">Tag</th>
                        <th className="px-5 py-2.5 font-medium text-right">Calls</th>
                        <th className="px-5 py-2.5 font-medium text-right">Booked</th>
                        {!reportsIsClientView && (
                          <>
                            <th className="px-5 py-2.5 font-medium text-right">Avg / call</th>
                            <th className="px-5 py-2.5 font-medium text-right">Total talk time</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {reportsByTag.map((row) => (
                        <tr key={row.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                          <td className="px-5 py-2.5">
                            <span className={`text-xs px-2.5 py-1 rounded-full border ${tagColorClasses(row.key)}`}>
                              {row.key}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{row.calls}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-green-700">{row.bookedCalls}</td>
                          {!reportsIsClientView && (
                            <>
                              <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">
                                {formatCallDuration(row.avgSeconds * 1000)}
                              </td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">
                                {formatCallDuration(row.totalSeconds * 1000)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {reportsByTag.length === 0 && (
                        <tr>
                          <td colSpan={reportsIsClientView ? 3 : 5} className="px-5 py-8 text-center text-sm text-gray-400">
                            No calls in this range
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-green-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-green-100 bg-green-50/40 font-semibold text-sm text-green-800">
                  Booked leads ({reportsBookedList.length})
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-5 py-2.5 font-medium">Lead</th>
                        <th className="px-5 py-2.5 font-medium">Phone</th>
                        <th className="px-5 py-2.5 font-medium">Tag</th>
                        {!reportsIsClientView && <th className="px-5 py-2.5 font-medium">Rep</th>}
                        <th className="px-5 py-2.5 font-medium">Booked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportsBookedList.map((entry) => (
                        <tr key={entry.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                          <td className="px-5 py-2.5 font-medium whitespace-nowrap">{entry.name}</td>
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{entry.phone}</td>
                          <td className="px-5 py-2.5">
                            {entry.tag ? (
                              <span className={`text-xs px-2.5 py-1 rounded-full border ${tagColorClasses(entry.tag)}`}>
                                {entry.tag}
                              </span>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                          {!reportsIsClientView && (
                            <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{entry.userName || "—"}</td>
                          )}
                          <td className="px-5 py-2.5 text-gray-400 whitespace-nowrap">
                            {new Date(entry.calledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                          </td>
                        </tr>
                      ))}
                      {reportsBookedList.length === 0 && (
                        <tr>
                          <td colSpan={reportsIsClientView ? 4 : 5} className="px-5 py-8 text-center text-sm text-gray-400">
                            No bookings in this range
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clients */}
        {page === "clients" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
              <div>
                <h1 className="text-xl font-bold">Clients</h1>
                <div className="text-sm text-gray-400 mt-0.5">
                  {clients.length} client{clients.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedClientIds.length > 0 && (
                  <button
                    onClick={deleteSelectedClients}
                    className="flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-sm px-4 py-2 rounded-lg font-medium"
                  >
                    <Trash2 size={15} /> Delete {selectedClientIds.length} selected
                  </button>
                )}
                <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setClientView("list")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                      clientView === "list" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <Table2 size={15} /> List
                  </button>
                  <button
                    onClick={() => setClientView("grid")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                      clientView === "grid" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <LayoutGrid size={15} /> Grid
                  </button>
                </div>
                <button
                  onClick={handleImportClients}
                  className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-4 py-2 rounded-lg font-medium"
                >
                  <Upload size={15} /> Import client list
                </button>
                <button className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium">
                  <Plus size={15} /> Add client
                </button>
              </div>
            </div>

            {clientView === "list" ? (
              <div className="p-8">
                <div className="border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                        <th className="pl-5 pr-2 py-3 font-medium w-8">
                          <input
                            type="checkbox"
                            checked={clients.length > 0 && clients.every((c) => selectedClientIds.includes(c.id))}
                            onChange={() =>
                              setSelectedClientIds(
                                clients.length > 0 && clients.every((c) => selectedClientIds.includes(c.id))
                                  ? []
                                  : clients.map((c) => c.id)
                              )
                            }
                            className="w-4 h-4 rounded border-gray-300"
                          />
                        </th>
                        <th className="px-3 py-3 font-medium whitespace-nowrap">Name</th>
                        {clientColumns.map((col) => (
                          <th key={col.id} className="px-3 py-3 font-medium whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{col.label}</span>
                              <button
                                onClick={() => handleDeleteColumn(col.id)}
                                className="text-gray-300 hover:text-red-500"
                                title="Delete column"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </th>
                        ))}
                        <th className="px-3 py-3">
                          <button
                            onClick={() => setShowAddColumn(true)}
                            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 whitespace-nowrap"
                          >
                            <Plus size={13} /> Add column
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client) => (
                        <tr key={client.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                          <td className="pl-5 pr-2 py-2.5">
                            <input
                              type="checkbox"
                              checked={selectedClientIds.includes(client.id)}
                              onChange={() => toggleClientSelected(client.id)}
                              className="w-4 h-4 rounded border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-2.5 min-w-[160px]">
                            {editingClientCell === `${client.id}:__name` ? (
                              <input
                                autoFocus
                                value={clientEditValue}
                                onChange={(e) => setClientEditValue(e.target.value)}
                                onBlur={() => {
                                  setEditingClientCell(null);
                                  updateClientName(client.id, clientEditValue.trim() || client.name);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") setEditingClientCell(null);
                                }}
                                className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs font-semibold outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => startEditClientCell(client.id, "__name", client.name)}
                                className="text-left font-semibold text-xs"
                              >
                                {client.name}
                              </button>
                            )}
                          </td>
                          {clientColumns.map((col) => (
                            <td key={col.id} className="px-3 py-2.5 min-w-[130px] max-w-[220px]">
                              {renderClientCell(client, col)}
                            </td>
                          ))}
                          <td />
                        </tr>
                      ))}
                      {clients.length === 0 && (
                        <tr>
                          <td colSpan={clientColumns.length + 3} className="px-5 py-10 text-center text-sm text-gray-400">
                            No clients yet — click "Import client list" to bring in the CSV data, or "Add client" to
                            start fresh.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-8 grid grid-cols-2 gap-4">
                {clients.map((cl) => (
                  <div key={cl.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold">{cl.name}</div>
                        <div className="text-sm text-gray-500">{cl.industry}</div>
                      </div>
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full border ${
                          cl.adsLive
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-gray-50 text-gray-500 border-gray-200"
                        }`}
                      >
                        {cl.adsLive ? "Ads live" : "Not live"}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-sm text-gray-600">
                        <span className="font-semibold text-gray-900">{cl.leads}</span> leads this month
                      </div>
                      {cl.script && (
                        <a
                          href={cl.script}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                        >
                          <ExternalLink size={13} /> Call script
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Calendars */}
        {page === "calendars" && (
          <div className="flex-1 overflow-y-auto">
            {!openCalendar ? (
              <>
                <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
                  <h1 className="text-xl font-bold">Calendars</h1>
                  <button
                    onClick={() => setShowAddCalendarModal(true)}
                    className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium"
                  >
                    <Plus size={15} /> Add Calendar
                  </button>
                </div>
                <div className="p-8">
                  {calendarsLoading ? (
                    <div className="flex justify-center py-16">
                      <Loader2 className="animate-spin text-gray-400" size={20} />
                    </div>
                  ) : calendars.length === 0 ? (
                    <div className="text-center py-16 text-sm text-gray-400">
                      <Calendar size={28} className="mx-auto mb-3 text-gray-300" />
                      No calendars yet. Add one to start taking bookings.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {calendars.map((cal) => (
                        <div key={cal.id} className="border border-gray-200 rounded-xl p-5 bg-white">
                          <div className="flex items-start justify-between mb-2">
                            <h3 className="font-semibold text-sm">{cal.name}</h3>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full border ${
                                cal.active
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-gray-100 text-gray-500 border-gray-200"
                              }`}
                            >
                              {cal.active ? "Active" : "Paused"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                            <Clock size={12} /> {cal.eventLengthMinutes} min · {cal.timezone}
                          </p>
                          <p className="text-xs mb-4">
                            {cal.googleConnected ? (
                              <span className="text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 size={12} /> Google connected
                              </span>
                            ) : (
                              <span className="text-gray-400">Google not connected</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setOpenCalendarId(cal.id);
                                setCalendarSettingsTab("integrate");
                              }}
                              className="flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg font-medium"
                            >
                              Open
                            </button>
                            <button
                              onClick={() => deleteCalendar(cal.id)}
                              className="text-gray-400 hover:text-red-600 p-2"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <button
                      onClick={() => setOpenCalendarId(null)}
                      className="text-xs text-gray-400 hover:text-gray-700 mb-1"
                    >
                      ← Back to Calendars
                    </button>
                    <h1 className="text-xl font-bold">{openCalendar.name}</h1>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-500">
                    <input
                      type="checkbox"
                      checked={openCalendar.active}
                      onChange={(e) => patchCalendar(openCalendar.id, { active: e.target.checked })}
                    />
                    Active
                  </label>
                </div>
                <div className="flex">
                  <div className="w-48 shrink-0 border-r border-gray-100 py-6 px-3 space-y-1">
                    {CALENDAR_SETTINGS_SECTIONS.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => setCalendarSettingsTab(key)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg text-left ${
                          calendarSettingsTab === key
                            ? "bg-gray-100 font-semibold text-gray-900"
                            : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                        }`}
                      >
                        <Icon size={15} /> {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 p-8">
                    {calendarSettingsTab === "integrate" && (
                      <div className="max-w-lg space-y-4">
                        <h2 className="text-base font-bold">Integrate with Google</h2>
                        <p className="text-sm text-gray-500">
                          Connect a Google account so booked calls are added straight to that calendar, and existing
                          events on it block off time here automatically.
                        </p>
                        {openCalendar.googleConnected ? (
                          <div className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">Connected</p>
                              <p className="text-xs text-gray-500">{openCalendar.googleEmail}</p>
                            </div>
                            <button
                              onClick={() => disconnectGoogleCalendar(openCalendar.id)}
                              className="text-sm text-red-600 hover:text-red-700 font-medium"
                            >
                              Disconnect
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => connectGoogleCalendar(openCalendar.id)}
                            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-sm px-4 py-2.5 rounded-lg font-medium"
                          >
                            <Globe size={15} /> Connect with Google
                          </button>
                        )}
                      </div>
                    )}

                    {calendarSettingsTab === "timezone" && (
                      <div className="max-w-sm space-y-3">
                        <h2 className="text-base font-bold">Timezone</h2>
                        <p className="text-sm text-gray-500">Availability hours below are set in this timezone.</p>
                        <Dropdown
                          value={openCalendar.timezone}
                          onChange={(tz) => patchCalendar(openCalendar.id, { timezone: tz })}
                          options={timezoneDropdownOptions}
                          searchable
                        />
                      </div>
                    )}

                    {calendarSettingsTab === "availability" && availabilityDraft && (
                      <div className="max-w-2xl space-y-5">
                        <div className="flex items-center justify-between">
                          <h2 className="text-base font-bold">Availability</h2>
                          <button
                            onClick={() => patchCalendar(openCalendar.id, { availability: availabilityDraft })}
                            disabled={savingCalendar}
                            className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
                          >
                            Save availability
                          </button>
                        </div>
                        {WEEKDAYS.map(({ key, label }) => {
                          const ranges = availabilityDraft[key] || [];
                          return (
                            <div key={key} className="border border-gray-100 rounded-lg p-4">
                              <div className="flex items-center justify-between mb-3">
                                <label className="flex items-center gap-2 text-sm font-medium">
                                  <input type="checkbox" checked={ranges.length > 0} onChange={() => toggleDayEnabled(key)} />
                                  {label}
                                </label>
                                {ranges.length > 0 && (
                                  <button
                                    onClick={() => addDayRange(key)}
                                    className="text-xs text-gray-500 hover:text-gray-800 font-medium"
                                  >
                                    + Add range
                                  </button>
                                )}
                              </div>
                              {ranges.map((range, i) => (
                                <div key={i} className="flex items-center gap-2 mb-2">
                                  <Dropdown
                                    value={range.start}
                                    onChange={(v) => setDayRange(key, i, "start", v)}
                                    options={timeOfDayDropdownOptions}
                                    className="w-36"
                                  />
                                  <span className="text-gray-400 text-sm">to</span>
                                  <Dropdown
                                    value={range.end}
                                    onChange={(v) => setDayRange(key, i, "end", v)}
                                    options={timeOfDayDropdownOptions}
                                    className="w-36"
                                  />
                                  <button onClick={() => removeDayRange(key, i)} className="text-gray-400 hover:text-red-600 p-1">
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                              {ranges.length === 0 && <p className="text-xs text-gray-400">Unavailable</p>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {calendarSettingsTab === "rules" && rulesDraft && (
                      <div className="max-w-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-base font-bold">Booking rules</h2>
                          <button
                            onClick={() =>
                              patchCalendar(openCalendar.id, {
                                eventLengthMinutes: Number(rulesDraft.eventLengthMinutes),
                                bufferMinutes: Number(rulesDraft.bufferMinutes),
                                minNoticeHours: Number(rulesDraft.minNoticeHours),
                                bookingWindowDays: Number(rulesDraft.bookingWindowDays),
                                maxBookingsPerDay: rulesDraft.maxBookingsPerDay === "" ? null : Number(rulesDraft.maxBookingsPerDay),
                              })
                            }
                            disabled={savingCalendar}
                            className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
                          >
                            Save
                          </button>
                        </div>
                        <div>
                          <label className="text-xs font-medium block mb-1.5 text-gray-500">Call length</label>
                          <Dropdown
                            value={rulesDraft.eventLengthMinutes}
                            onChange={(v) => setRulesDraft((d) => ({ ...d, eventLengthMinutes: v }))}
                            options={EVENT_LENGTH_OPTIONS}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium block mb-1.5 text-gray-500">Buffer between calls</label>
                          <Dropdown
                            value={rulesDraft.bufferMinutes}
                            onChange={(v) => setRulesDraft((d) => ({ ...d, bufferMinutes: v }))}
                            options={BUFFER_OPTIONS}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium block mb-1.5 text-gray-500">Minimum notice</label>
                          <Dropdown
                            value={rulesDraft.minNoticeHours}
                            onChange={(v) => setRulesDraft((d) => ({ ...d, minNoticeHours: v }))}
                            options={MIN_NOTICE_OPTIONS}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium block mb-1.5 text-gray-500">Booking window</label>
                          <Dropdown
                            value={rulesDraft.bookingWindowDays}
                            onChange={(v) => setRulesDraft((d) => ({ ...d, bookingWindowDays: v }))}
                            options={BOOKING_WINDOW_OPTIONS}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium block mb-1.5 text-gray-500">
                            Max bookings per day (optional)
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={rulesDraft.maxBookingsPerDay}
                            onChange={(e) => setRulesDraft((d) => ({ ...d, maxBookingsPerDay: e.target.value }))}
                            placeholder="No limit"
                            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                          />
                        </div>
                      </div>
                    )}

                    {calendarSettingsTab === "share" && (
                      <div className="max-w-xl space-y-6">
                        <div>
                          <h2 className="text-base font-bold mb-2">Share</h2>
                          <p className="text-sm text-gray-500 mb-3">
                            Anyone with this link can book an open slot on this calendar.
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={`${window.location.origin}/book/${openCalendar.slug}`}
                              onFocus={(e) => e.target.select()}
                              className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none bg-gray-50"
                            />
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(`${window.location.origin}/book/${openCalendar.slug}`)
                              }
                              className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-4 py-2.5 rounded-lg font-medium"
                            >
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                        </div>
                        <div>
                          <h2 className="text-base font-bold mb-2">Embed</h2>
                          <p className="text-sm text-gray-500 mb-3">
                            Paste this into any website to embed the booking widget directly.
                          </p>
                          <div className="flex items-start gap-2">
                            <textarea
                              readOnly
                              rows={3}
                              value={`<iframe src="${window.location.origin}/book/${openCalendar.slug}" width="100%" height="700" frameborder="0"></iframe>`}
                              onFocus={(e) => e.target.select()}
                              className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none bg-gray-50 font-mono"
                            />
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  `<iframe src="${window.location.origin}/book/${openCalendar.slug}" width="100%" height="700" frameborder="0"></iframe>`
                                )
                              }
                              className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-4 py-2.5 rounded-lg font-medium"
                            >
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                        </div>
                        <div>
                          <h2 className="text-base font-bold mb-2">Bookings</h2>
                          {calendarBookings.length === 0 ? (
                            <p className="text-sm text-gray-400">No bookings yet.</p>
                          ) : (
                            <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
                              {calendarBookings.map((b) => (
                                <div key={b.id} className="flex items-center justify-between px-4 py-3">
                                  <div>
                                    <p className="text-sm font-medium">
                                      {b.contactName}{" "}
                                      {b.status === "cancelled" && (
                                        <span className="text-xs text-red-500 font-normal">(cancelled)</span>
                                      )}
                                    </p>
                                    <p className="text-xs text-gray-500 flex items-center gap-1">
                                      <MapPin size={11} /> {b.contactEmail || b.contactPhone || "—"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500">
                                      {new Date(b.startTime).toLocaleString("en-US", {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                        timeZone: openCalendar.timezone,
                                      })}
                                    </span>
                                    {b.status !== "cancelled" && (
                                      <button
                                        onClick={() => cancelCalendarBooking(b.id)}
                                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                                      >
                                        Cancel
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Settings */}
        {page === "settings" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 border-b border-gray-100">
              <h1 className="text-xl font-bold">Settings</h1>
            </div>
            <div className="p-8 max-w-lg space-y-6">
              <div>
                <label className="text-sm font-medium block mb-1.5">Business name</label>
                <input defaultValue="Scalbl.io" className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Timezone</label>
                <select className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400 bg-white">
                  <option>Australia/Adelaide</option>
                  <option>Australia/Sydney</option>
                  <option>Australia/Melbourne</option>
                  <option>Australia/Perth</option>
                  <option>Australia/Brisbane</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Caller ID number</label>
                <input defaultValue="+61 8 1234 5678" className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400" />
              </div>
              <button className="bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium">Save changes</button>
            </div>

            <div className="px-8 pb-10 max-w-3xl">
              <div className="border-t border-gray-100 pt-8">
                <h2 className="text-base font-bold">Team &amp; permissions</h2>
                <p className="text-sm text-gray-500 mt-1 max-w-lg">
                  Owner and Super Admin can invite people and change roles. Admin sees the team but can't edit
                  it. A Client account only ever sees Conversation, Contacts and Reports — scoped to the lead
                  tag(s) picked for them below.
                </p>

                {canManageUsers && (
                  <form onSubmit={handleInviteUser} className="flex items-end gap-2 mt-4 flex-wrap">
                    <div>
                      <label className="text-xs font-medium block mb-1.5 text-gray-500">Name</label>
                      <input
                        value={inviteForm.name}
                        onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Jane Smith"
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 w-40"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1.5 text-gray-500">Email</label>
                      <input
                        type="email"
                        value={inviteForm.email}
                        onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="jane@client.com"
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 w-52"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1.5 text-gray-500">Role</label>
                      <select
                        value={inviteForm.role}
                        onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                      >
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                        <option value="client">Client</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={invitingUser || !inviteForm.name.trim() || !inviteForm.email.trim()}
                      className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {invitingUser && <Loader2 size={14} className="animate-spin" />}
                      Invite
                    </button>
                  </form>
                )}

                {canManageUsers && inviteForm.role === "client" && (
                  <div className="mt-3 border border-gray-200 rounded-lg p-3 max-w-md">
                    <div className="text-xs font-medium text-gray-500 mb-1.5">Which tags can they see?</div>
                    {contactTagNames.length === 0 ? (
                      <div className="text-xs text-gray-400">No tags yet — import some leads first.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                        {contactTagNames.map((tag) => (
                          <button
                            type="button"
                            key={tag}
                            onClick={() => toggleInviteAllowedTag(tag)}
                            className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${
                              inviteForm.allowedTags.includes(tag)
                                ? "bg-gray-900 text-white border-gray-900"
                                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                        <th className="px-4 py-2.5 font-medium">Name</th>
                        <th className="px-4 py-2.5 font-medium">Email</th>
                        <th className="px-4 py-2.5 font-medium">Role</th>
                        <th className="px-4 py-2.5 font-medium">Tags</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamUsers.map((u) => (
                        <tr key={u.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-3 font-medium">{u.name}</td>
                          <td className="px-4 py-3 text-gray-500">{u.email}</td>
                          <td className="px-4 py-3">
                            {u.role === "owner" ? (
                              <span className="text-xs px-2.5 py-1 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                                Owner
                              </span>
                            ) : canManageUsers ? (
                              <select
                                value={u.role}
                                onChange={(e) => patchTeamUser(u.id, { role: e.target.value })}
                                className="border border-gray-200 rounded-md px-2 py-1 text-xs outline-none focus:border-gray-400 bg-white"
                              >
                                <option value="admin">Admin</option>
                                <option value="super_admin">Super Admin</option>
                                <option value="client">Client</option>
                              </select>
                            ) : (
                              <span className="text-xs text-gray-600 capitalize">{u.role.replace("_", " ")}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {u.role !== "client" ? (
                              <span className="text-gray-300 text-xs">—</span>
                            ) : (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => canManageUsers && setTagMenuUserId((cur) => (cur === u.id ? null : u.id))}
                                  className="flex flex-wrap gap-1 max-w-[220px]"
                                >
                                  {u.allowedTags.length ? (
                                    u.allowedTags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="text-xs px-2 py-0.5 rounded-full border bg-gray-50 text-gray-600 border-gray-200 whitespace-nowrap"
                                      >
                                        {tag}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-xs text-red-500">No tags — sees nothing</span>
                                  )}
                                </button>
                                {canManageUsers && tagMenuUserId === u.id && (
                                  <>
                                    <div className="fixed inset-0 z-40" onClick={() => setTagMenuUserId(null)} />
                                    <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-56 max-h-56 overflow-y-auto">
                                      {contactTagNames.map((tag) => (
                                        <label
                                          key={tag}
                                          className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-gray-50 text-xs cursor-pointer"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={u.allowedTags.includes(tag)}
                                            onChange={() => toggleTeamUserTag(u, tag)}
                                            className="w-3.5 h-3.5 rounded border-gray-300"
                                          />
                                          <span className="truncate">{tag}</span>
                                        </label>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500">{u.hasPassword ? "Active" : "Invited"}</td>
                          <td className="px-4 py-3 text-right">
                            {canDeleteTeamUser(u.role) && u.id !== authUser?.id && (
                              <button
                                onClick={() => handleDeleteTeamUser(u.id)}
                                className="text-gray-300 hover:text-red-500"
                                title="Remove user"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!teamUsersLoading && teamUsers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                            No team members yet
                          </td>
                        </tr>
                      )}
                      {teamUsersLoading && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                            <Loader2 size={14} className="animate-spin inline" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-8 pb-10 max-w-2xl">
              <div className="border-t border-gray-100 pt-8">
                <h2 className="text-base font-bold">API key</h2>
                <p className="text-sm text-gray-500 mt-1 max-w-lg">
                  One key controls everything — a script or agent uses it to read and write this CRM's data
                  without a browser login (e.g. to run a bulk lead import), and it's also the token that
                  authenticates the lead webhook below. It works exactly like being logged in, so treat it like
                  a password: anyone with it has full access to this shared CRM.
                </p>

                {apiKeyLoading ? (
                  <div className="mt-5 flex items-center justify-center py-8 text-gray-400">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                ) : !apiKey ? (
                  <div className="mt-5 border border-gray-200 rounded-xl p-5 text-center">
                    <p className="text-sm text-gray-500 mb-3">No API key yet.</p>
                    <button
                      onClick={handleGenerateApiKey}
                      disabled={generatingKey}
                      className="inline-flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
                    >
                      {generatingKey && <Loader2 size={14} className="animate-spin" />}
                      Generate key
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="border border-gray-200 rounded-xl p-4">
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                        API key / token
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          readOnly
                          value={apiKey.key}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 min-w-0 border border-gray-200 rounded-md px-2.5 py-2 text-xs text-gray-600 bg-gray-50 outline-none font-mono"
                        />
                        <button
                          onClick={copyApiKeyValue}
                          title="Copy API key"
                          className="shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          <Copy size={12} />
                          {copiedApiKey ? "Copied" : "Copy"}
                        </button>
                        <button
                          onClick={handleGenerateApiKey}
                          title="Regenerate key"
                          className="shrink-0 flex items-center text-gray-400 hover:text-gray-700 p-2 rounded-md border border-gray-200 hover:bg-gray-50"
                        >
                          <RefreshCw size={12} />
                        </button>
                        <button
                          onClick={handleDeleteApiKey}
                          title="Revoke key"
                          className="shrink-0 flex items-center text-gray-300 hover:text-red-500 p-2 rounded-md border border-gray-200 hover:bg-red-50"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="text-xs text-gray-400 mt-2">
                        Created {apiKey.createdAt ? new Date(apiKey.createdAt).toLocaleDateString() : "—"}
                        {apiKey.createdByName ? ` by ${apiKey.createdByName}` : ""} · Last used{" "}
                        {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : "never"}
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-xl p-4">
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                        Lead webhook URL{" "}
                        <span className="normal-case text-gray-300 font-normal">
                          — post a new lead here from Zapier/Make/GoHighLevel/etc, with a "tag" field set to
                          which Contacts tab it should land on
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          readOnly
                          value={webhookUrl}
                          onFocus={(e) => e.target.select()}
                          className="flex-1 min-w-0 border border-gray-200 rounded-md px-2.5 py-2 text-xs text-gray-600 bg-gray-50 outline-none font-mono"
                        />
                        <button
                          onClick={copyWebhookUrl}
                          title="Copy webhook URL"
                          className="shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          <Copy size={12} />
                          {copiedWebhookUrl ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <div className="text-xs font-medium text-gray-500 mb-1.5">How an agent uses it</div>
                  <pre className="bg-gray-900 text-gray-100 text-xs rounded-xl p-4 overflow-x-auto">
{`curl -X POST ${window.location.origin}/api/contacts-import \\
  -H "Authorization: Bearer <the key>" \\
  -H "Content-Type: application/json" \\
  -d '{"offset": 0, "limit": 500}'`}
                  </pre>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Same header works on every endpoint — e.g. POST /api/contacts-bulk-import to add leads from
                    any other source, or GET /api/contacts to read them back. Keep paging with the returned{" "}
                    <code className="bg-gray-100 px-1 rounded">nextOffset</code> until{" "}
                    <code className="bg-gray-100 px-1 rounded">done</code> is true.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Soundboard — record a new quick-play clip */}
      {showSoundboardRecorder && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={closeSoundboardRecorder}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Record a soundboard clip</h2>
              <button onClick={closeSoundboardRecorder} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-500 mb-4">
                Keep it short — a quick reply you might need mid-call, like answering a phone's call-screening
                prompt ("please say your name and reason for calling").
              </p>

              {recorderError && (
                <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div className="flex-1">{recorderError}</div>
                </div>
              )}

              <div className="flex flex-col items-center gap-3 py-4">
                {recorderStatus === "idle" && (
                  <button
                    onClick={startRecordingClip}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-full font-semibold"
                  >
                    <Mic size={16} /> Start recording
                  </button>
                )}
                {recorderStatus === "recording" && (
                  <>
                    <div className="flex items-center gap-2 text-red-600 text-sm font-medium">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
                      </span>
                      Recording…
                    </div>
                    <button
                      onClick={stopRecordingClip}
                      className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-full font-semibold"
                    >
                      <Square size={14} fill="currentColor" /> Stop
                    </button>
                  </>
                )}
                {(recorderStatus === "recorded" || recorderStatus === "saving") && recordedClip && (
                  <div className="w-full space-y-3">
                    <audio src={recordedClip.url} controls className="w-full" />
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={reRecordClip}
                        disabled={recorderStatus === "saving"}
                        className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-40"
                      >
                        Re-record
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {recordedClip && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveRecordedClip();
                  }}
                  className="flex items-end gap-2 mt-2"
                >
                  <div className="flex-1">
                    <label className="text-xs font-medium block mb-1.5 text-gray-500">Label</label>
                    <input
                      autoFocus
                      value={recordingLabel}
                      onChange={(e) => setRecordingLabel(e.target.value)}
                      placeholder="e.g. Screening response"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={recorderStatus === "saving" || !recordingLabel.trim()}
                    className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {recorderStatus === "saving" && <Loader2 size={14} className="animate-spin" />}
                    Save
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Calendar modal */}
      {showAddCalendarModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddCalendarModal(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Add Calendar</h2>
              <button onClick={() => setShowAddCalendarModal(false)} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddCalendar} className="px-6 py-5 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Calendar name</label>
                <input
                  autoFocus
                  required
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                  placeholder="e.g. Sales call"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCalendarModal(false)}
                  className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2.5 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingCalendar}
                  className="flex items-center gap-2 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium disabled:opacity-40"
                >
                  {addingCalendar && <Loader2 size={14} className="animate-spin" />}
                  Create calendar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add to Powerlist modal — from Contacts bulk-select */}
      {showAddToPowerlist && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddToPowerlist(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold">Add to Powerlist</h2>
                <div className="text-xs text-gray-400 mt-0.5">
                  {selectedContactIds.length} contact{selectedContactIds.length === 1 ? "" : "s"} selected
                </div>
              </div>
              <button
                onClick={() => setShowAddToPowerlist(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {dialLists.length > 0 && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-400 block mb-2">
                    Select powerlist
                  </label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {dialLists.map((list) => (
                      <button
                        key={list.id}
                        disabled={addingToPowerlist}
                        onClick={() => handleAddSelectedToExistingPowerlist(list.id)}
                        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="font-medium truncate">{list.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">{list.leadIds.length} leads</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleCreatePowerlistFromSelection}>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400 block mb-2">
                  {dialLists.length > 0 ? "Or create a new one" : "New powerlist name"}
                </label>
                <div className="flex gap-2">
                  <input
                    autoFocus={dialLists.length === 0}
                    value={newPowerlistName}
                    onChange={(e) => setNewPowerlistName(e.target.value)}
                    placeholder="e.g. Follow up this week"
                    className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-gray-400"
                  />
                  <button
                    type="submit"
                    disabled={addingToPowerlist || !newPowerlistName.trim()}
                    className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {addingToPowerlist && <Loader2 size={14} className="animate-spin" />}
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add contact modal */}
      {showAddContact && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddContact(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Add contact</h2>
              <button
                onClick={() => setShowAddContact(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddContact} className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="text-sm font-medium block mb-1.5">Name</label>
                <input
                  required
                  value={contactForm.name}
                  onChange={(e) => updateContactForm("name", e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Email</label>
                <input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => updateContactForm("email", e.target.value)}
                  placeholder="jane@email.com"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Phone</label>
                <input
                  required
                  value={contactForm.phone}
                  onChange={(e) => updateContactForm("phone", e.target.value)}
                  placeholder="0412 345 678"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Tag</label>
                {authUser?.role === "client" ? (
                  // A client account can only ever add leads under one
                  // of their own tags — the server enforces this too,
                  // but picking from a list avoids a confusing 403 from
                  // typing the wrong thing.
                  <select
                    value={contactForm.tag}
                    onChange={(e) => updateContactForm("tag", e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 bg-white"
                  >
                    <option value="" disabled>
                      Select tag…
                    </option>
                    {(authUser.allowedTags || []).map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={contactForm.tag}
                    onChange={(e) => updateContactForm("tag", e.target.value)}
                    placeholder="e.g. Khan Legal"
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowMoreContactFields((v) => !v)}
                className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1"
              >
                <ChevronDown size={13} className={`transition-transform ${showMoreContactFields ? "rotate-180" : ""}`} />
                {showMoreContactFields ? "Hide extra criteria" : `Show more criteria (${4 + contactColumns.length})`}
              </button>

              {showMoreContactFields && (
                <div className="space-y-4 pt-1 border-t border-gray-100">
                  <div className="grid grid-cols-2 gap-3 pt-4">
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Client</label>
                      <select
                        value={contactForm.client}
                        onChange={(e) => updateContactForm("client", e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 bg-white"
                      >
                        {clients.map((cl) => (
                          <option key={cl.id} value={cl.name}>
                            {cl.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1.5">Status</label>
                      <select
                        value={contactForm.status}
                        onChange={(e) => updateContactForm("status", e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 bg-white"
                      >
                        {Object.keys(statusColors).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Lead date</label>
                    <input
                      value={contactForm.leadDate}
                      onChange={(e) => updateContactForm("leadDate", e.target.value)}
                      placeholder="e.g. 24/11/2025"
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Notes</label>
                    <textarea
                      value={contactForm.notes}
                      onChange={(e) => updateContactForm("notes", e.target.value)}
                      placeholder="Anything worth knowing before the next call…"
                      rows={3}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400 resize-none"
                    />
                  </div>
                  {contactColumns.map((col) => (
                    <div key={col.id} className={col.type === "checkbox" ? "flex items-center gap-2" : ""}>
                      <label className="text-sm font-medium block mb-1.5">{col.label}</label>
                      {renderDynamicFieldInput(col, contactForm.fields[col.key], (value) =>
                        updateContactFormField(col.key, value)
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddContact(false)}
                  className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2.5 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add client column modal */}
      {showAddColumn && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddColumn(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Add column</h2>
              <button onClick={() => setShowAddColumn(false)} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddColumn} className="px-6 py-5 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Column name</label>
                <input
                  required
                  autoFocus
                  value={columnForm.label}
                  onChange={(e) => setColumnForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Renewal Date"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Type</label>
                <select
                  value={columnForm.type}
                  onChange={(e) => setColumnForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 bg-white"
                >
                  {COLUMN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {columnForm.type === "select" && (
                <div>
                  <label className="text-sm font-medium block mb-1.5">Options</label>
                  <input
                    value={columnForm.options}
                    onChange={(e) => setColumnForm((f) => ({ ...f, options: e.target.value }))}
                    placeholder="Comma-separated, e.g. Hot, Warm, Cold"
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                  />
                  <div className="text-xs text-gray-400 mt-1">Each one becomes a colored option in the dropdown.</div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddColumn(false)}
                  className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2.5 font-medium"
                >
                  Cancel
                </button>
                <button type="submit" className="bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium">
                  Add column
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add contact column modal */}
      {showAddContactColumn && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddContactColumn(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold">Add column</h2>
              <button onClick={() => setShowAddContactColumn(false)} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddContactColumn} className="px-6 py-5 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Column name</label>
                <input
                  required
                  autoFocus
                  value={contactColumnForm.label}
                  onChange={(e) => setContactColumnForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Lead Source"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Type</label>
                <select
                  value={contactColumnForm.type}
                  onChange={(e) => setContactColumnForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 bg-white"
                >
                  {COLUMN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {contactColumnForm.type === "select" && (
                <div>
                  <label className="text-sm font-medium block mb-1.5">Options</label>
                  <input
                    value={contactColumnForm.options}
                    onChange={(e) => setContactColumnForm((f) => ({ ...f, options: e.target.value }))}
                    placeholder="Comma-separated, e.g. Hot, Warm, Cold"
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                  />
                  <div className="text-xs text-gray-400 mt-1">Each one becomes a colored option in the dropdown.</div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddContactColumn(false)}
                  className="text-sm text-gray-500 hover:text-gray-800 px-4 py-2.5 font-medium"
                >
                  Cancel
                </button>
                <button type="submit" className="bg-gray-900 text-white text-sm px-5 py-2.5 rounded-lg font-medium">
                  Add column
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
