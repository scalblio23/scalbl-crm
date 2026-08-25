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
  ChevronRight,
  Circle,
} from "lucide-react";

// ---------- Sample data ----------
const initialContacts = [
  { id: 1, name: "Sarah Mitchell", phone: "0412 334 556", client: "Lux Solar", status: "New Lead", lastContact: "Today" },
  { id: 2, name: "David Chen", phone: "0433 221 908", client: "Lux Solar", status: "Contacted", lastContact: "Yesterday" },
  { id: 3, name: "Emma Taylor", phone: "0401 887 234", client: "Stoprent Properties", status: "Booked", lastContact: "Mon" },
  { id: 4, name: "James Wilson", phone: "0455 112 763", client: "Silverloom Advisory", status: "New Lead", lastContact: "Today" },
  { id: 5, name: "Priya Sharma", phone: "0422 645 190", client: "Lasertronics", status: "No Answer", lastContact: "Tue" },
  { id: 6, name: "Tom Nguyen", phone: "0466 903 415", client: "Stoprent Properties", status: "Contacted", lastContact: "Today" },
];

const initialClients = [
  { id: 1, name: "Lux Solar", industry: "Solar", leads: 42, adsLive: true },
  { id: 2, name: "Stoprent Properties", industry: "Property", leads: 31, adsLive: true },
  { id: 3, name: "Silverloom Advisory", industry: "Finance", leads: 18, adsLive: true },
  { id: 4, name: "Lasertronics", industry: "Office Equipment", leads: 9, adsLive: false },
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
  const [dialIndex, setDialIndex] = useState(0);
  const [calling, setCalling] = useState(false);

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.client.toLowerCase().includes(search.toLowerCase())
  );

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
          <div className="flex-1 flex items-center justify-center bg-gray-50/40">
            <div className="w-full max-w-md">
              <div className="text-center mb-6">
                <div className="text-xs uppercase tracking-widest text-gray-400 mb-1">Powerdialler</div>
                <div className="text-sm text-gray-500">
                  {dialIndex + 1} of {contacts.length} in queue
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
                <div className="text-2xl font-bold">{contacts[dialIndex].name}</div>
                <div className="text-gray-500 mt-1">{contacts[dialIndex].phone}</div>
                <div className="text-sm text-gray-400 mt-0.5">{contacts[dialIndex].client}</div>
                <span className={`inline-block mt-3 text-xs px-2.5 py-1 rounded-full border ${statusColors[contacts[dialIndex].status]}`}>
                  {contacts[dialIndex].status}
                </span>
                <div className="mt-8 flex justify-center gap-4">
                  {!calling ? (
                    <button
                      onClick={() => setCalling(true)}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-full font-semibold"
                    >
                      <PhoneCall size={18} /> Call
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setCalling(false);
                        setDialIndex((i) => (i + 1) % contacts.length);
                      }}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full font-semibold"
                    >
                      <PhoneOff size={18} /> End & next
                    </button>
                  )}
                </div>
                {calling && <div className="mt-4 text-sm text-green-600 font-medium animate-pulse">Calling…</div>}
              </div>
              <button
                onClick={() => setDialIndex((i) => (i + 1) % contacts.length)}
                className="mt-4 w-full flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-800 py-2"
              >
                Skip to next <ChevronRight size={15} />
              </button>
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
                  <div className="mt-4 text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{cl.leads}</span> leads this month
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
