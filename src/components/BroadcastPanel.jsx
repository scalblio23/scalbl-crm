import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Megaphone, RefreshCw, Search, Send, X } from "lucide-react";
import { api } from "../lib/api";

// The Broadcast tab: one email to many contacts through Resend (see
// server/broadcasts.js). Pick recipients by tag and/or status, plus
// hand-picked contacts; preview the count; send a test; then send. The
// send runs in batches of 100 from here, with a progress bar — if the
// tab is closed mid-send, the every-minute cron finishes it.

function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${
        on ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
      }`}
    >
      {children}
    </button>
  );
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function BroadcastPanel({ active, contacts = [], tags = [], statuses = [] }) {
  const [selTags, setSelTags] = useState([]);
  const [selStatuses, setSelStatuses] = useState([]);
  const [picked, setPicked] = useState([]); // contact ids
  const [contactSearch, setContactSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [senderInfo, setSenderInfo] = useState(null);
  const [sender, setSender] = useState({ name: "", email: "" });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendingId, setSendingId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState([]);
  const [failures, setFailures] = useState(null);
  const stopRef = useRef(false);

  const audience = { tags: selTags, statuses: selStatuses, contactIds: picked };
  const audienceKey = JSON.stringify(audience);

  const loadHistory = () =>
    api
      .get("/api/broadcasts")
      .then((list) => setHistory(Array.isArray(list) ? list : []))
      .catch(() => {});

  useEffect(() => {
    if (!active) return;
    loadHistory();
    if (!senderInfo) {
      api
        .get("/api/emails?sender=1")
        .then((info) => {
          setSenderInfo(info);
          setSender({ name: info.name, email: info.email });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Live recipient count as the audience changes (debounced).
  useEffect(() => {
    if (!active) return undefined;
    if (!selTags.length && !selStatuses.length && !picked.length) {
      setPreview(null);
      return undefined;
    }
    setPreviewing(true);
    const timer = setTimeout(() => {
      api
        .post("/api/broadcasts", { action: "preview", ...audience })
        .then((p) => setPreview(p))
        .catch((err) => setError(err.message || "Couldn't count recipients."))
        .finally(() => setPreviewing(false));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, audienceKey]);

  // Stop the send loop if the component goes away.
  useEffect(() => () => {
    stopRef.current = true;
  }, []);

  const contactMatches = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter((c) => c.email && [c.name, c.email].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [contactSearch, contacts]);
  const pickedContacts = contacts.filter((c) => picked.includes(c.id));

  const payloadBase = () => ({ subject, body, fromName: sender.name, fromEmail: sender.email });

  const sendTest = async () => {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const r = await api.post("/api/broadcasts", { action: "test", to: testTo, ...payloadBase() });
      setNotice(`Test sent to ${r.to}.`);
    } catch (err) {
      setError(err.message || "Couldn't send the test.");
    } finally {
      setBusy("");
    }
  };

  const runSendLoop = async (id) => {
    stopRef.current = false;
    setSendingId(id);
    try {
      for (;;) {
        if (stopRef.current) break;
        const r = await api.post("/api/broadcasts", { action: "send-next", id });
        setProgress(r.broadcast);
        if (!r.handled || r.broadcast.remaining === 0) break;
        await new Promise((res) => setTimeout(res, 600)); // Resend rate limit
      }
    } catch (err) {
      setError(`${err.message || "Sending paused."} It will keep sending in the background within a minute.`);
    } finally {
      setSendingId(null);
      loadHistory();
    }
  };

  const sendBroadcast = async () => {
    if (!preview?.count) return;
    if (!window.confirm(`Send "${subject}" to ${preview.count} contact${preview.count === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBusy("send");
    setError("");
    setNotice("");
    try {
      const created = await api.post("/api/broadcasts", { action: "create", ...audience, ...payloadBase() });
      setProgress({ id: created.id, subject, total: created.total, sent: 0, failed: 0, remaining: created.total, status: "sending" });
      setBusy("");
      await runSendLoop(created.id);
      setNotice("Broadcast finished.");
      setSubject("");
      setBody("");
    } catch (err) {
      setError(err.message || "Couldn't send the broadcast.");
      setBusy("");
    }
  };

  const showFailures = async (b) => {
    try {
      setFailures({ subject: b.subject, rows: await api.get(`/api/broadcasts?failures=${b.id}`) });
    } catch (err) {
      setError(err.message || "Couldn't load failures.");
    }
  };

  if (!active) return null;

  const canSend = preview?.count > 0 && subject.trim() && body.trim() && !busy && !sendingId;
  const pct = progress?.total ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 md:px-8 py-6 border-b border-gray-100">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Megaphone size={20} className="text-gray-400" /> Broadcast
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Email many contacts at once. Each person gets their own copy with an unsubscribe link.
        </p>
      </div>

      <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl">
        {/* Audience */}
        <section className="space-y-5">
          <h2 className="text-base font-bold">1. Who gets it</h2>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">Tags</div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {tags.length === 0 && <span className="text-xs text-gray-400">No tags yet.</span>}
              {tags.map((t) => (
                <Chip key={t} on={selTags.includes(t)} onClick={() => setSelTags((l) => toggle(l, t))}>
                  {t}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">Status (optional — narrows the tags above)</div>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s) => (
                <Chip key={s} on={selStatuses.includes(s)} onClick={() => setSelStatuses((l) => toggle(l, s))}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">Add individual contacts</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:border-gray-400"
              />
            </div>
            {contactMatches.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
                {contactMatches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setPicked((l) => (l.includes(c.id) ? l : [...l, c.id]));
                      setContactSearch("");
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    {c.name} <span className="text-gray-400">· {c.email}</span>
                  </button>
                ))}
              </div>
            )}
            {pickedContacts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {pickedContacts.map((c) => (
                  <span key={c.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                    {c.name}
                    <button type="button" onClick={() => setPicked((l) => l.filter((id) => id !== c.id))} aria-label={`Remove ${c.name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
            {!preview && !previewing && <span className="text-gray-500">Pick tags, statuses or contacts to see who it goes to.</span>}
            {previewing && (
              <span className="text-gray-500 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Counting…
              </span>
            )}
            {preview && !previewing && (
              <>
                <div className="font-semibold">
                  {preview.count} recipient{preview.count === 1 ? "" : "s"}
                </div>
                {(preview.skippedNoEmail > 0 || preview.skippedUnsubscribed > 0) && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    Skipped: {preview.skippedNoEmail} without an email, {preview.skippedUnsubscribed} unsubscribed.
                  </div>
                )}
                {preview.sample?.length > 0 && (
                  <div className="text-xs text-gray-400 mt-1 truncate">
                    e.g. {preview.sample.map((r) => r.name || r.email).join(", ")}
                    {preview.count > preview.sample.length ? "…" : ""}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Message */}
        <section className="space-y-3">
          <h2 className="text-base font-bold">2. The email</h2>
          {senderInfo && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={sender.name}
                onChange={(e) => setSender((s) => ({ ...s, name: e.target.value }))}
                placeholder="From name"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
              />
              <input
                type="email"
                value={sender.email}
                onChange={(e) => setSender((s) => ({ ...s, email: e.target.value }))}
                placeholder={`name@${senderInfo.domain}`}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
              />
            </div>
          )}
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Hi {{first_name}},\n\n…"}
            rows={12}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
          />
          <div className="text-xs text-gray-400">
            Personalise with <code>{"{{first_name}}"}</code> or <code>{"{{name}}"}</code>. An unsubscribe link is added at the bottom.
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center pt-1">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="Test address (blank = your login email)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={!subject.trim() || !body.trim() || !!busy || !!sendingId}
              className="flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40"
            >
              {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send test
            </button>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {notice && (
            <div className="text-sm text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 size={14} /> {notice}
            </div>
          )}

          {progress && (
            <div className="rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium truncate">{progress.subject}</span>
                <span className="text-gray-500 shrink-0 ml-2">
                  {progress.sent} sent{progress.failed ? ` · ${progress.failed} failed` : ""} / {progress.total}
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-gray-900 transition-all" style={{ width: `${pct}%` }} />
              </div>
              {sendingId && <div className="text-xs text-gray-400 mt-1.5">Sending… you can leave this page; it'll finish in the background.</div>}
            </div>
          )}

          <button
            type="button"
            onClick={sendBroadcast}
            disabled={!canSend}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg font-semibold disabled:opacity-40"
          >
            {busy === "send" || sendingId ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />}
            {preview?.count ? `Send to ${preview.count} contact${preview.count === 1 ? "" : "s"}` : "Send broadcast"}
          </button>
        </section>
      </div>

      {/* History */}
      <div className="px-4 md:px-8 pb-10 max-w-6xl">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold">Past broadcasts</h2>
          <button type="button" onClick={loadHistory} className="text-gray-400 hover:text-gray-700" aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">None yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-2.5 font-medium">Subject</th>
                  <th className="px-4 py-2.5 font-medium">From</th>
                  <th className="px-4 py-2.5 font-medium">Sent</th>
                  <th className="px-4 py-2.5 font-medium">Failed</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 font-medium max-w-[260px] truncate">{b.subject}</td>
                    <td className="px-4 py-2.5 text-gray-500">{b.fromEmail}</td>
                    <td className="px-4 py-2.5">
                      {b.sent} / {b.total}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.failed ? (
                        <button type="button" onClick={() => showFailures(b)} className="text-red-600 hover:underline">
                          {b.failed}
                        </button>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{b.status === "done" ? "Done" : `Sending (${b.remaining} left)`}</td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {new Date(b.createdAt).toLocaleString()} {b.createdBy ? `· ${b.createdBy}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {failures && (
          <div className="mt-3 border border-red-100 bg-red-50 rounded-xl p-4 text-sm">
            <div className="flex justify-between mb-2">
              <span className="font-medium">Failed: {failures.subject}</span>
              <button type="button" onClick={() => setFailures(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            {failures.rows.map((r) => (
              <div key={r.email} className="text-xs text-red-700 break-words">
                {r.name ? `${r.name} · ` : ""}
                {r.email} — {r.error}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
