import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Lock,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../lib/api";

// Same base-URL convention as lib/api.js — attached files are loaded
// straight into <img>/<a> tags, which don't go through api.get.
const API_BASE = import.meta.env.VITE_CALL_SERVER_URL || "";
const fileUrl = (id, { download = false } = {}) => `${API_BASE}/api/csm?fileId=${id}${download ? "&download=1" : ""}`;

// ---------- attachments ----------
// Kept under the server's 3MB-per-comment cap: pictures are shrunk in
// the browser, and a batch that's too big for one comment goes out as
// several.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const BATCH_BYTES = 2.8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1920;

const isImage = (mimeType) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(mimeType || "");

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Photos straight off a phone are several MB; resize anything large
// to at most 1920px on its longest side as a JPEG. GIFs are left alone
// (they'd lose their animation).
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// ---------- client list sorting ----------
const SORTS = [
  { key: "name", label: "Name (A–Z)" },
  { key: "confidence-asc", label: "Confidence — lowest first" },
  { key: "confidence-desc", label: "Confidence — highest first" },
  { key: "mood", label: "Mood — unhappiest first" },
  { key: "recent", label: "Recent activity" },
];
const MOOD_RANK = { frustrated: 0, concerned: 1, neutral: 2, satisfied: 3, happy: 4 };
const SORT_STORAGE_KEY = "csm.clientSort";

// Clients with nothing set for the sorted field go to the bottom;
// ties fall back to name.
function sortClients(list, key) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const nullsLast = (get, dir) => (a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === null && vb === null) return byName(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * dir || byName(a, b);
  };
  const sorted = [...list];
  if (key === "confidence-asc") sorted.sort(nullsLast((c) => c.confidence, 1));
  else if (key === "confidence-desc") sorted.sort(nullsLast((c) => c.confidence, -1));
  else if (key === "mood") sorted.sort(nullsLast((c) => (c.mood in MOOD_RANK ? MOOD_RANK[c.mood] : null), 1));
  else if (key === "recent")
    sorted.sort(nullsLast((c) => (c.lastActivityAt ? new Date(c.lastActivityAt).getTime() : null), -1));
  else sorted.sort(byName);
  return sorted;
}

// CSM tab — client success. Left: every client, with its retention
// confidence and mood at a glance. Right: the selected client's
// timeline (comments, plus a line for each confidence / mood change),
// with the confidence and mood controls above it and a comment box
// at the bottom. Backed by api/csm.js.
//
// WhatsApp: the team's WhatsApp is linked once by QR code (the service
// on the voice server — see server/whatsappGateway.js, reached through
// api/whatsapp.js). Each client can then be linked to a chat or group
// from the header; its messages arrive in this timeline as entries of
// kind "whatsapp" (value "in" | "out", author = sender), and the box at
// the bottom switches between an internal comment and a WhatsApp reply.
// Before a client is linked, "Show example messages" previews the look.

const WHATSAPP_GREEN = "#25D366";

function WhatsAppIcon({ size = 14 }) {
  return <MessageCircle size={size} style={{ color: WHATSAPP_GREEN }} fill={WHATSAPP_GREEN} fillOpacity={0.15} />;
}

// Sample conversation for the preview — never saved.
function exampleWhatsAppEntries(client) {
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const lines = [
    [95, "in", client.name, "Morning! Quick one — how many appointments got booked this week?"],
    [90, "out", "You", "Morning! 14 so far, 3 more pencilled in for Thursday. I'll send the full report this afternoon."],
    [88, "in", client.name, "Great. The two from Tuesday didn't show though 😕"],
    [80, "out", "You", "Thanks for flagging — we'll add an SMS reminder the morning of each appointment from tomorrow."],
    [12, "in", client.name, "Perfect, thanks team 👍"],
  ];
  return lines.map(([minutesAgo, dir, author, text], i) => ({
    id: `example-${client.id}-${i}`,
    clientId: client.id,
    kind: "whatsapp",
    value: dir,
    author,
    text,
    createdAt: at(minutesAgo),
    example: true,
  }));
}

