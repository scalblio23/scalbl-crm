import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Plus, Search, Send, Trash2, X } from "lucide-react";
import { api } from "../lib/api";

// CSM tab — client success. Left: every client, with its retention
// confidence and mood at a glance. Right: the selected client's
// timeline (comments, plus a line for each confidence / mood change),
// with the confidence and mood controls above it and a comment box
// at the bottom. Backed by api/csm.js.

const CONFIDENCE_STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

const MOODS = [
  { key: "happy", label: "Happy", emoji: "😄", className: "bg-green-50 text-green-700 border-green-200" },
  { key: "satisfied", label: "Satisfied", emoji: "🙂", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "neutral", label: "Neutral", emoji: "😐", className: "bg-gray-50 text-gray-700 border-gray-200" },
  { key: "concerned", label: "Concerned", emoji: "😟", className: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "frustrated", label: "Frustrated", emoji: "😠", className: "bg-red-50 text-red-700 border-red-200" },
];
const moodOf = (key) => MOODS.find((m) => m.key === key) || null;

// Low → red, middling → amber, high → green.
function confidenceTone(value) {
  if (value === null || value === undefined) return "bg-gray-100 text-gray-400";
  if (value <= 0.3) return "bg-red-500 text-white";
  if (value <= 0.6) return "bg-amber-400 text-white";
  return "bg-green-500 text-white";
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function formatDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function CsmPanel() {
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [search, setSearch] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [addingClient, setAddingClient] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [error, setError] = useState("");
  const timelineEndRef = useRef(null);

  const selected = clients.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/csm")
      .then(({ clients: list }) => {
        if (cancelled) return;
        setClients(list || []);
        if (list?.length) setSelectedId((id) => id ?? list[0].id);
      })
      .catch((err) => !cancelled && setError(err.message || "Could not load clients."))
      .finally(() => !cancelled && setLoadingClients(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEntries([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingEntries(true);
    setMoodOpen(false);
    api
      .get(`/api/csm?clientId=${selectedId}`)
      .then(({ entries: list }) => !cancelled && setEntries(list || []))
      .catch((err) => !cancelled && setError(err.message || "Could not load the timeline."))
      .finally(() => !cancelled && setLoadingEntries(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Keep the newest entry in view, next to the comment box.
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, search]);

  // Entries grouped by day, oldest first.
  const days = useMemo(() => {
    const groups = [];
    for (const e of entries) {
      const label = formatDay(e.createdAt);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    return groups;
  }, [entries]);

  // A POST that returns { client, entry } — refresh both views from it.
  const applyResult = ({ client, entry }) => {
    if (client) setClients((list) => list.map((c) => (c.id === client.id ? client : c)));
    if (entry && entry.clientId === selectedId) setEntries((list) => [...list, entry]);
  };

  const sendComment = async () => {
    const text = comment.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setError("");
    try {
      applyResult(await api.post("/api/csm", { action: "comment", clientId: selected.id, text }));
      setComment("");
    } catch (err) {
      setError(err.message || "Could not add the comment.");
    } finally {
      setSending(false);
    }
  };

  const setConfidence = async (value) => {
    if (!selected || selected.confidence === value) return;
    setError("");
    try {
      applyResult(await api.post("/api/csm", { action: "confidence", clientId: selected.id, value }));
    } catch (err) {
      setError(err.message || "Could not update confidence.");
    }
  };

  const setMood = async (mood) => {
    setMoodOpen(false);
    if (!selected || selected.mood === mood) return;
    setError("");
    try {
      applyResult(await api.post("/api/csm", { action: "mood", clientId: selected.id, mood }));
    } catch (err) {
      setError(err.message || "Could not update the mood.");
    }
  };

  const addClient = async (e) => {
    e.preventDefault();
    const name = newClientName.trim();
    if (!name || addingClient) return;
    setAddingClient(true);
    setError("");
    try {
      const { client } = await api.post("/api/csm", { action: "add-client", name });
      setClients((list) => [...list, client].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(client.id);
      setNewClientName("");
      setShowAddClient(false);
    } catch (err) {
      setError(err.message || "Could not add the client.");
    } finally {
      setAddingClient(false);
    }
  };

  const removeClient = async () => {
    if (!selected) return;
    if (!window.confirm(`Remove ${selected.name} and its whole timeline? This can't be undone.`)) return;
    setError("");
    try {
      await api.delete(`/api/csm?clientId=${selected.id}`);
      const rest = clients.filter((c) => c.id !== selected.id);
      setClients(rest);
      setSelectedId(rest[0]?.id ?? null);
    } catch (err) {
      setError(err.message || "Could not remove the client.");
    }
  };

  const mood = moodOf(selected?.mood);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Client selector */}
      <aside className="w-72 shrink-0 border-r border-gray-100 flex flex-col min-h-0 bg-gray-50/50">
        <div className="px-4 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">CSM</h1>
            <button
              onClick={() => setShowAddClient((v) => !v)}
              title="Add client"
              className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 bg-white rounded-lg px-2 py-1"
            >
              <Plus size={13} /> Client
            </button>
          </div>
          {showAddClient && (
            <form onSubmit={addClient} className="mt-3 flex gap-1.5">
              <input
                autoFocus
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Client name"
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-gray-400 bg-white"
              />
              <button
                type="submit"
                disabled={!newClientName.trim() || addingClient}
                className="bg-gray-900 text-white text-xs font-semibold rounded-lg px-3 disabled:opacity-40"
              >
                {addingClient ? <Loader2 size={13} className="animate-spin" /> : "Add"}
              </button>
            </form>
          )}
          <div className="mt-3 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients"
              className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm outline-none focus:border-gray-400 bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loadingClients && (
            <div className="flex items-center gap-2 text-sm text-gray-400 px-3 py-4">
              <Loader2 size={14} className="animate-spin" /> Loading clients…
            </div>
          )}
          {!loadingClients && !filteredClients.length && (
            <div className="text-sm text-gray-400 px-3 py-4">{search ? "No clients match." : "No clients yet."}</div>
          )}
          {filteredClients.map((c) => {
            const m = moodOf(c.mood);
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left mb-0.5 ${
                  active ? "bg-white shadow-sm border border-gray-200" : "hover:bg-white border border-transparent"
                }`}
              >
                <span className="w-8 h-8 shrink-0 rounded-full bg-gray-200 text-gray-600 text-xs font-semibold flex items-center justify-center">
                  {initials(c.name)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">{c.name}</span>
                  <span className="block text-xs text-gray-400 truncate">
                    {c.commentCount ? `${c.commentCount} comment${c.commentCount === 1 ? "" : "s"}` : "No comments yet"}
                  </span>
                </span>
                {m && (
                  <span title={m.label} className="text-base leading-none">
                    {m.emoji}
                  </span>
                )}
                <span
                  title="Confidence of retaining"
                  className={`text-xs font-semibold rounded-md px-1.5 py-0.5 tabular-nums ${confidenceTone(c.confidence)}`}
                >
                  {c.confidence === null ? "—" : c.confidence.toFixed(1)}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Selected client */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        {error && (
          <div className="mx-6 mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          </div>
        )}
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            {loadingClients ? "" : "Pick a client on the left."}
          </div>
        ) : (
          <>
            <header className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="min-w-0 mr-auto">
                <h2 className="text-lg font-bold truncate">{selected.name}</h2>
                <div className="text-xs text-gray-400">
                  {selected.lastActivityAt ? `Last update ${formatDay(selected.lastActivityAt).toLowerCase()} at ${formatTime(selected.lastActivityAt)}` : "No activity yet"}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                  Confidence of retaining
                </div>
                <div className="flex gap-1" role="radiogroup" aria-label="Confidence of retaining">
                  {CONFIDENCE_STEPS.map((v) => {
                    const on = selected.confidence !== null && Math.abs(selected.confidence - v) < 0.001;
                    return (
                      <button
                        key={v}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setConfidence(v)}
                        title={`${Math.round(v * 100)}% likely to stay`}
                        className={`w-9 h-8 rounded-md text-xs font-semibold tabular-nums border ${
                          on ? `${confidenceTone(v)} border-transparent` : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {v.toFixed(1)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="relative">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Client mood</div>
                <button
                  onClick={() => setMoodOpen((o) => !o)}
                  className={`h-8 flex items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium ${
                    mood ? mood.className : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {mood ? (
                    <>
                      <span className="text-base leading-none">{mood.emoji}</span> {mood.label}
                    </>
                  ) : (
                    "Set mood"
                  )}
                  <ChevronDown size={14} />
                </button>
                {moodOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoodOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-lg p-1">
                      {MOODS.map((m) => (
                        <button
                          key={m.key}
                          onClick={() => setMood(m.key)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left hover:bg-gray-50 ${
                            selected.mood === m.key ? "font-semibold" : ""
                          }`}
                        >
                          <span className="text-base leading-none">{m.emoji}</span> {m.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={removeClient}
                title="Remove client"
                className="self-end h-8 w-8 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50"
              >
                <Trash2 size={15} />
              </button>
            </header>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loadingEntries ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Loading timeline…
                </div>
              ) : !entries.length ? (
                <div className="text-sm text-gray-400 text-center mt-10">
                  Nothing here yet. Add the first comment below, or set a confidence and mood.
                </div>
              ) : (
                <ol className="relative border-l border-gray-200 ml-2">
                  {days.map((day) => (
                    <li key={day.label} className="mb-2">
                      <div className="-ml-2 mb-3 inline-block bg-white pr-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {day.label}
                      </div>
                      {day.items.map((e) => (
                        <TimelineItem key={e.id} entry={e} />
                      ))}
                    </li>
                  ))}
                </ol>
              )}
              <div ref={timelineEndRef} />
            </div>

            {/* Comment box — right padding keeps Send clear of the
                floating dial button in the page's bottom-right corner. */}
            <div className="border-t border-gray-100 pl-6 pr-24 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendComment();
                    }
                  }}
                  rows={2}
                  placeholder={`Add a comment about ${selected.name}… (Enter to send, Shift+Enter for a new line)`}
                  className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
                <button
                  onClick={sendComment}
                  disabled={!comment.trim() || sending}
                  className="h-10 flex items-center gap-1.5 bg-gray-900 hover:bg-black text-white text-sm font-semibold rounded-xl px-4 disabled:opacity-40"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TimelineItem({ entry }) {
  const time = formatTime(entry.createdAt);
  if (entry.kind === "comment") {
    return (
      <div className="relative pl-6 mb-4">
        <span className="absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full bg-gray-900 ring-4 ring-white" />
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm max-w-3xl">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-900">{entry.author || "Someone"}</span>
            <span className="text-xs text-gray-400">{time}</span>
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{entry.text}</div>
        </div>
      </div>
    );
  }

  let body;
  if (entry.kind === "confidence") {
    const v = Number(entry.value);
    body = (
      <>
        set confidence to{" "}
        <span className={`inline-block text-xs font-semibold rounded px-1.5 py-0.5 tabular-nums ${confidenceTone(v)}`}>
          {v.toFixed(1)}
        </span>
      </>
    );
  } else if (entry.kind === "mood") {
    const m = moodOf(entry.value);
    body = (
      <>
        set mood to{" "}
        <span className="font-medium text-gray-700">
          {m ? `${m.emoji} ${m.label}` : entry.value}
        </span>
      </>
    );
  } else {
    body = entry.text || entry.kind;
  }
  return (
    <div className="relative pl-6 mb-4 text-sm text-gray-500">
      <span className="absolute -left-[4px] top-1.5 w-2 h-2 rounded-full bg-gray-300 ring-4 ring-white" />
      <span className="font-medium text-gray-700">{entry.author || "Someone"}</span> {body}
      <span className="text-xs text-gray-400 ml-2">{time}</span>
    </div>
  );
}
