import { useEffect, useState } from "react";
import { ArrowLeft, Circle, Loader2, Mail, Plus, RefreshCw, Search, Send } from "lucide-react";
import { api } from "../lib/api";

// Conversations → Email: emails received through Resend (see
// api/email-inbound.js), plus emails sent from here (New / Reply), which
// go out through Resend with Reply-To pointing back at this inbox.

function shortTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function senderLabel(email) {
  if (email.outgoing) return `To: ${email.contactName || email.to?.[0] || "—"}`;
  return email.contactName || email.fromName || email.fromEmail || "Unknown sender";
}

const EMPTY_COMPOSE = { to: "", subject: "", body: "" };

// The last sender used in this browser — a convenience only, so every
// read/write is guarded (private windows can throw).
const SENDER_KEY = "scalbl.emailSender";
function loadSavedSender() {
  try {
    const v = JSON.parse(localStorage.getItem(SENDER_KEY) || "null");
    return v && typeof v.email === "string" ? v : null;
  } catch {
    return null;
  }
}
function saveSender(sender) {
  try {
    localStorage.setItem(SENDER_KEY, JSON.stringify(sender));
  } catch {
    // ignore
  }
}

// "From: Name <address> · Change" — expands to name + address fields.
function SenderFields({ sender, setSender, info }) {
  const [editing, setEditing] = useState(false);
  if (!info) return null;
  const label = sender.name ? `${sender.name} <${sender.email}>` : sender.email;
  if (!info.canChange) return <div className="text-xs text-gray-500">From: {label}</div>;
  if (!editing) {
    return (
      <div className="text-xs text-gray-500">
        From: <span className="text-gray-700">{label}</span>{" "}
        <button type="button" onClick={() => setEditing(true)} className="text-blue-600 hover:underline">
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <input
        value={sender.name}
        onChange={(e) => setSender((s) => ({ ...s, name: e.target.value }))}
        placeholder="From name, e.g. Henry at Scalbl"
        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
      />
      <input
        type="email"
        value={sender.email}
        onChange={(e) => setSender((s) => ({ ...s, email: e.target.value }))}
        placeholder={`name@${info.domain}`}
        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
      />
      <button
        type="button"
        onClick={() => setSender({ name: info.name, email: info.email })}
        className="text-xs text-gray-500 hover:text-gray-800 whitespace-nowrap"
      >
        Reset
      </button>
    </div>
  );
}

// Inbound HTML is untrusted: it's shown in a fully sandboxed iframe (no
// scripts, no same-origin access, links open in a new tab) so nothing in
// an email can touch the CRM or the signed-in session.
function EmailBody({ email }) {
  if (email.html) {
    const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#111;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${email.html}</body></html>`;
    return (
      <iframe
        title="Email body"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        className="w-full flex-1 min-h-[300px] border-0 bg-white"
      />
    );
  }
  return <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 font-sans p-4">{email.text || "(No message body)"}</pre>;
}

export default function EmailInbox({ active, contacts = [] }) {
  const [emails, setEmails] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [opened, setOpened] = useState(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  // New email (selectedId === "new") and the reply box under an open email.
  const [compose, setCompose] = useState(EMPTY_COMPOSE);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentNotice, setSentNotice] = useState("");
  // Who emails go out as: the server's default sender, or the last one
  // used in this browser (staff only can change it).
  const [senderInfo, setSenderInfo] = useState(null);
  const [sender, setSender] = useState({ name: "", email: "" });

  useEffect(() => {
    if (!active || senderInfo) return;
    api
      .get("/api/emails?sender=1")
      .then((info) => {
        setSenderInfo(info);
        const saved = info.canChange ? loadSavedSender() : null;
        const ok = saved && saved.email.toLowerCase().endsWith(`@${info.domain}`);
        setSender(ok ? { name: saved.name || "", email: saved.email } : { name: info.name, email: info.email });
      })
      .catch(() => {});
  }, [active, senderInfo]);

  // Polled every 30s while the tab is open and visible, like the SMS inbox.
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let fetching = false;
    const load = async () => {
      if (fetching || document.visibilityState === "hidden") return;
      fetching = true;
      setLoading(true);
      try {
        const list = await api.get("/api/emails");
        if (!cancelled) {
          setEmails(Array.isArray(list) ? list : []);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Couldn't load emails.");
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

  const send = async (payload) => {
    setSending(true);
    setSendError("");
    try {
      const from = senderInfo?.canChange ? { fromName: sender.name, fromEmail: sender.email } : {};
      const saved = await api.post("/api/emails", { ...payload, ...from });
      if (senderInfo?.canChange) saveSender(sender);
      setEmails((list) => [saved, ...list]);
      return saved;
    } catch (err) {
      setSendError(err.message || "Couldn't send that email.");
      return null;
    } finally {
      setSending(false);
    }
  };

  const sendNew = async (e) => {
    e.preventDefault();
    const saved = await send(compose);
    if (saved) {
      setCompose(EMPTY_COMPOSE);
      setSentNotice(`Sent to ${saved.to?.[0] || compose.to}.`);
      open(saved);
    }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!opened) return;
    const saved = await send({ replyToId: opened.id, body: reply });
    if (saved) {
      setReply("");
      setSentNotice(`Reply sent to ${saved.to?.[0] || ""}.`);
    }
  };

  const startNew = () => {
    setSelectedId("new");
    setOpened(null);
    setSendError("");
    setSentNotice("");
  };

  const contactEmails = [...new Set(contacts.map((c) => String(c.email || "").trim()).filter((v) => v.includes("@")))];

  const open = async (email) => {
    setSelectedId(email.id);
    setSendError("");
    setReply("");
    if (!String(email.id).startsWith("new")) setSentNotice((n) => (email.outgoing ? n : ""));
    setOpened(null);
    setOpening(true);
    try {
      const full = await api.get(`/api/emails?id=${email.id}`);
      setOpened(full);
      setEmails((list) => list.map((e) => (e.id === email.id ? { ...e, unread: false } : e)));
    } catch (err) {
      setError(err.message || "Couldn't open that email.");
    } finally {
      setOpening(false);
    }
  };

  if (!active) return null;

  const q = search.trim().toLowerCase();
  const shown = q
    ? emails.filter((e) =>
        [e.subject, e.fromEmail, e.fromName, e.contactName, e.preview].some((v) => String(v || "").toLowerCase().includes(q))
      )
    : emails;

  return (
    <section aria-label="Email inbox" className="flex flex-1 overflow-hidden">
      <div className={`w-full md:w-80 border-r border-gray-200 flex-col ${selectedId ? "hidden md:flex" : "flex"}`}>
        <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <span className="font-semibold">Email</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setReload((v) => v + 1)}
              disabled={loading}
              aria-label="Refresh"
              className="text-gray-500 hover:text-gray-900 disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={startNew}
              className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <Plus size={13} /> New
            </button>
          </div>
        </div>
        <div className="px-4 py-2 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search emails…"
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:border-gray-400"
            />
          </div>
        </div>
        {error && <div className="px-4 py-2 text-xs text-red-600 border-b border-red-100 bg-red-50">{error}</div>}
        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 && !loading && (
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              <Mail size={22} className="mx-auto mb-2 text-gray-300" />
              {q ? "No emails match." : "No emails received yet."}
            </div>
          )}
          {shown.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => open(e)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${
                selectedId === e.id ? "bg-gray-100" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {e.unread && <Circle size={8} className="fill-blue-500 text-blue-500 shrink-0" aria-label="Unread" />}
                <span className={`flex-1 truncate text-sm ${e.unread ? "font-semibold" : "font-medium"}`}>{senderLabel(e)}</span>
                {e.outgoing && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">Sent</span>
                )}
                <span className="text-xs text-gray-400 shrink-0">{shortTime(e.receivedAt)}</span>
              </div>
              <div className={`truncate text-sm ${e.unread ? "text-gray-900" : "text-gray-600"}`}>{e.subject || "(No subject)"}</div>
              <div className="truncate text-xs text-gray-400">{e.preview}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 flex-col min-w-0 ${selectedId ? "flex" : "hidden md:flex"}`}>
        {selectedId === "new" ? (
          <form onSubmit={sendNew} className="flex-1 flex flex-col p-4 md:p-6 gap-3 overflow-y-auto">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="md:hidden flex items-center gap-1 text-xs text-gray-500 self-start"
            >
              <ArrowLeft size={13} /> Back
            </button>
            <h2 className="text-base font-bold">New email</h2>
            <SenderFields sender={sender} setSender={setSender} info={senderInfo} />
            <input
              type="email"
              list="email-contacts"
              required
              value={compose.to}
              onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))}
              placeholder="To (email address)"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
            <datalist id="email-contacts">
              {contactEmails.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <input
              required
              value={compose.subject}
              onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))}
              placeholder="Subject"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
            <textarea
              required
              value={compose.body}
              onChange={(e) => setCompose((c) => ({ ...c, body: e.target.value }))}
              placeholder="Write your message…"
              rows={10}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 flex-1 min-h-[200px]"
            />
            {sendError && <div className="text-sm text-red-600">{sendError}</div>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sending}
                className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
              </button>
            </div>
          </form>
        ) : !selectedId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Select an email to read it.</div>
        ) : opening || !opened ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            <div className="px-4 md:px-6 py-4 border-b border-gray-100">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="md:hidden flex items-center gap-1 text-xs text-gray-500 mb-2"
              >
                <ArrowLeft size={13} /> Back
              </button>
              <h2 className="text-base font-bold break-words">{opened.subject || "(No subject)"}</h2>
              <div className="text-sm text-gray-600 mt-1 break-words">
                {opened.outgoing && <span className="text-gray-400">Sent{opened.sentBy ? ` by ${opened.sentBy}` : ""} · </span>}
                {opened.fromName ? `${opened.fromName} <${opened.fromEmail}>` : opened.fromEmail}
                {opened.contactName && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                    Contact: {opened.contactName}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 break-words">
                To {(opened.to || []).join(", ")} · {new Date(opened.receivedAt).toLocaleString()}
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-auto">
              <EmailBody email={opened} />
            </div>
            <form onSubmit={sendReply} className="border-t border-gray-100 p-3 md:p-4 space-y-2">
              {sentNotice && <div className="text-xs text-emerald-700">{sentNotice}</div>}
              <SenderFields sender={sender} setSender={setSender} info={senderInfo} />
              {sendError && <div className="text-xs text-red-600">{sendError}</div>}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Reply to ${opened.outgoing ? opened.to?.[0] || "" : opened.fromEmail}…`}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sending || !reply.trim()}
                  className="flex items-center gap-1.5 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Reply
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