const TIMELINE_FILTERS = [
  { key: "all", label: "All" },
  { key: "comments", label: "Comments & updates" },
  { key: "whatsapp", label: "WhatsApp" },
];

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

export default function CsmPanel({ canManageWhatsApp = false }) {
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [search, setSearch] = useState("");
  const [comment, setComment] = useState("");
  // Files waiting to go with the next comment: { key, name, mimeType,
  // size, data (base64), previewUrl }.
  const [attachments, setAttachments] = useState([]);
  const [preparingFiles, setPreparingFiles] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const [sortKey, setSortKey] = useState(() => {
    try {
      const saved = localStorage.getItem(SORT_STORAGE_KEY);
      return SORTS.some((s) => s.key === saved) ? saved : "name";
    } catch {
      return "name";
    }
  });
  const [newClientName, setNewClientName] = useState("");
  const [addingClient, setAddingClient] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [error, setError] = useState("");
  const [composeMode, setComposeMode] = useState("comment"); // comment | whatsapp
  const [timelineFilter, setTimelineFilter] = useState("all");
  const [showExample, setShowExample] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [waStatus, setWaStatus] = useState(null); // { state, qr, me, error }
  const [waChats, setWaChats] = useState(null);
  const [waChatSearch, setWaChatSearch] = useState("");
  const [waBusy, setWaBusy] = useState(false);
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
    setWaOpen(false);
    api
      .get(`/api/csm?clientId=${selectedId}`)
      .then(({ entries: list }) => !cancelled && setEntries(list || []))
      .catch((err) => !cancelled && setError(err.message || "Could not load the timeline."))
      .finally(() => !cancelled && setLoadingEntries(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // WhatsApp connection status — every 3s while the WhatsApp panel is
  // open (so a scanned QR code turns into "Connected" quickly), every
  // 30s otherwise.
  useEffect(() => {
    let cancelled = false;
    let timer;
    const tick = async () => {
      try {
        const s = await api.get("/api/whatsapp?op=status");
        if (!cancelled) setWaStatus(s);
      } catch (err) {
        if (!cancelled) setWaStatus({ state: "unreachable", error: err.message });
      }
      if (!cancelled) timer = setTimeout(tick, waOpen ? 3000 : 30000);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waOpen]);

  const waConnected = waStatus?.state === "connected";

  // The chat list, fetched fresh each time the panel opens while connected.
  useEffect(() => {
    if (!waOpen || !waConnected || !canManageWhatsApp) return undefined;
    let cancelled = false;
    setWaChatSearch("");
    api
      .get("/api/whatsapp?op=chats")
      .then(({ chats }) => !cancelled && setWaChats(chats || []))
      .catch((err) => !cancelled && setError(err.message || "Could not load WhatsApp chats."));
    return () => {
      cancelled = true;
    };
  }, [waOpen, waConnected, canManageWhatsApp]);

  // A client linked to WhatsApp: check for new messages every 5s.
  const selectedChatId = clients.find((c) => c.id === selectedId)?.whatsappChatId || null;
  useEffect(() => {
    if (!selectedId || !selectedChatId) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { entries: list } = await api.get(`/api/csm?clientId=${selectedId}`);
        if (cancelled || !list) return;
        setEntries((prev) => {
          // Keep anything still saving, unless the saved copy has arrived.
          const pending = prev.filter((e) => e.pending && !(e.waId && list.some((x) => x.waId === e.waId)));
          if (!pending.length && prev.length === list.length && prev.every((e, i) => e.id === list[i].id)) return prev;
          return [...list, ...pending];
        });
      } catch {
        // try again next tick
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId, selectedChatId]);

  // Keep the newest entry in view, next to the comment box.
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: "end" });
  }, [entries, showExample, timelineFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, sortKey);
    } catch {
      // private mode / storage blocked — the sort just isn't remembered
    }
  }, [sortKey]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
    return sortClients(matching, sortKey);
  }, [clients, search, sortKey]);

  const visibleEntries = useMemo(() => {
    let list = entries;
    if (showExample && selected && !selected.whatsappChatId) {
      list = [...entries, ...exampleWhatsAppEntries(selected)].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
    }
    if (timelineFilter === "whatsapp") return list.filter((e) => e.kind === "whatsapp");
    if (timelineFilter === "comments") return list.filter((e) => e.kind !== "whatsapp");
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, showExample, timelineFilter, selected?.id, selected?.whatsappChatId]);

  // Entries grouped by day, oldest first.
  const days = useMemo(() => {
    const groups = [];
    for (const e of visibleEntries) {
      const label = formatDay(e.createdAt);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    return groups;
  }, [visibleEntries]);

  // Confidence, mood and comments update the screen straight away and
  // save in the background (the round trip can take a second or two);
  // a failed save puts things back and says why. For rapid changes to
  // the same field, only the newest request's response is allowed to
  // overwrite the client, so an older reply can't flip it back.
  const latestRequest = useRef({});

  const saveInBackground = async ({ client, field, value, body, entry, errorMessage, onFail, onSaved }) => {
    const key = `${client.id}:${field}`;
    const seq = (latestRequest.current[key] || 0) + 1;
    latestRequest.current[key] = seq;
    const previous = client[field];
    const tempId = `pending-${key}-${seq}-${Date.now()}`;
    const now = new Date().toISOString();
    setError("");
    if (field !== "comment") {
      setClients((list) => list.map((c) => (c.id === client.id ? { ...c, [field]: value, lastActivityAt: now } : c)));
    }
    setEntries((list) => [...list, { ...entry, id: tempId, clientId: client.id, createdAt: now, pending: true }]);
    try {
      const result = await api.post("/api/csm", body);
      // (The 5s WhatsApp poll may already have brought the saved copy in.)
      setEntries((list) => list.filter((e) => e.id !== result.entry.id).map((e) => (e.id === tempId ? result.entry : e)));
      onSaved?.();
      if (latestRequest.current[key] === seq && result.client) {
        setClients((list) => list.map((c) => (c.id === result.client.id ? result.client : c)));
      }
    } catch (err) {
      setEntries((list) => list.filter((e) => e.id !== tempId));
      if (field !== "comment" && latestRequest.current[key] === seq) {
        setClients((list) => list.map((c) => (c.id === client.id ? { ...c, [field]: previous } : c)));
      }
      onFail?.();
      setError(err.message || errorMessage);
    }
  };

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

  const sendComment = () => {
    const text = comment.trim();
    if ((!text && !attachments.length) || !selected || preparingFiles) return;
    // Split the files into comments small enough for the server; the
    // text goes with the first one.
    const batches = [];
    for (const a of attachments) {
      const last = batches[batches.length - 1];
      if (last && last.size + a.size <= BATCH_BYTES) {
        last.files.push(a);
        last.size += a.size;
      } else batches.push({ files: [a], size: a.size });
    }
    if (!batches.length) batches.push({ files: [], size: 0 });
    setComment("");
    setAttachments([]);
    batches.forEach((batch, i) => {
      const batchText = i === 0 ? text : "";
      saveInBackground({
        client: selected,
        field: "comment",
        body: {
          action: "comment",
          clientId: selected.id,
          text: batchText,
          files: batch.files.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
        },
        entry: {
          kind: "comment",
          text: batchText,
          author: "You",
          files: batch.files.map((a) => ({ id: a.key, name: a.name, mimeType: a.mimeType, size: a.size, localUrl: a.previewUrl })),
        },
        errorMessage: "Could not add the comment.",
        onSaved: () => batch.files.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl)),
        // Put the text and files back so nothing is lost.
        onFail: () => {
          if (batchText) setComment((current) => current || batchText);
          setAttachments((list) => [...batch.files, ...list]);
        },
      });
    });
  };

  // ---------- WhatsApp ----------

  const linkWhatsApp = async (chat) => {
    if (!selected) return;
    setWaBusy(true);
    setError("");
    try {
      const result = await api.post("/api/csm", {
        action: "link-whatsapp",
        clientId: selected.id,
        chatId: chat?.id || null,
        chatName: chat?.name || "",
      });
      setClients((list) => list.map((c) => (c.id === result.client.id ? result.client : c)));
      // Reload: linking pulls in the chat's recent messages.
      const { entries: list } = await api.get(`/api/csm?clientId=${selected.id}`);
      setEntries(list || []);
      setWaOpen(false);
      setShowExample(false);
      if (chat) setComposeMode("whatsapp");
    } catch (err) {
      setError(err.message || "Could not link the WhatsApp chat.");
    } finally {
      setWaBusy(false);
    }
  };

  const disconnectWhatsApp = async () => {
    if (!window.confirm("Disconnect the team WhatsApp from the CRM? You'll need to scan the QR code again to reconnect.")) return;
    setWaBusy(true);
    try {
      await api.post("/api/whatsapp", { op: "logout" });
      setWaChats(null);
      setWaStatus((s) => ({ ...(s || {}), state: "connecting", me: null }));
    } catch (err) {
      setError(err.message || "Could not disconnect WhatsApp.");
    } finally {
      setWaBusy(false);
    }
  };

  const sendWhatsApp = async () => {
    const text = comment.trim();
    if (!text || !selected?.whatsappChatId || !waConnected) return;
    const clientId = selected.id;
    const tempId = `pending-wa-${Date.now()}`;
    setComment("");
    setError("");
    setEntries((list) => [
      ...list,
      { id: tempId, clientId, kind: "whatsapp", value: "out", author: "You", text, createdAt: new Date().toISOString(), pending: true },
    ]);
    try {
      const { messageId } = await api.post("/api/whatsapp", { op: "send", clientId, text });
      setEntries((list) =>
        list.some((e) => e.waId === messageId && !e.pending)
          ? list.filter((e) => e.id !== tempId)
          : list.map((e) => (e.id === tempId ? { ...e, waId: messageId } : e))
      );
    } catch (err) {
      setEntries((list) => list.filter((e) => e.id !== tempId));
      setComment((current) => current || text);
      setError(err.message || "Could not send the WhatsApp message.");
    }
  };

  const setConfidence = (value) => {
    if (!selected || selected.confidence === value) return;
    saveInBackground({
      client: selected,
      field: "confidence",
      value,
      body: { action: "confidence", clientId: selected.id, value },
      entry: { kind: "confidence", value: value.toFixed(1), author: "You" },
      errorMessage: "Could not update confidence.",
    });
  };

  const setMood = (mood) => {
    setMoodOpen(false);
    if (!selected || selected.mood === mood) return;
    saveInBackground({
      client: selected,
      field: "mood",
      value: mood,
      body: { action: "mood", clientId: selected.id, mood },
      entry: { kind: "mood", value: mood, author: "You" },
      errorMessage: "Could not update the mood.",
    });
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
          <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            Sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 bg-white outline-none focus:border-gray-400"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
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
      <section
        className="relative flex-1 flex flex-col min-w-0 min-h-0"
        onDragOver={(e) => {
          if (!selected || !Array.from(e.dataTransfer?.types || []).includes("Files")) return;
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false);
        }}
        onDrop={(e) => {
          if (!selected) return;
          e.preventDefault();
          setDragActive(false);
          setComposeMode("comment");
          addFiles(e.dataTransfer?.files);
        }}
      >
        {dragActive && (
          <div className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-gray-400 bg-white/90 flex flex-col items-center justify-center gap-2 text-gray-600 pointer-events-none">
            <Upload size={28} />
            <div className="text-sm font-semibold">Drop files or pictures to attach them</div>
            <div className="text-xs text-gray-400">Up to 3 MB each — big photos are shrunk automatically</div>
          </div>
        )}
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
                <div className="relative mt-1.5">
                  <button
                    onClick={() => setWaOpen((o) => !o)}
                    className={`h-7 max-w-[280px] flex items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${
                      selected.whatsappChatId
                        ? "bg-green-50 text-green-800 border-green-200 hover:border-green-400"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <WhatsAppIcon size={13} />
                    {selected.whatsappChatId && <Lock size={11} className="shrink-0" aria-label="Locked" />}
                    <span className="truncate">
                      {selected.whatsappChatId ? `WhatsApp: ${selected.whatsappChatName || "linked"}` : "WhatsApp: not linked"}
                    </span>
                    {selected.whatsappChatId && waStatus && !waConnected && (
                      <span className="text-amber-600 shrink-0">· offline</span>
                    )}
                    <ChevronDown size={13} className="shrink-0" />
                  </button>
                  {waOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setWaOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-50 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-3">
                        <WhatsAppPanel
                          canManage={canManageWhatsApp}
                          client={selected}
                          status={waStatus}
                          chats={waChats}
                          search={waChatSearch}
                          onSearch={setWaChatSearch}
                          busy={waBusy}
                          onLink={linkWhatsApp}
                          onDisconnect={disconnectWhatsApp}
                          showExample={showExample}
                          onToggleExample={() => {
                            setShowExample((v) => !v);
                            setWaOpen(false);
                          }}
                        />
                      </div>
                    </>
                  )}
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

            {/* Timeline filters */}
            <div className="px-6 pt-3 flex items-center gap-1.5 flex-wrap">
              {TIMELINE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTimelineFilter(f.key)}
                  className={`flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1 border ${
                    timelineFilter === f.key
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {f.key === "whatsapp" && <WhatsAppIcon size={12} />} {f.label}
                </button>
              ))}
              {showExample && (
                <span className="ml-auto flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                  Showing example WhatsApp messages — not real, nothing is saved.
                  <button onClick={() => setShowExample(false)} className="font-semibold underline">
                    Hide
                  </button>
                </span>
              )}
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loadingEntries ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Loading timeline…
                </div>
              ) : !visibleEntries.length ? (
                timelineFilter === "whatsapp" ? (
                  <div className="text-sm text-gray-400 text-center mt-10">
                    <div className="flex justify-center mb-2">
                      <WhatsAppIcon size={28} />
                    </div>
                    {selected.whatsappChatId ? (
                      <>No WhatsApp messages with {selected.name} yet.</>
                    ) : (
                      <>
                        {canManageWhatsApp
                          ? `${selected.name} doesn't have a WhatsApp chat assigned yet — use the WhatsApp button under their name.`
                          : `${selected.name} doesn't have a WhatsApp chat assigned yet — a super admin can assign one.`}
                        <div className="mt-2">
                          <button onClick={() => setShowExample(true)} className="text-gray-700 font-medium underline">
                            Show example messages
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 text-center mt-10">
                    Nothing here yet. Add the first comment below, or set a confidence and mood.
                  </div>
                )
              ) : (
                <ol className="relative border-l border-gray-200 ml-2">
                  {days.map((day) => (
                    <li key={day.label} className="mb-2">
                      <div className="-ml-2 mb-3 inline-block bg-white pr-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {day.label}
                      </div>
                      {day.items.map((e) => (
                        // Faded until the server has saved it.
                        <div key={e.id} className={e.pending ? "opacity-60" : ""}>
                          <TimelineItem entry={e} />
                        </div>
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
              <div className="flex items-center gap-1 mb-2">
                <button
                  onClick={() => setComposeMode("comment")}
                  className={`text-xs font-medium rounded-full px-3 py-1 border ${
                    composeMode === "comment"
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  Internal comment
                </button>
                <button
                  onClick={() => setComposeMode("whatsapp")}
                  className={`flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1 border ${
                    composeMode === "whatsapp"
                      ? "bg-green-50 text-green-800 border-green-300"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <WhatsAppIcon size={12} /> WhatsApp
                </button>
                <span className="text-xs text-gray-400 ml-2">
                  {composeMode === "comment"
                    ? "Only your team sees comments."
                    : !selected.whatsappChatId
                    ? canManageWhatsApp
                      ? "Assign this client a WhatsApp chat first (the WhatsApp button under their name)."
                      : "No WhatsApp chat is assigned to this client yet — a super admin can assign one."
                    : !waConnected
                    ? "The team WhatsApp is offline — reconnect it from the WhatsApp button to send."
                    : `Sends to "${selected.whatsappChatName || "their chat"}" from the team WhatsApp.`}
                </span>
              </div>
              {composeMode === "comment" && (attachments.length > 0 || preparingFiles > 0) && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((a) => (
                    <div
                      key={a.key}
                      className="relative group border border-gray-200 rounded-lg bg-white overflow-hidden"
                      title={`${a.name} · ${formatBytes(a.size)}`}
                    >
                      {a.previewUrl ? (
                        <img src={a.previewUrl} alt={a.name} className="h-16 w-16 object-cover" />
                      ) : (
                        <div className="h-16 w-44 flex items-center gap-2 px-2.5">
                          <FileText size={20} className="text-gray-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-gray-700 truncate">{a.name}</div>
                            <div className="text-[11px] text-gray-400">{formatBytes(a.size)}</div>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => removeAttachment(a.key)}
                        title="Remove"
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-gray-900/70 text-white flex items-center justify-center hover:bg-gray-900"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {preparingFiles > 0 && (
                    <div className="h-16 px-3 flex items-center gap-2 text-xs text-gray-500 border border-dashed border-gray-200 rounded-lg">
                      <Loader2 size={14} className="animate-spin" /> Preparing…
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-end gap-2">
                {composeMode === "comment" && (
                  <>
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
                  </>
                )}
                <textarea
                  value={comment}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData?.files || []);
                    if (composeMode !== "comment" || !files.length) return;
                    e.preventDefault();
                    addFiles(files);
                  }}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (composeMode === "comment") sendComment();
                      else sendWhatsApp();
                    }
                  }}
                  rows={2}
                  placeholder={
                    composeMode === "comment"
                      ? `Add a comment about ${selected.name}… (Enter to send, Shift+Enter for a new line)`
                      : `Message ${selected.name} on WhatsApp…`
                  }
                  className={`flex-1 resize-none border rounded-xl px-3 py-2 text-sm outline-none ${
                    composeMode === "whatsapp"
                      ? "border-green-200 focus:border-green-400 bg-green-50/30"
                      : "border-gray-200 focus:border-gray-400"
                  }`}
                />
                {composeMode === "comment" ? (
                  <button
                    onClick={sendComment}
                    disabled={(!comment.trim() && !attachments.length) || preparingFiles > 0}
                    className="h-10 flex items-center gap-1.5 bg-gray-900 hover:bg-black text-white text-sm font-semibold rounded-xl px-4 disabled:opacity-40"
                  >
                    <Send size={15} /> Send
                  </button>
                ) : (
                  <button
                    onClick={sendWhatsApp}
                    disabled={!comment.trim() || !selected.whatsappChatId || !waConnected}
                    style={{ backgroundColor: WHATSAPP_GREEN }}
                    className="h-10 flex items-center gap-1.5 text-white text-sm font-semibold rounded-xl px-4 hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={15} /> Send
                  </button>
                )}
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
  if (entry.kind === "whatsapp") {
    const out = entry.value === "out";
    return (
      <div className={`relative pl-6 mb-3 flex ${out ? "justify-end" : ""}`}>
        <span
          className="absolute -left-[5px] top-3 w-2.5 h-2.5 rounded-full ring-4 ring-white"
          style={{ backgroundColor: WHATSAPP_GREEN }}
        />
        <div
          className={`max-w-xl rounded-2xl px-3.5 py-2 shadow-sm border ${
            out ? "bg-[#d9fdd3] border-[#c3eebb] rounded-br-md" : "bg-white border-gray-200 rounded-bl-md"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <WhatsAppIcon size={12} />
            <span className="text-xs font-semibold text-gray-800">{entry.author || (out ? "You" : "Client")}</span>
            {entry.example && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1">
                Example
              </span>
            )}
          </div>
          {entry.text && <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{entry.text}</div>}
          {entry.files?.length > 0 && <Attachments files={entry.files} />}
          <div className="text-[11px] text-gray-500 text-right mt-0.5">
            {time}
            {out && (entry.pending ? <span className="ml-1 text-gray-400">🕓</span> : <span className="ml-1 text-sky-500">✓✓</span>)}
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === "comment") {
    return (
      <div className="relative pl-6 mb-4">
        <span className="absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full bg-gray-900 ring-4 ring-white" />
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm max-w-3xl">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-900">{entry.author || "Someone"}</span>
            <span className="text-xs text-gray-400">{time}</span>
          </div>
          {entry.text && <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{entry.text}</div>}
          {entry.files?.length > 0 && <Attachments files={entry.files} />}
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

// Pictures show inline (click for full size); other files as cards.
function Attachments({ files }) {
  const images = files.filter((f) => isImage(f.mimeType));
  const others = files.filter((f) => !isImage(f.mimeType));
  const saved = (f) => typeof f.id === "number";
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => {
            const src = f.localUrl || fileUrl(f.id);
            const img = (
              <img
                src={src}
                alt={f.name}
                loading="lazy"
                className="max-h-64 max-w-full sm:max-w-sm rounded-lg border border-gray-200 object-contain bg-gray-50"
              />
            );
            return saved(f) ? (
              <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" title={`${f.name} — open full size`}>
                {img}
              </a>
            ) : (
              <span key={f.id}>{img}</span>
            );
          })}
        </div>
      )}
      {others.map((f) => (
        <div key={f.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2 max-w-sm bg-gray-50">
          <FileText size={22} className="text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">{f.name}</div>
            <div className="text-xs text-gray-400">{formatBytes(f.size)}</div>
          </div>
          {saved(f) ? (
            <a
              href={fileUrl(f.id, { download: true })}
              title="Download"
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-white"
            >
              <Download size={16} />
            </a>
          ) : (
            <Loader2 size={16} className="animate-spin text-gray-400" />
          )}
        </div>
      ))}
    </div>
  );
}

// The WhatsApp panel under a client's name: connect the team WhatsApp
// (QR code), then link this client to one of its chats or groups.
function WhatsAppPanel({
  canManage,
  client,
  status,
  chats,
  search,
  onSearch,
  busy,
  onLink,
  onDisconnect,
  showExample,
  onToggleExample,
}) {
  const state = status?.state;
  const title = (
    <div className="flex items-center gap-2 mb-2">
      <WhatsAppIcon size={16} />
      <span className="text-sm font-semibold text-gray-900">WhatsApp</span>
      {state === "connected" && status.me?.number && (
        <span className="ml-auto text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
          ● {status.me.number}
        </span>
      )}
    </div>
  );

  if (!status || state === "starting" || state === "connecting" || state === "disconnected") {
    return (
      <>
        {title}
        <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
          <Loader2 size={15} className="animate-spin" /> Connecting to WhatsApp…
        </div>
        {status?.error && <p className="text-xs text-gray-400">{status.error}</p>}
      </>
    );
  }

  if (state === "unreachable") {
    return (
      <>
        {title}
        <p className="text-sm text-gray-700 mb-1">The WhatsApp service isn't running on the voice server yet.</p>
        <p className="text-xs text-gray-400">{status.error}</p>
      </>
    );
  }

  if (state === "qr" && !canManage) {
    return (
      <>
        {title}
        <p className="text-sm text-gray-700">The team WhatsApp isn't connected right now.</p>
        <p className="text-xs text-gray-400 mt-1">Ask a super admin to connect it.</p>
      </>
    );
  }

  if (state === "qr") {
    return (
      <>
        {title}
        <p className="text-xs text-gray-600 mb-2">Connect the team WhatsApp (once for everyone):</p>
        <ol className="text-xs text-gray-600 list-decimal pl-4 space-y-0.5 mb-2">
          <li>Open WhatsApp on the team phone</li>
          <li>
            Go to <b>Settings → Linked devices → Link a device</b>
          </li>
          <li>Scan this code</li>
        </ol>
        {status.qr ? (
          <img src={status.qr} alt="WhatsApp QR code" className="w-56 h-56 mx-auto border border-gray-200 rounded-lg" />
        ) : (
          <div className="w-56 h-56 mx-auto flex items-center justify-center text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-2 text-center">The code refreshes by itself — this updates when it's scanned.</p>
      </>
    );
  }

  // Everyone but a super admin: the assigned chat, locked, read-only.
  if (!canManage) {
    return (
      <>
        {title}
        {client.whatsappChatId ? (
          <div className="flex items-start gap-2 text-xs text-gray-600 bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">
            <Lock size={13} className="text-green-700 mt-0.5 shrink-0" />
            <span>
              Assigned to <b className="text-gray-900">{client.whatsappChatName || client.whatsappChatId}</b>. You can read and
              reply here; only a super admin can change it.
            </span>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-700">No WhatsApp chat is assigned to {client.name} yet.</p>
            <p className="text-xs text-gray-400 mt-1">A super admin can assign one.</p>
            <button onClick={onToggleExample} className="mt-2 text-xs font-medium text-gray-600 hover:text-gray-900">
              {showExample ? "Hide example messages" : "Show example messages"}
            </button>
          </>
        )}
      </>
    );
  }

  // Super admin, connected: assign (or change) this client's chat.
  const q = search.trim().toLowerCase();
  const list = (chats || []).filter((c) => !q || c.name.toLowerCase().includes(q));
  return (
    <>
      {title}
      {client.whatsappChatId ? (
        <div className="flex items-center gap-2 text-xs text-gray-600 bg-green-50 border border-green-200 rounded-lg px-2.5 py-2 mb-2">
          <Lock size={13} className="text-green-700 shrink-0" />
          <span className="flex-1 min-w-0">
            Locked to <b className="text-gray-900">{client.whatsappChatName || client.whatsappChatId}</b>
          </span>
          <button disabled={busy} onClick={() => onLink(null)} className="text-gray-500 hover:text-red-600 font-medium">
            Unlink
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500 mb-2">
          Assign {client.name}'s chat or group — it's then locked to them, and only super admins can change it.
        </p>
      )}
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={client.whatsappChatId ? "Change to another chat…" : "Search chats and groups"}
          className="w-full border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-sm outline-none focus:border-gray-400"
        />
      </div>
      <div className="max-h-60 overflow-y-auto -mx-1">
        {!chats ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 px-2 py-3">
            <Loader2 size={13} className="animate-spin" /> Loading chats…
          </div>
        ) : !list.length ? (
          <div className="text-xs text-gray-400 px-2 py-3">
            {chats.length ? "No chats match." : "No chats yet — they appear as WhatsApp syncs, give it a minute."}
          </div>
        ) : (
          list.slice(0, 100).map((c) => (
            <button
              key={c.id}
              disabled={busy || c.id === client.whatsappChatId}
              onClick={() => onLink(c)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm ${
                c.id === client.whatsappChatId ? "bg-green-50 text-green-800" : "hover:bg-gray-50 text-gray-800"
              } disabled:cursor-default`}
            >
              <span className="w-7 h-7 shrink-0 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold flex items-center justify-center">
                {c.isGroup ? "👥" : initials(c.name)}
              </span>
              <span className="flex-1 min-w-0 truncate">{c.name}</span>
              {c.isGroup && <span className="text-[10px] text-gray-400">Group</span>}
            </button>
          ))
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        {!client.whatsappChatId ? (
          <button onClick={onToggleExample} className="text-xs font-medium text-gray-600 hover:text-gray-900">
            {showExample ? "Hide example messages" : "Show example messages"}
          </button>
        ) : (
          <span />
        )}
        <button disabled={busy} onClick={onDisconnect} className="text-xs text-gray-400 hover:text-red-600">
          Disconnect WhatsApp
        </button>
      </div>
    </>
  );
}
