import { useEffect, useRef, useState } from "react";
import { Circle, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { api } from "../lib/api";

// Boundary helpers: keep browser-supplied phone numbers out of reply requests.
export function createReplyAttempt(threadId, text, previous, makeId = () => crypto.randomUUID()) {
  if (previous) {
    if (previous.threadId !== threadId || previous.text !== text.trim()) throw new Error("Unresolved send");
    return previous;
  }
  if (!threadId || !text.trim()) throw new Error("Missing message");
  return Object.freeze({ action: "reply", threadId, text: text.trim(), clientRequestId: makeId() });
}

export async function postReply(client, attempt) {
  const result = await client.post("/api/sms-threads", attempt);
  if (!result || result.error || !(result.thread || result.message || result.id)) throw new Error("Unconfirmed send");
  return result;
}

export function createStartPayload(leadId, fromNumber, contacts, fromNumbers) {
  const contact = contacts.find((item) => String(item.id) === String(leadId));
  if (!contact || !fromNumbers.includes(fromNumber)) throw new Error("Select a contact and an owned number");
  return { action: "start", leadId: contact.id, fromNumber };
}

export function smsError(error) {
  if (error?.status === 401) return "Your session expired. Sign in again to use Crazytel SMS.";
  if (error?.status === 403) return "You do not have permission to access this Crazytel SMS conversation.";
  if ([404, 501, 503].includes(error?.status)) return "Crazytel SMS is not configured or is currently unavailable. Contact your administrator.";
  if (error?.status === 429) return "Crazytel SMS is busy. Wait before trying again.";
  return "Crazytel SMS could not complete this request. The service may be unavailable. Refresh or try again manually.";
}

export function formatSmsTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Time unavailable";
}

// "8:52 AM" for today, "15 Oct" otherwise — same feel as the legacy inbox list.
function shortSmsTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

