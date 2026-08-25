import { useState } from "react";
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
} from "lucide-react";

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
  { id: 1, name: "Sarah Mitchell", preview: "Yes I'm interested in the battery rebate", time: "10:32 AM", unread: true },
  { id: 2, name: "Tom Nguyen", preview: "What deposit do I need?", time: "9:15 AM", unread: true },
  { id: 3, name: "Emma Taylor", preview: "Confirmed for Thursday 2pm", time: "Yesterday", unread: false },
  { id: 4, name: "David Chen", preview: "Can you call me after 5?", time: "Yesterday", unread: false },
];

const statusColors = {
  "New Lead": "bg-blue-50 text-blue-700 border-blue-200",
  Contacted: "bg-amber-50 text-amber-700 border-amber-200",
  Booked: "bg-green-50 text-green-700 border-green-200",
  "No Answer": "bg-gray-50 text-gray-500 border-gray-200",
};

// ---------- Sidebar ----------
const navItems = [
  { key: "conversation", label: "Conversation", icon: MessageSquare },
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "powerdialler", label: "Powerdialler", icon: Phone },
  { key: "clients", label: "Clients", icon: Briefcase },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function SimpleCRM() {
  const [page, setPage] = useState("conversation");
  const [contacts] = useState(initialContacts);
  const [clients] = useState(initialClients);
  const [conversations] = useState(initialConversations);
  const [activeConvo, setActiveConvo] = useState(1);
  const [search, setSearch] = useState("");

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
          Henry · Admin
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
                <div className="max-w-xs bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm">
                  {conversations.find((c) => c.id === activeConvo)?.preview}
                </div>
                <div className="max-w-xs bg-gray-900 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm ml-auto">
                  No worries — I'll give you a call shortly to run through it.
                </div>
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
                <button className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium">
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

            {/* Hotseat — the live call in progress */}
            <div className="px-8 pt-6">
              {calling && activeLead ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3 w-3 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-600" />
                      </span>
                      <div className="text-xs font-semibold uppercase tracking-widest text-green-700">
                        Live call
                      </div>
                    </div>
                    <button
                      onClick={() => setCalling(false)}
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
                              onClick={() => setCalling(false)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              <PhoneOff size={14} /> End
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setActiveLeadId(lead.id);
                                setCalling(true);
                              }}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-600 hover:text-green-700"
                            >
                              <PhoneCall size={14} /> Call
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredDialQueue.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-10 text-center text-sm text-gray-400">
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
    </div>
  );
}
