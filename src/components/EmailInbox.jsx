import { useEffect, useState } from "react";
import { ArrowLeft, Circle, Loader2, Mail, RefreshCw, Search } from "lucide-react";
import { api } from "../lib/api";

// Conversations → Email: emails received through Resend (see
// api/email-inbound.js). Read-only — replying is done from your own mail
// client for now.

function shortTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function sender(email) {
  return email.contactName || email.fromName || email.fromEmail || "Unknown sender";
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

export default function EmailInbox({ active }) {
  const [emails, setEmails] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [opened, setOpened] = useState(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);

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

  const open = async (email) => {
    setSelectedId(email.id);
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
          <button
            type="button"
            onClick={() => setReload((v) => v + 1)}
            disabled={loading}
            aria-label="Refresh"
            className="text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
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
                <span className={`flex-1 truncate text-sm ${e.unread ? "font-semibold" : "font-medium"}`}>{sender(e)}</span>
                <span className="text-xs text-gray-400 shrink-0">{shortTime(e.receivedAt)}</span>
              </div>
              <div className={`truncate text-sm ${e.unread ? "text-gray-900" : "text-gray-600"}`}>{e.subject || "(No subject)"}</div>
              <div className="truncate text-xs text-gray-400">{e.preview}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={`flex-1 flex-col min-w-0 ${selectedId ? "flex" : "hidden md:flex"}`}>
        {!selectedId ? (
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
          </>
        )}
      </div>
    </section>
  );
}
