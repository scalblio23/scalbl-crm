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
  Pencil,
  LayoutGrid,
  Table2,
  Upload,
  Loader2,
  LogOut,
  Lock,
} from "lucide-react";
import { placeCall, hangUp } from "./lib/twilioDevice";
import { api } from "./lib/api";

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

// ---------- Client table (dynamic columns) ----------
const CLIENT_COLUMN_TYPES = [
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

function formatClientCellDisplay(col, value) {
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

function formatCallDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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
        const { clients: clientsData, clientColumns: clientColumnsData, contacts: contactsData, conversations: conversationsData, dialLists: dialListsData, calledLeadIds: calledLeadIdsData, callLog: callLogData } =
          await api.get("/api/bootstrap");
        if (cancelled) return;
        setClients(clientsData);
        setClientColumns(clientColumnsData);
        setContacts(contactsData);
        setConversations(conversationsData);
        setDialLists(dialListsData);
        setCalledLeadIds(calledLeadIdsData);
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
    name: "",
    email: "",
    phone: "",
    client: "All",
    notes: "",
    status: "All",
  };
  const [dialFilters, setDialFilters] = useState(emptyDialFilters);

  // Secondary sidebar (Contacts) — filters the table down to one
  // status tag at a time, "All" shows everyone.
  const [contactsTagFilter, setContactsTagFilter] = useState("All");
  const contactTagCounts = contacts.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  // The fixed status tags first (in their usual order), then any
  // status value that shows up on a contact but isn't one of the
  // fixed ones — still a valid thing to filter by.
  const contactTagNames = [
    ...Object.keys(statusColors),
    ...Array.from(new Set(contacts.map((c) => c.status))).filter((s) => s && !statusColors[s]),
  ];

  const filteredContacts = contacts.filter(
    (c) =>
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.client.toLowerCase().includes(search.toLowerCase())) &&
      (contactsTagFilter === "All" || c.status === contactsTagFilter)
  );

  // Bulk-select + delete on the Contacts table
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const toggleContactSelected = (id) =>
    setSelectedContactIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const allVisibleContactsSelected =
    filteredContacts.length > 0 && filteredContacts.every((c) => selectedContactIds.includes(c.id));
  const toggleSelectAllContacts = () =>
    setSelectedContactIds(allVisibleContactsSelected ? [] : filteredContacts.map((c) => c.id));

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

    const display = formatClientCellDisplay(col, value);
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
  const filteredDialQueueBase = dialQueue.filter(
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
    const summary = `Outgoing call · ${timeLabel} · ${formatCallDuration(durationMs)} · by ${authUser?.name || "You"}`;
    const message = { id: `call-${lead.id}-${now.getTime()}`, type: "call", text: summary, time: timeLabel };

    const existing = conversations.find((c) => c.leadId === lead.id);
    let tempId = existing?.id;
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
      tempId = conversations.length ? Math.max(...conversations.map((c) => c.id)) + 1 : 1;
      const newConvo = {
        id: tempId,
        leadId: lead.id,
        name: lead.name,
        preview: summary,
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
      .post("/api/conversations", { leadId: lead.id, name: lead.name, text: summary, time: timeLabel })
      .then(({ conversationId }) => {
        if (!existing && conversationId && conversationId !== tempId) {
          setConversations((cs) => cs.map((c) => (c.id === tempId ? { ...c, id: conversationId } : c)));
          setActiveConvo((prev) => (prev === tempId ? conversationId : prev));
        }
      })
      .catch((err) => setDbError(err.message || "Could not save the call to the conversation."));
  };

  // ----- Power Dialler session (auto-dial through a list) -----
  const [dialLists, setDialLists] = useState([]); // [{ id, name, leadIds }]

  // Secondary sidebar (Powerdialler) — narrows the queue below to one
  // saved powerlist at a time, "all" shows every lead.
  const [dialListFilter, setDialListFilter] = useState("all");
  const filteredDialQueue = filteredDialQueueBase.filter(
    (l) =>
      dialListFilter === "all" ||
      (dialLists.find((dl) => dl.id === dialListFilter)?.leadIds || []).includes(l.id)
  );

  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [newListName, setNewListName] = useState("");
  const [calledLeadIds, setCalledLeadIds] = useState([]); // leads already worked, across all lists
  const [session, setSession] = useState(null); // { listName, queue: [leadId,...] }
  const [sessionPaused, setSessionPaused] = useState(false);
  const [wrapUp, setWrapUp] = useState(null); // { lead, status, notes, secondsLeft }
  const [callLog, setCallLog] = useState([]);

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
    const tempLogId = `${lead.id}-${Date.now()}`;
    setCallLog((log) => [
      { id: tempLogId, leadId: lead.id, name: lead.name, phone: lead.phone, client: lead.client, status, notes, calledAt: new Date().toISOString() },
      ...log,
    ]);
    setCalledLeadIds((ids) => [...ids, lead.id]);
    setWrapUp(null);

    // Persist to the database — fire-and-forget, surfaced as a banner
    // on failure rather than blocking the session from moving on.
    api
      .patch("/api/contacts", { id: lead.id, status, notes, lastContact: "Today" })
      .catch((err) => setDbError(err.message || "Could not save the updated lead."));
    api
      .post("/api/call-log", { leadId: lead.id, name: lead.name, phone: lead.phone, client: lead.client, status, notes })
      .then((saved) => {
        if (saved?.id) setCallLog((log) => log.map((e) => (e.id === tempLogId ? saved : e)));
      })
      .catch((err) => setDbError(err.message || "Could not save the call log entry."));
    api.post("/api/called-leads", { leadId: lead.id }).catch(() => {});

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
          nav, lets you browse Contacts by client and Powerdialler by
          saved powerlist without leaving the page. */}
      {(page === "contacts" || page === "powerdialler") && (
        <aside className="w-44 border-r border-gray-200 bg-gray-50 flex flex-col shrink-0 overflow-y-auto">
          {page === "contacts" && (
            <>
              <div className="px-4 pt-5 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Tags
              </div>
              <nav className="flex-1 pb-4">
                <button
                  onClick={() => setContactsTagFilter("All")}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                    contactsTagFilter === "All"
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
                    onClick={() => setContactsTagFilter(tag)}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left transition-colors ${
                      contactsTagFilter === tag
                        ? "bg-white font-semibold text-gray-900 border-r-2 border-gray-900"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    <span
                      className={`truncate text-xs px-2.5 py-1 rounded-full border ${
                        statusColors[tag] || "bg-gray-50 text-gray-500 border-gray-200"
                      }`}
                    >
                      {tag}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{contactTagCounts[tag] || 0}</span>
                  </button>
                ))}
                {contactTagNames.length === 0 && (
                  <div className="px-4 py-2 text-xs text-gray-400">No tags yet</div>
                )}
              </nav>
            </>
          )}

          {page === "powerdialler" && (
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
                  {selectedConvoIds.length > 0 && (
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
                {contactsTagFilter !== "All" && (
                  <div className="text-sm text-gray-400 mt-0.5">Tagged {contactsTagFilter}</div>
                )}
              </div>
              <div className="flex gap-3">
                {selectedContactIds.length > 0 && (
                  <button
                    onClick={deleteSelectedContacts}
                    className="flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 text-sm px-4 py-2 rounded-lg font-medium"
                  >
                    <Trash2 size={15} /> Delete {selectedContactIds.length} selected
                  </button>
                )}
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
                  <th className="pl-8 pr-2 py-3 font-medium w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleContactsSelected}
                      onChange={toggleSelectAllContacts}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="py-3 font-medium">Phone</th>
                  <th className="py-3 font-medium">Client</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 font-medium">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="pl-8 pr-2 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(c.id)}
                        onChange={() => toggleContactSelected(c.id)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-medium">{c.name}</td>
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
                {filteredContacts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-8 py-10 text-center text-sm text-gray-400">
                      No contacts{contactsTagFilter !== "All" ? ` tagged ${contactsTagFilter}` : ""}
                      {search ? ` match "${search}"` : ""}
                    </td>
                  </tr>
                )}
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
                    onClick={() => setDialFilters(emptyDialFilters)}
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
                  {CLIENT_COLUMN_TYPES.map((t) => (
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
    </div>
  );
}
