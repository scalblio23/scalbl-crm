import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Paperclip, Search, Send, Upload, Users, X } from "lucide-react";
import { api } from "../lib/api";
import {
  Attachments,
  BATCH_BYTES,
  Linkified,
  MAX_FILE_BYTES,
  VideoEmbeds,
  formatBytes,
  formatDay,
  formatTime,
  initials,
  isImage,
  readAsBase64,
  shrinkImage,
} from "./CsmPanel";

// Same base-URL convention as lib/api.js — attached files load straight
// into <img>/<a> tags.
const API_BASE = import.meta.env.VITE_CALL_SERVER_URL || "";
const memoFileUrl = (id, { download = false } = {}) =>
  `${API_BASE}/api/memo?fileId=${id}${download ? "&download=1" : ""}`;

// Newest saved message id (pending ones aren't saved yet).
function lastSavedId(list) {
  let max = 0;
  for (const m of list) if (!m.pending && typeof m.id === "number" && m.id > max) max = m.id;
  return max;
}

// Adds fetched messages to a chat, keeping anything still sending.
function mergeMessages(prev, fetched) {
  if (!fetched.length) return prev;
  const byId = new Map(prev.filter((m) => !m.pending).map((m) => [m.id, m]));
  for (const m of fetched) byId.set(m.id, m);
  const saved = [...byId.values()].sort((a, b) => a.id - b.id);
  return [...saved, ...prev.filter((m) => m.pending)];
}

function preview(c) {
  const m = c.lastMessage;
  if (!m) return c.kind === "team" ? "Everyone on the team" : "No messages yet";
  const body = m.text || (m.files ? `📎 ${m.files} file${m.files === 1 ? "" : "s"}` : "");
  const who = m.fromMe ? "You" : c.kind === "team" ? m.author : "";
  return who ? `${who}: ${body}` : body;
}

