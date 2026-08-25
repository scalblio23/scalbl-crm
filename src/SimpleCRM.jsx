import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { placeCall, hangUp } from "./lib/twilioDevice";

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

const initialConversations = [
  {
    id: 1,
    leadId: 1,
    name: "Sarah Mitchell",
    preview: "Yes I'm interested in the battery rebate",
    time: "10:32 AM",
    unread: true,
    messages: [
      { id: 1, type: "text", text: "Yes I'm interested in the battery rebate", time: "10:32 AM", outgoing: false },
      { id: 2, type: "text", text: "No worries — I'll give you a call shortly to run through it.", time: "10:35 AM", outgoing: true },
    ],
  },
  {
    id: 2,
    leadId: 6,
    name: "Tom Nguyen",
    preview: "What deposit do I need?",
    time: "9:15 AM",
    unread: true,
    messages: [
      { id: 1, type: "text", text: "What deposit do I need?", time: "9:15 AM", outgoing: false },
      { id: 2, type: "text", text: "No worries — I'll give you a call shortly to run through it.", time: "9:20 AM", outgoing: true },
    ],
  },
  {
    id: 3,
    leadId: 3,
    name: "Emma Taylor",
    preview: "Confirmed for Thursday 2pm",
    time: "Yesterday",
    unread: false,
    messages: [
      { id: 1, type: "text", text: "Confirmed for Thursday 2pm", time: "Yesterday", outgoing: false },
    ],
  },
  {
    id: 4,
    leadId: 2,
    name: "David Chen",
    preview: "Can you call me after 5?",
    time: "Yesterday",
    unread: false,
    messages: [
      { id: 1, type: "text", text: "Can you call me after 5?", time: "Yesterday", outgoing: false },
    ],
  },
];

const statusColors = {
  "New Lead": "bg-blue-50 text-blue-700 border-blue-200",
  Contacted: "bg-amber-50 text-amber-700 border-amber-200",
  Booked: "bg-green-50 text-green-700 border-green-200",
  "No Answer": "bg-gray-50 text-gray-500 border-gray-200",
};

const CURRENT_USER = "Henry";

function formatCallDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------- Persistence ----------
// A useState that reads its initial value from localStorage and
// writes back to it on every change, so data the user creates
// (contacts, dialler lists, call history…) survives a page refresh
// instead of resetting to the sample data. Falls back to `initialValue`
// if storage is empty, unavailable (private browsing), or corrupted.
const STORAGE_PREFIX = "scalbl-crm:";
function usePersistentState(key, initialValue) {
  const storageKey = STORAGE_PREFIX + key;
  const [state, setState] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // storage unavailable or full — nothing more we can do here
    }
  }, [storageKey, state]);

  return [state, setState];
}

