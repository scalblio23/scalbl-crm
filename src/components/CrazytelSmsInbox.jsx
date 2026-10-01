import { useEffect, useRef, useState } from "react";
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

  const start = async (event) => {
    event.preventDefault();
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = createStartPayload(leadId, fromNumber, contacts, fromNumbers);
      const result = await api.post("/api/sms-threads", payload);
      if (!result?.thread?.id || result.error) throw new Error("Thread unavailable");
      setThreads((items) => [result.thread, ...items.filter((item) => item.id !== result.thread.id)]);
      setSelectedId(result.thread.id);
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

  if (!active) return null;
  const fieldClass = "border border-gray-300 rounded px-3 py-2 text-sm bg-white disabled:opacity-50";
  return (
    <section aria-label="Crazytel SMS inbox" className="flex flex-1 min-h-0 flex-col">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-semibold">Crazytel SMS</h2>
            <p className="text-xs text-gray-500">Separate SMS threads. Legacy inbox, calls, recordings and Twilio sending are unchanged.</p>
            <p className="text-xs text-amber-700">Inbound replies are not connected to this CRM yet. Outbound sends only; queued does not mean delivered.</p></div>
          <button type="button" className={fieldClass} onClick={() => setReload((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
        <form onSubmit={start} className="flex flex-wrap gap-2 items-center">
          <label className="text-xs">Contact
            <select aria-label="Crazytel contact" value={leadId} onChange={(event) => setLeadId(event.target.value)} className={`${fieldClass} ml-2`}>
              <option value="">Select contact…</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name || contact.id}</option>)}
            </select>
          </label>
          <label className="text-xs">From (owned DID)
            <select aria-label="Crazytel sending DID" value={fromNumber} onChange={(event) => setFromNumber(event.target.value)} className={`${fieldClass} ml-2`}>
              <option value="">Select owned number…</option>
              {fromNumbers.map((number) => <option key={number} value={number}>{number}</option>)}
            </select>
          </label>
          <button className={fieldClass} disabled={busy || !!loadError || !contacts.some((contact) => String(contact.id) === leadId) || !fromNumbers.includes(fromNumber)}>Start SMS thread</button>
          <span className="text-xs text-gray-500">Destination comes from the saved contact. Save numbers in international format, e.g. +614…</span>
        </form>
        {!loading && !loadError && !fromNumbers.length && <p className="text-sm text-amber-700">No owned Crazytel sending numbers are configured. New SMS threads are unavailable.</p>}
        {loading && <p role="status" className="text-xs text-gray-500">Refreshing SMS threads…</p>}
        {loadError && <p role="alert" className="text-sm text-red-700">{loadError} Previously loaded messages may be out of date.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div aria-label="Crazytel SMS threads" className="w-72 max-w-[40%] shrink-0 border-r overflow-y-auto">
          {!loading && !loadError && !threads.length && <p className="p-4 text-sm text-gray-500">No Crazytel SMS threads yet.</p>}
          {threads.map((thread) => (
            <button type="button" key={thread.id} onClick={() => markRead(thread)} aria-pressed={selectedId === thread.id}
              className={`block w-full p-4 border-b text-left text-sm ${selectedId === thread.id ? "bg-blue-50" : "hover:bg-gray-50"}`}>
              <div className="font-medium break-words">{thread.name || "Unknown sender"} {thread.unread ? <span className="text-blue-700">• Unread</span> : null}</div>
              <div className="text-xs text-gray-500 break-all">Local: {thread.localNumber}<br />Remote: {thread.remoteNumber}</div>
              <p className="truncate mt-1">{thread.preview}</p>
              <p className="text-xs text-gray-500">{formatSmsTime(thread.updatedAt)}</p>
            </button>
          ))}
        </div>
        {selected ? (
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="p-4 border-b text-sm">
              <h3 className="font-semibold">{selected.name || "Unknown sender"}</h3>
              <p className="break-all">Local DID: {selected.localNumber} · Remote: {selected.remoteNumber}</p>
              <p className="text-xs text-gray-500">Sends use this thread’s selected local DID.</p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" aria-label="Crazytel messages">
              {(selected.messages || []).map((message) => (
                <div key={message.id} className={`max-w-lg rounded-lg p-3 text-sm ${message.outgoing ? "ml-auto bg-blue-50" : "bg-gray-100"}`}>
                  <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  <p className="text-xs text-gray-500 mt-1">{message.outgoing ? "Outgoing" : "Incoming"} · {message.status || "Status unavailable"} · {formatSmsTime(message.createdAt)}</p>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="p-4 border-t space-y-2">
              {attempt && !busy && <p role="status" className="text-sm text-amber-700">Unconfirmed send retained. Text is locked so a manual retry uses the same request ID; do not compose a duplicate.</p>}
              <label className="block text-sm" htmlFor="crazytel-message">Message</label>
              <textarea id="crazytel-message" rows={3} maxLength={1600} value={draft} disabled={busy || !!attempt}
                onChange={(event) => setDrafts((items) => ({ ...items, [selectedId]: event.target.value }))}
                className={`${fieldClass} w-full`} />
              <button className={fieldClass} disabled={busy || !!loadError || !draft.trim()}>{busy ? "Working…" : attempt ? "Retry same send" : "Send via Crazytel"}</button>
            </form>
          </div>
        ) : <p className="p-6 text-sm text-gray-500">Select a Crazytel SMS thread or start one with a contact.</p>}
      </div>
    </section>
  );
}