// Inbox / Memo — chats between team members (admins and setters, never
// clients): a "Team" chat for everyone plus a private chat with each
// teammate. Same layout as the CSM tab, minus the client scoring.
export default function MemoPanel({ currentUserId = null, active = true, onUnreadChange = () => {} }) {
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedKey, setSelectedKey] = useState("team");
  const [chats, setChats] = useState({}); // { [convKey]: messages }
  const [loadingChat, setLoadingChat] = useState(false);
  const [search, setSearch] = useState("");
  // Phone width shows one pane at a time: the chat list, or the open chat.
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [preparingFiles, setPreparingFiles] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const endRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const selected = conversations.find((c) => c.key === selectedKey) || null;
  const messages = useMemo(() => chats[selectedKey] || [], [chats, selectedKey]);
  const unreadTotal = conversations.reduce((n, c) => n + (c.unread || 0), 0);

  useEffect(() => {
    onUnreadChange(unreadTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadTotal]);

  // ---------- loading ----------
  const loadList = () =>
    api.get("/api/memo").then(({ conversations: list }) => {
      if (list) setConversations(list);
    });

  const inFlight = useRef(new Map());
  const refreshChat = (key) => {
    if (inFlight.current.has(key)) return inFlight.current.get(key);
    const have = chatsRef.current[key];
    const after = have ? lastSavedId(have) : 0;
    const request = api
      .get(`/api/memo?conv=${encodeURIComponent(key)}${after ? `&after=${after}` : ""}`)
      .then(({ messages: list }) =>
        setChats((c) => {
          const next = have ? mergeMessages(c[key] || [], list || []) : [...(list || []), ...(c[key] || []).filter((m) => m.pending)];
          return next === c[key] ? c : { ...c, [key]: next };
        })
      )
      .finally(() => inFlight.current.delete(key));
    inFlight.current.set(key, request);
    return request;
  };

  useEffect(() => {
    loadList()
      .catch((err) => setError(err.message || "Could not load your chats."))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    if (!selectedKey) return;
    setLoadingChat(!chatsRef.current[selectedKey]);
    refreshChat(selectedKey)
      .catch((err) => setError(err.message || "Could not load the chat."))
      .finally(() => setLoadingChat(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // While showing: the open chat every 4s, the chat list every 12s.
  useEffect(() => {
    const visible = () => activeRef.current && document.visibilityState !== "hidden";
    const chatTimer = setInterval(() => {
      if (visible() && selectedKey) refreshChat(selectedKey).catch(() => {});
    }, 4000);
    const listTimer = setInterval(() => {
      if (visible()) loadList().catch(() => {});
    }, 12000);
    return () => {
      clearInterval(chatTimer);
      clearInterval(listTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Back on this tab: catch up straight away.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      loadList().catch(() => {});
      if (selectedKey) refreshChat(selectedKey).catch(() => {});
    }
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Looking at a chat means you've read it.
  const selectedUnread = selected?.unread || 0;
  useEffect(() => {
    if (!active || !selectedKey || !selectedUnread || document.visibilityState === "hidden") return;
    setConversations((list) => list.map((c) => (c.key === selectedKey ? { ...c, unread: 0 } : c)));
    api.post("/api/memo", { action: "mark-read", conv: selectedKey }).catch(() => {});
  }, [active, selectedKey, selectedUnread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selectedKey]);

  // ---------- list ----------
  const visibleConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const team = conversations.filter((c) => c.kind === "team");
    const people = conversations
      .filter((c) => c.kind !== "team" && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => {
        const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
        const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
        return tb - ta || a.name.localeCompare(b.name);
      });
    return [...(q && !"team".includes(q) ? [] : team), ...people];
  }, [conversations, search]);

  // ---------- sending ----------
  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError("");
    setPreparingFiles((n) => n + files.length);
    for (const original of files) {
      try {
        const file = isImage(original.type) ? await shrinkImage(original) : original;
        if (file.size > MAX_FILE_BYTES) {
          setError(`${original.name} is too big (${formatBytes(file.size)}) — files can be up to 3 MB.`);
          continue;
        }
        const data = await readAsBase64(file);
        setAttachments((list) => [
          ...list,
          {
            key: `${Date.now()}-${Math.random()}`,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            data,
            previewUrl: isImage(file.type) ? URL.createObjectURL(file) : null,
          },
        ]);
      } catch (err) {
        setError(err.message || `Couldn't attach ${original.name}.`);
      } finally {
        setPreparingFiles((n) => n - 1);
      }
    }
  };

  const removeAttachment = (key) =>
    setAttachments((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((a) => a.key !== key);
    });

  const send = () => {
    const body = text.trim();
    const conv = selectedKey;
    if ((!body && !attachments.length) || !conv || preparingFiles) return;
    // Files too big for one request go as several messages; the text
    // goes with the first.
    const batches = [];
    for (const a of attachments) {
      const last = batches[batches.length - 1];
      if (last && last.size + a.size <= BATCH_BYTES) {
        last.files.push(a);
        last.size += a.size;
      } else batches.push({ files: [a], size: a.size });
    }
    if (!batches.length) batches.push({ files: [], size: 0 });
    setText("");
    setAttachments([]);
    setError("");
    batches.forEach(async (batch, i) => {
      const batchText = i === 0 ? body : "";
      const tempId = `pending-${Date.now()}-${i}`;
      const pending = {
        id: tempId,
        pending: true,
        senderId: currentUserId,
        author: "You",
        text: batchText,
        createdAt: new Date().toISOString(),
        files: batch.files.map((a) => ({ id: a.key, name: a.name, mimeType: a.mimeType, size: a.size, localUrl: a.previewUrl })),
      };
      setChats((c) => ({ ...c, [conv]: [...(c[conv] || []), pending] }));
      try {
        const { message } = await api.post("/api/memo", {
          action: "send",
          conv,
          text: batchText,
          files: batch.files.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
        });
        setChats((c) => ({
          ...c,
          [conv]: (c[conv] || []).filter((m) => m.id !== message.id).map((m) => (m.id === tempId ? message : m)),
        }));
        batch.files.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
        setConversations((list) =>
          list.map((c) =>
            c.key === conv
              ? { ...c, lastMessage: { text: message.text, author: message.author, fromMe: true, files: message.files.length, createdAt: message.createdAt } }
              : c
          )
        );
      } catch (err) {
        setChats((c) => ({ ...c, [conv]: (c[conv] || []).filter((m) => m.id !== tempId) }));
        if (batchText) setText((current) => current || batchText);
        setAttachments((list) => [...batch.files, ...list]);
        setError(err.message || "Could not send the message.");
      }
    });
  };

  // Messages grouped by day.
  const days = useMemo(() => {
    const groups = [];
    for (const m of messages) {
      const label = formatDay(m.createdAt);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(m);
    }
    return groups;
  }, [messages]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Chats */}
      <aside
        className={`w-full md:w-72 shrink-0 border-r border-gray-100 flex-col min-h-0 bg-gray-50/50 ${
          mobileChatOpen ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="px-4 pt-5 pb-3">
          <h1 className="text-xl font-bold">Inbox</h1>
          <div className="text-xs text-gray-400 mt-0.5">Team chats — admins and setters only</div>
          <div className="mt-3 relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people"
              className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm outline-none focus:border-gray-400 bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loadingList && (
            <div className="flex items-center gap-2 text-sm text-gray-400 px-3 py-4">
              <Loader2 size={14} className="animate-spin" /> Loading chats…
            </div>
          )}
          {!loadingList && !visibleConversations.length && (
            <div className="text-sm text-gray-400 px-3 py-4">{search ? "No one matches." : "No teammates yet."}</div>
          )}
          {visibleConversations.map((c) => {
            const on = c.key === selectedKey;
            return (
              <button
                key={c.key}
                onClick={() => {
                  setSelectedKey(c.key);
                  setMobileChatOpen(true);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left mb-0.5 ${
                  on ? "bg-white shadow-sm border border-gray-200" : "hover:bg-white border border-transparent"
                }`}
              >
                <span
                  className={`w-8 h-8 shrink-0 rounded-full text-xs font-semibold flex items-center justify-center ${
                    c.kind === "team" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {c.kind === "team" ? <Users size={14} /> : initials(c.name)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className={`flex-1 truncate text-sm text-gray-900 ${c.unread ? "font-bold" : "font-medium"}`}>{c.name}</span>
                    {c.lastMessage && (
                      <span className="shrink-0 text-[11px] text-gray-400">
                        {formatDay(c.lastMessage.createdAt) === "Today"
                          ? formatTime(c.lastMessage.createdAt)
                          : formatDay(c.lastMessage.createdAt).replace(/, \d{4}$/, "").replace(/ \d{4}$/, "")}
                      </span>
                    )}
                  </span>
                  <span className={`block text-xs truncate ${c.unread ? "text-gray-700" : "text-gray-400"}`}>{preview(c)}</span>
                </span>
                {c.unread > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                    {c.unread > 99 ? "99+" : c.unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chat */}
      <section
        className={`flex-1 flex-col min-w-0 min-h-0 relative ${mobileChatOpen ? "flex" : "hidden md:flex"}`}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setDragActive(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer?.files?.length) return;
          e.preventDefault();
          setDragActive(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {dragActive && (
          <div className="absolute inset-0 z-20 bg-white/80 border-2 border-dashed border-gray-400 rounded-xl m-3 flex items-center justify-center text-sm font-medium text-gray-600 pointer-events-none">
            <Upload size={18} className="mr-2" /> Drop files to attach them
          </div>
        )}
        {error && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            {loadingList ? "" : "Pick a chat on the left."}
          </div>
        ) : (
          <>
            <header className="px-4 md:px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <button
                onClick={() => setMobileChatOpen(false)}
                aria-label="Back to chats"
                className="md:hidden -ml-1 p-1 rounded text-gray-500 hover:bg-gray-100"
              >
                <ArrowLeft size={18} />
              </button>
              <span
                className={`w-9 h-9 shrink-0 rounded-full text-xs font-semibold flex items-center justify-center ${
                  selected.kind === "team" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                }`}
              >
                {selected.kind === "team" ? <Users size={15} /> : initials(selected.name)}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold truncate">{selected.name}</h2>
                <div className="text-xs text-gray-400">
                  {selected.kind === "team" ? "Everyone on the team sees this chat" : `Private — only you and ${selected.name}`}
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
              {loadingChat ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : !messages.length ? (
                <div className="text-sm text-gray-400 text-center mt-10">
                  {selected.kind === "team" ? "No messages yet — say hi to the team." : `No messages with ${selected.name} yet.`}
                </div>
              ) : (
                <ol className="relative border-l border-gray-200 ml-2">
                  {days.map((day) => (
                    <li key={day.label} className="mb-2">
                      <div className="-ml-2 mb-3 inline-block bg-white pr-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {day.label}
                      </div>
                      {day.items.map((m) => {
                        const mine = m.senderId === currentUserId;
                        return (
                          <div key={m.id} className={`relative pl-6 mb-4 ${m.pending ? "opacity-60" : ""}`}>
                            <span
                              className={`absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full ring-4 ring-white ${
                                mine ? "bg-blue-500" : "bg-gray-900"
                              }`}
                            />
                            <div
                              className={`border rounded-xl px-4 py-3 shadow-sm max-w-3xl ${
                                mine ? "bg-blue-50/60 border-blue-100" : "bg-white border-gray-200"
                              }`}
                            >
                              <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-sm font-semibold text-gray-900">{mine ? "You" : m.author || "Someone"}</span>
                                <span className="text-xs text-gray-400">{formatTime(m.createdAt)}</span>
                                {m.via === "api" && (
                                  <span
                                    title="Sent on your behalf through the CRM's API key (e.g. by Hermes)"
                                    className="text-[10px] font-medium uppercase tracking-wide text-gray-400 border border-gray-200 rounded px-1"
                                  >
                                    via API
                                  </span>
                                )}
                              </div>
                              {m.text && (
                                <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                                  <Linkified text={m.text} />
                                </div>
                              )}
                              {m.text && <VideoEmbeds text={m.text} />}
                              {m.files?.length > 0 && <Attachments files={m.files} urlFor={memoFileUrl} />}
                            </div>
                          </div>
                        );
                      })}
                    </li>
                  ))}
                </ol>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-gray-100 px-4 md:px-6 py-4">
              {(attachments.length > 0 || preparingFiles > 0) && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <div key={a.key} className="relative group border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                      {a.previewUrl ? (
                        <img src={a.previewUrl} alt={a.name} className="h-16 w-16 object-cover" />
                      ) : (
                        <div className="h-16 px-3 flex flex-col justify-center max-w-[180px]">
                          <span className="text-xs font-medium text-gray-700 truncate">{a.name}</span>
                          <span className="text-[11px] text-gray-400">{formatBytes(a.size)}</span>
                        </div>
                      )}
                      <button
                        onClick={() => removeAttachment(a.key)}
                        title="Remove"
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  {preparingFiles > 0 && (
                    <div className="h-16 px-3 flex items-center gap-2 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
                      <Loader2 size={13} className="animate-spin" /> Preparing…
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files or pictures (or drag them in, or paste a screenshot)"
                  className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400"
                >
                  <Paperclip size={16} />
                </button>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData?.files || []);
                    if (!files.length) return;
                    e.preventDefault();
                    addFiles(files);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder={`Message ${selected.kind === "team" ? "the team" : selected.name}… (Enter to send, Shift+Enter for a new line)`}
                  className="flex-1 min-w-0 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-400"
                />
                <button
                  onClick={send}
                  disabled={(!text.trim() && !attachments.length) || preparingFiles > 0}
                  className="h-10 flex items-center gap-1.5 bg-gray-900 hover:bg-black text-white text-sm font-semibold rounded-xl px-4 disabled:opacity-40"
                >
                  <Send size={15} /> Send
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