// ---------- Sidebar ----------
const navItems = [
  { key: "conversation", label: "Conversation", icon: MessageSquare },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "powerdialler", label: "Powerdialler", icon: Phone },
  { key: "log", label: "Log", icon: ClipboardList },
  { key: "clients", label: "Clients", icon: Briefcase },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function SimpleCRM() {
  const [page, setPage] = useState("conversation");
  const [contacts, setContacts] = usePersistentState("contacts", initialContacts);
  const [clients] = useState(initialClients);
  const [conversations, setConversations] = usePersistentState("conversations", initialConversations);
  const [activeConvo, setActiveConvo] = useState(1);
  const [search, setSearch] = useState("");

  // Add-contact modal
  const emptyContactForm = {
    name: "",
    email: "",
    phone: "",
    client: initialClients[0]?.name || "",
    status: "New Lead",
    notes: "",
  };
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContactForm);
  const updateContactForm = (key, value) =>
    setContactForm((f) => ({ ...f, [key]: value }));

  const handleAddContact = (e) => {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.phone.trim()) return;
    const newContact = {
      id: Math.max(0, ...contacts.map((c) => c.id)) + 1,
      ...contactForm,
      name: contactForm.name.trim(),
      phone: contactForm.phone.trim(),
      lastContact: "Today",
      createdAt: new Date().toISOString(),
    };
    setContacts((cs) => [...cs, newContact]);
    setContactForm(emptyContactForm);
    setShowAddContact(false);
  };

  // Powerdialler state
  const [calling, setCalling] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState(null);
  const emptyDialFilters = {
    name: "",
    email: "",
    phone: "",
    client: "All",
    notes: "",
    status: "All",
  };
  const [dialFilters, setDialFilters] = useState(emptyDialFilters);

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.client.toLowerCase().includes(search.toLowerCase())
  );

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
  const dialFiltersActive = Object.entries(dialFilters).some(
    ([key, value]) => value !== emptyDialFilters[key]
  );
  const updateDialFilter = (key, value) =>
    setDialFilters((f) => ({ ...f, [key]: value }));
  const filteredDialQueue = dialQueue.filter(
    (l) =>
      l.name.toLowerCase().includes(dialFilters.name.toLowerCase()) &&
      l.email.toLowerCase().includes(dialFilters.email.toLowerCase()) &&
      l.phone.toLowerCase().includes(dialFilters.phone.toLowerCase()) &&
      (dialFilters.client === "All" || l.client === dialFilters.client) &&
      l.notes.toLowerCase().includes(dialFilters.notes.toLowerCase()) &&
      (dialFilters.status === "All" || l.status === dialFilters.status)
  );
  const activeLead = dialQueue.find((l) => l.id === activeLeadId) || null;

  // Live calling — same model as GoHighLevel's power dialler: the
  // browser registers as a Twilio Voice "device" and calls ring
  // through the rep's mic/speakers via the backend in /server.
  const [callStatus, setCallStatus] = useState("idle"); // idle | connecting | in-progress
  const [callError, setCallError] = useState("");
  const activeCallRef = useRef(null);
  const callStartRef = useRef(null); // when the current call was placed, for duration
  const callEndedRef = useRef(false); // guards against double-processing one call's end

  // Logs a completed call into that lead's conversation thread — creates
  // a new thread if one doesn't exist yet, otherwise appends to it and
  // bumps it to the top of the list. Applies to every call, whether
  // placed ad hoc or as part of a Power Dialler session.
  const logCallToConversation = (lead, durationMs) => {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const summary = `Outgoing call · ${timeLabel} · ${formatCallDuration(durationMs)} · by ${CURRENT_USER}`;
    const message = { id: `call-${lead.id}-${now.getTime()}`, type: "call", text: summary, time: timeLabel };

    const existing = conversations.find((c) => c.leadId === lead.id);
    if (existing) {
      const updated = {
        ...existing,
        preview: summary,
        time: timeLabel,
        unread: false,
        messages: [...(existing.messages || []), message],
      };
      setConversations((cs) => [updated, ...cs.filter((c) => c.id !== existing.id)]);
      setActiveConvo(updated.id);
    } else {
      const newId = conversations.length ? Math.max(...conversations.map((c) => c.id)) + 1 : 1;
      const newConvo = {
        id: newId,
        leadId: lead.id,
        name: lead.name,
        preview: summary,
        time: timeLabel,
        unread: false,
        messages: [message],
      };
      setConversations((cs) => [newConvo, ...cs]);
      setActiveConvo(newId);
    }
  };

  // ----- Power Dialler session (auto-dial through a list) -----
  const [dialLists, setDialLists] = usePersistentState("dialLists", []); // [{ id, name, leadIds }]
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [newListName, setNewListName] = useState("");
  const [calledLeadIds, setCalledLeadIds] = usePersistentState("calledLeadIds", []); // leads already worked, across all lists
  const [session, setSession] = useState(null); // { listName, queue: [leadId,...] }
  const [sessionPaused, setSessionPaused] = useState(false);
  const [wrapUp, setWrapUp] = useState(null); // { lead, status, notes, secondsLeft }
  const [callLog, setCallLog] = usePersistentState("callLog", []);

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

  const remainingInList = (leadIds) =>
    leadIds.filter((id) => !calledLeadIds.includes(id) && dialQueue.some((l) => l.id === id));

  const saveSelectedAsList = () => {
    if (!newListName.trim() || selectedLeadIds.length === 0) return;
    setDialLists((ls) => [...ls, { id: `list-${Date.now()}`, name: newListName.trim(), leadIds: selectedLeadIds }]);
    setSelectedLeadIds([]);
    setNewListName("");
  };

  const deleteDialList = (id) => setDialLists((ls) => ls.filter((l) => l.id !== id));

  // Kicks off a Power Dialler session: works through `leadIds` in
  // order, top to bottom, placing the first call immediately.
  const startSession = (listName, leadIds) => {
    const queue = remainingInList(leadIds);
    if (!queue.length) return;
    setWrapUp(null);
    setSessionPaused(false);
    setSession({ listName, queue });
    const firstLead = dialQueue.find((l) => l.id === queue[0]);
    if (firstLead) startCall(firstLead);
  };

  const stopSession = () => {
    setSession(null);
    setSessionPaused(false);
    setWrapUp(null);
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
      const nextLead = dialQueue.find((l) => l.id === session.queue[0]);
      if (nextLead) startCall(nextLead);
    }
  };

  // Called whenever a call ends (hung up, disconnected, or failed).
  // Only relevant mid-session — a one-off call from the table doesn't
  // force a wrap-up.
  const handleCallEnded = (lead) => {
    if (!sessionRef.current || !lead) return;
    setWrapUp({ lead, status: lead.status, notes: lead.notes || "", secondsLeft: WRAP_UP_SECONDS });
  };

  // Saves the wrap-up's status/notes onto the lead, logs the call, and
  // advances the session to the next lead — auto-triggered by the
  // countdown reaching zero, or manually via "Next lead".
  const finishWrapUp = () => {
    if (!wrapUp) return;
    const { lead, status, notes } = wrapUp;

    setContacts((cs) =>
      cs.map((c) => (c.id === lead.id ? { ...c, status, notes, lastContact: "Today" } : c))
    );
    setCallLog((log) => [
      {
        id: `${lead.id}-${Date.now()}`,
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        client: lead.client,
        status,
        notes,
        calledAt: new Date().toISOString(),
      },
      ...log,
    ]);
    setCalledLeadIds((ids) => [...ids, lead.id]);
    setWrapUp(null);

    if (!session) return;
    const remainingQueue = session.queue.filter((id) => id !== lead.id);
    if (!remainingQueue.length) {
      setSession(null);
      setSessionPaused(false);
      return;
    }
    setSession({ ...session, queue: remainingQueue });
    if (sessionPaused) return; // stay put — Resume will dial the next lead
    const nextLead = dialQueue.find((l) => l.id === remainingQueue[0]);
    if (nextLead) startCall(nextLead);
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
    callEndedRef.current = false;
    try {
      const call = await placeCall(lead.phone);
      activeCallRef.current = call;
      callStartRef.current = Date.now();

      // Shared end-of-call handling for disconnect/cancel/error alike —
      // guarded so it only ever runs once per call, however it ends
      // (Twilio's own event, or the user hitting "End call" below).
      const onCallEnded = (err) => {
        if (callEndedRef.current) return;
        callEndedRef.current = true;
        setCalling(false);
        setCallStatus("idle");
        activeCallRef.current = null;
        if (err) setCallError(err.message || "The call failed.");
        const durationMs = callStartRef.current ? Date.now() - callStartRef.current : 0;
        callStartRef.current = null;
        logCallToConversation(lead, durationMs);
        handleCallEnded(lead);
      };

      call.on("accept", () => setCallStatus("in-progress"));
      call.on("disconnect", () => onCallEnded());
      call.on("cancel", () => onCallEnded());
      call.on("error", (err) => onCallEnded(err));
    } catch (err) {
      setCallError(err.message || "Could not start the call — check your Twilio setup.");
      setCalling(false);
      setCallStatus("idle");
    }
  };

  const endCall = () => {
    // Just hang up — the call's own 'disconnect' event (registered in
    // startCall) does the actual state reset, logging, and wrap-up, so
    // it only ever happens once no matter how the call ends.
    hangUp();
  };

  return (
    <div className="flex h-screen bg-white text-gray-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Sidebar */}
      <aside className="w-56 border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="text-lg font-bold tracking-tight">Scalbl CRM</div>
          <div className="text-xs text-gray-400 mt-0.5">Lead operations</div>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map(({ key, label, icon: Icon }) => (
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
        <div className="px-5 py-4 border-t border-gray-100 text-xs text-gray-400">
          {CURRENT_USER} · Admin
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Conversation */}
        {page === "conversation" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-80 border-r border-gray-200 flex flex-col">
              <div className="px-4 py-4 border-b border-gray-100 font-semibold">Conversations</div>
              <div className="flex-1 overflow-y-auto">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveConvo(c.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${
                      activeConvo === c.id ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className={`text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.name}</span>
                      <span className="text-xs text-gray-400">{c.time}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {c.unread && <Circle size={7} className="fill-blue-500 text-blue-500 shrink-0" />}
                      <span className="text-xs text-gray-500 truncate">{c.preview}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <div className="px-6 py-4 border-b border-gray-100 font-semibold">
                {conversations.find((c) => c.id === activeConvo)?.name}
              </div>
              <div className="flex-1 p-6 space-y-3 overflow-y-auto bg-gray-50/50">
                {(conversations.find((c) => c.id === activeConvo)?.messages || []).map((m) =>
                  m.type === "call" ? (
                    <div key={m.id} className="flex justify-center">
                      <div className="flex items-center gap-1.5 bg-gray-200/70 text-gray-600 text-xs px-3 py-1.5 rounded-full">
                        <PhoneCall size={12} /> {m.text}
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
              <div className="p-4 border-t border-gray-100 flex gap-2">
                <input
                  placeholder="Type a message…"
                  className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400"
                />
                <button className="bg-gray-900 text-white text-sm px-5 rounded-lg font-medium">Send</button>
              </div>
            </div>
          </div>
        )}

        {/* Contacts */}
        {page === "contacts" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
              <h1 className="text-xl font-bold">Contacts</h1>
              <div className="flex gap-3">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search contacts"
                    className="border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-gray-400 w-64"
                  />
                </div>
                <button
                  onClick={() => setShowAddContact(true)}
                  className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium"
                >
                  <Plus size={15} /> Add contact
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-8 py-3 font-medium">Name</th>
                  <th className="py-3 font-medium">Phone</th>
                  <th className="py-3 font-medium">Client</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 font-medium">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-8 py-3.5 font-medium">{c.name}</td>
                    <td className="py-3.5 text-gray-600">{c.phone}</td>
                    <td className="py-3.5 text-gray-600">{c.client}</td>
                    <td className="py-3.5">
                      <span className={`text-xs px-2.5 py-1 rounded-full border ${statusColors[c.status]}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3.5 text-gray-500">{c.lastContact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                </div>
              </div>
              {dialFiltersActive && (
                <button
                  onClick={() => setDialFilters(emptyDialFilters)}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
                >
                  <X size={14} /> Clear filters
                </button>
              )}
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
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Status</label>
                      <select
                        value={wrapUp.status}
                        onChange={(e) => setWrapUp((w) => (w ? { ...w, status: e.target.value } : w))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-gray-400"
                      >
                        {Object.keys(statusColors).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
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

                  <div className="mt-4 flex justify-end">
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
                        <span>{activeLead.phone}</span>
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
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                      <th className="pl-5 pr-2 py-3 font-medium w-8" />
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Email</th>
                      <th className="px-5 py-3 font-medium">Phone</th>
                      <th className="px-5 py-3 font-medium">Client</th>
                      <th className="px-5 py-3 font-medium">Notes</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Script</th>
                      <th className="px-5 py-3 font-medium text-right">Action</th>
                    </tr>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="pl-5 pr-2 pb-3" />
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
                      <th className="px-5 pb-3" />
                      <th className="px-5 pb-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDialQueue.map((lead) => (
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
                        <td className="px-5 py-3.5 font-medium">{lead.name}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.email}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.phone}</td>
                        <td className="px-5 py-3.5 text-gray-600">{lead.client}</td>
                        <td className="px-5 py-3.5 text-gray-500 max-w-xs truncate" title={lead.notes}>
                          {lead.notes}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2.5 py-1 rounded-full border ${statusColors[lead.status]}`}>
                            {lead.status}
                          </span>
                        </td>
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
                        <td colSpan={9} className="px-5 py-10 text-center text-sm text-gray-400">
                          No leads match the current filters
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
                      <span className={`text-xs px-2.5 py-1 rounded-full border ${statusColors[entry.status]}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-3.5 text-gray-500 max-w-xs truncate" title={entry.notes}>
                      {entry.notes || "—"}
                    </td>
                    <td className="py-3.5 text-gray-400">
                      {new Date(entry.calledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
                {callLog.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-8 py-10 text-center text-sm text-gray-400">
                      No calls logged yet — run the Power Dialler to start logging calls.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Clients */}
        {page === "clients" && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex items-center justify-between border-b border-gray-100">
              <h1 className="text-xl font-bold">Clients</h1>
              <button className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium">
                <Plus size={15} /> Add client
              </button>
            </div>
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
          </div>
        )}
      </main>

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
            <form onSubmit={handleAddContact} className="px-6 py-5 space-y-4">
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
              <div className="grid grid-cols-2 gap-3">
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
                <label className="text-sm font-medium block mb-1.5">Notes</label>
                <textarea
                  value={contactForm.notes}
                  onChange={(e) => updateContactForm("notes", e.target.value)}
                  placeholder="Anything worth knowing before the next call…"
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400 resize-none"
                />
              </div>
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
    </div>
  );
}