// React view
export default function CrazytelSmsInbox({ active, contacts }) {
  const [threads, setThreads] = useState([]);
  const [fromNumbers, setFromNumbers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [leadId, setLeadId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [drafts, setDrafts] = useState({});
  const [pending, setPending] = useState({});
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const messagesEnd = useRef(null);
  const mutationBusy = useRef(false);
  const attempts = useRef(new Map());
  const selected = threads.find((thread) => thread.id === selectedId);
  const draft = drafts[selectedId] || "";
  const attempt = pending[selectedId];

  // Kept mounted by SimpleCRM so unresolved request IDs survive view/navigation changes.
  // Only reads are polled, never sends. No overlapping polls or hidden-tab requests.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let fetching = false;
    const load = async () => {
      if (fetching || document.visibilityState === "hidden") return;
      fetching = true;
      setLoading(true);
      try {
        const result = await api.get("/api/sms-threads");
        if (!Array.isArray(result?.threads) || !Array.isArray(result?.fromNumbers)) throw new Error("Unavailable");
        if (!cancelled) {
          setThreads(result.threads);
          setFromNumbers(result.fromNumbers.filter((number) => typeof number === "string"));
          setLoadError("");
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(smsError(err));
          if ([401, 403].includes(err?.status)) { setThreads([]); setFromNumbers([]); }
        }
      } finally {
        fetching = false;
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 30000);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [active, reload]);

  const markRead = async (thread) => {
    setSelectedId(thread.id);
    setError("");
    if (!thread.unread) return;
    try {
      const result = await api.post("/api/sms-threads", { action: "read", threadId: thread.id });
      if (result?.error) throw new Error("Read failed");
      // Re-read authoritative unread state rather than hiding new incoming messages.
      setReload((value) => value + 1);
    } catch (err) { setError(smsError(err)); }
  };

  const start = async (pickedLeadId) => {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = createStartPayload(pickedLeadId, fromNumber || fromNumbers[0], contacts, fromNumbers);
      const result = await api.post("/api/sms-threads", payload);
      if (!result?.thread?.id || result.error) throw new Error("Thread unavailable");
      setThreads((items) => [result.thread, ...items.filter((item) => item.id !== result.thread.id)]);
      setSelectedId(result.thread.id);
      setShowNew(false);
      setLeadId("");
      setReload((value) => value + 1);
    } catch (err) { setError(smsError(err)); }
    finally { mutationBusy.current = false; setBusy(false); }
  };

  const send = async (event) => {
    event.preventDefault();
    if (!selected || mutationBusy.current || !draft.trim()) return;
    const threadId = selected.id;
    mutationBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const request = createReplyAttempt(threadId, draft, attempts.current.get(threadId));
      // Record before awaiting the network; an uncertain failure keeps both ID and text.
      attempts.current.set(threadId, request);
      setPending((items) => ({ ...items, [threadId]: request }));
      const result = await postReply(api, request);
      if (result.thread) {
        setThreads((items) => items.map((item) => item.id === threadId ? result.thread : item));
      }
      attempts.current.delete(threadId);
      setPending((items) => { const next = { ...items }; delete next[threadId]; return next; });
      setDrafts((items) => ({ ...items, [threadId]: "" }));
      setReload((value) => value + 1);
    } catch (err) {
      setError(`${smsError(err)} Send not confirmed; it may already have been accepted. No automatic resend. Review the thread, then use Retry same send if needed.`);
    } finally { mutationBusy.current = false; setBusy(false); }
  };

  // Keep the newest message in view, like any chat.
  const messageCount = selected?.messages?.length || 0;
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" });
  }, [selectedId, messageCount]);

  if (!active) return null;
  const q = search.trim().toLowerCase();
  const visibleThreads = q
    ? threads.filter((t) => [t.name, t.remoteNumber, t.preview].some((v) => String(v || "").toLowerCase().includes(q)))
    : threads;
  const phonedContacts = contacts.filter((c) => c.phone);
  return (
    <section aria-label="Crazytel SMS inbox" className="flex flex-1 overflow-hidden">
      <div className="w-80 border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <span className="font-semibold">Conversations</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
              disabled={loading}
              aria-label="Refresh"
              className="text-gray-500 hover:text-gray-900 disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              disabled={!fromNumbers.length}
              className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40"
            >
              <Plus size={13} /> New
            </button>
          </div>
        </div>
        {showNew && (
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 space-y-2">
            {fromNumbers.length > 1 && (
              <select
                aria-label="Send from"
                value={fromNumber || fromNumbers[0]}
                onChange={(event) => setFromNumber(event.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
              >
                {fromNumbers.map((number) => <option key={number} value={number}>From {number}</option>)}
              </select>
            )}
            <select
              autoFocus
              aria-label="Text a contact"
              value={leadId}
              disabled={busy}
              onChange={(event) => { setLeadId(event.target.value); if (event.target.value) start(event.target.value); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
            >
              <option value="" disabled>Text a contact…</option>
              {phonedContacts.map((c) => <option key={c.id} value={c.id}>{c.name || c.id} — {c.phone}</option>)}
            </select>
          </div>
        )}
        <div className="px-4 py-2.5 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }}
              placeholder="Search conversations…"
              className="w-full border border-gray-200 rounded-lg pl-8 pr-8 py-2 text-sm outline-none focus:border-gray-400"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {loadError && <p role="alert" className="px-4 py-2 text-xs text-red-600 border-b border-gray-100">{loadError}</p>}
        {!loadError && !loading && !fromNumbers.length && (
          <p className="px-4 py-2 text-xs text-amber-700 border-b border-gray-100">No Crazytel sending numbers are set up, so new conversations can't be started.</p>
        )}
        <div aria-label="Crazytel SMS threads" className="flex-1 overflow-y-auto">
          {!loading && !loadError && !threads.length && (
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              No conversations yet — texts from automations and replies will appear here, or start one with "New".
            </div>
          )}
          {threads.length > 0 && !visibleThreads.length && (
            <div className="px-4 py-10 text-center text-sm text-gray-400">No conversations match "{search.trim()}".</div>
          )}
          {visibleThreads.map((thread) => (
            <button type="button" key={thread.id} onClick={() => markRead(thread)} aria-pressed={selectedId === thread.id}
              className={`block w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${selectedId === thread.id ? "bg-gray-50" : ""}`}>
              <div className="flex justify-between items-center gap-2">
                <span className={`text-sm truncate ${thread.unread ? "font-semibold" : "font-medium"}`}>{thread.name || thread.remoteNumber}</span>
                <span className="text-xs text-gray-400 shrink-0">{shortSmsTime(thread.updatedAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {thread.unread && <Circle size={7} className="fill-blue-500 text-blue-500 shrink-0" />}
                <span className="text-xs text-gray-500 truncate">{thread.preview}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <>
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="font-semibold">{selected.name || selected.remoteNumber}</div>
              {selected.name && selected.name !== selected.remoteNumber && (
                <div className="text-xs text-gray-400">{selected.remoteNumber}</div>
              )}
            </div>
            <div className="flex-1 p-6 space-y-3 overflow-y-auto bg-gray-50/50" aria-label="Crazytel messages">
              {(selected.messages || []).map((message) => {
                const problem = message.status === "failed" ? "Not sent" : message.status === "unknown" ? "Not confirmed" : message.status === "sending" ? "Sending…" : "";
                return (
                  <div key={message.id} className={`flex flex-col ${message.outgoing ? "items-end" : "items-start"}`}>
                    <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                      message.outgoing ? "bg-gray-900 text-white rounded-tr-sm" : "bg-gray-100 rounded-tl-sm"
                    }`}>
                      {message.text}
                    </div>
                    <span className="text-[11px] text-gray-400 mt-1 px-1" title={formatSmsTime(message.createdAt)}>
                      {shortSmsTime(message.createdAt)}
                      {problem && <span className="text-red-500"> · {problem}</span>}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEnd} />
            </div>
            <form onSubmit={send} className="p-4 border-t border-gray-100 flex flex-col gap-1.5">
              {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
              {attempt && !busy && (
                <p role="status" className="text-xs text-amber-700">
                  That send wasn't confirmed. The text is kept as-is — check the thread before pressing Retry, to avoid a duplicate.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  id="crazytel-message"
                  aria-label="Message"
                  maxLength={1600}
                  value={draft}
                  disabled={busy || !!attempt}
                  onChange={(event) => setDrafts((items) => ({ ...items, [selectedId]: event.target.value }))}
                  placeholder="Type a message…"
                  className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
                />
                <button
                  disabled={busy || !!loadError || !draft.trim()}
                  className="flex items-center justify-center bg-gray-900 text-white text-sm px-5 rounded-lg font-medium min-w-[72px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : attempt ? "Retry" : "Send"}
                </button>
              </div>
              <div className="text-xs text-gray-400">Sent as an SMS via Crazytel from {selected.localNumber}</div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-gray-400">
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            {threads.length ? "Select a conversation" : "No conversations yet"}
          </div>
        )}
      </div>
    </section>
  );
}
