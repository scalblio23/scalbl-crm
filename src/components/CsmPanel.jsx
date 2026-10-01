import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  AtSign,
  Bell,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Megaphone,
  MessageCircle,
  Paperclip,
  Pencil,
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

export default function CsmPanel({
  canManageWhatsApp = false,
  currentUserId = null,
  onUnreadChange = () => {},
  // false while another tab is showing: the panel stays mounted (so
  // coming back is instant) but stops refreshing.
  active = true,
}) {
  // What this tab showed last time (clients, counts, recent timelines),
  // so it opens instantly and then refreshes in the background.
  const [snapshot] = useState(() => readSnapshot(currentUserId));
  const activeRef = useRef(active);
  activeRef.current = active;
  const [clients, setClients] = useState(snapshot?.clients || []);
  // Unread incoming WhatsApp messages per client, and comments that
  // @mention this user, per client.
  const [unread, setUnread] = useState(() =>
    snapshot?.unread ? withMentions(snapshot.unread) : { total: 0, byClient: {}, mentions: NO_MENTIONS }
  );
  // Team members who can be @mentioned: [{ id, name }].
  const [people, setPeople] = useState(snapshot?.people || []);
  // The @ picker under the comment box: { query, start, index } while open.
  const [mentionPicker, setMentionPicker] = useState(null);
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const commentBoxRef = useRef(null);
  const highlightRef = useRef(null);
  const [loadingClients, setLoadingClients] = useState(!snapshot?.clients?.length);
  const [selectedId, setSelectedId] = useState(snapshot?.selectedId ?? null);
  // Every timeline opened (or prefetched) this visit, by client id — so
  // going back to a client is instant, and refreshes only fetch what's
  // new. Entries still saving carry pending: true.
  const [timelines, setTimelines] = useState(snapshot?.timelines || {});
  // Timelines from the snapshot are only the newest part: the first
  // refresh of each fetches it in full.
  const partialTimelines = useRef(new Set(Object.keys(snapshot?.timelines || {}).map(Number)));
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
  // Last 30 days of Meta leads per client: { [clientId]: { status, days, total, … } }.
  const [adLeads, setAdLeads] = useState({});
  const adLeadsAt = useRef({});
  const loadAdLeads = (clientId, { force = false } = {}) => {
    if (!clientId) return;
    // The server caches Meta for 30 min; asking again within 5 adds nothing.
    if (!force && Date.now() - (adLeadsAt.current[clientId] || 0) < 5 * 60 * 1000) return;
    adLeadsAt.current[clientId] = Date.now();
    if (force) setAdLeads((m) => ({ ...m, [clientId]: undefined }));
    api
      .get(`/api/csm?op=ad-leads&clientId=${clientId}`)
      .then((r) => setAdLeads((m) => ({ ...m, [clientId]: r })))
      .catch((err) => setAdLeads((m) => ({ ...m, [clientId]: { status: "error", error: err.message } })));
  };
  useEffect(() => {
    if (active) loadAdLeads(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, active]);

  // Long timelines show their newest entries first; "Show earlier"
  // adds more (drawing hundreds at once is what makes a busy chat slow).
  const [shownCount, setShownCount] = useState(TIMELINE_PAGE);
  const [waOpen, setWaOpen] = useState(false);
  const [waStatus, setWaStatus] = useState(null); // { state, qr, me, error }
  const [waChats, setWaChats] = useState(null);
  const [waChatSearch, setWaChatSearch] = useState("");
  const [waBusy, setWaBusy] = useState(false);
  const timelineEndRef = useRef(null);

  const selected = clients.find((c) => c.id === selectedId) || null;
  const entries = useMemo(() => timelines[selectedId] || [], [timelines, selectedId]);
  const updateTimeline = (clientId, fn) =>
    setTimelines((t) => {
      const next = fn(t[clientId] || []);
      return next === t[clientId] ? t : { ...t, [clientId]: next };
    });
  // Fetches a client's timeline — just the entries after the newest one
  // we already have, when we have some — and merges it in.
  const timelinesRef = useRef(timelines);
  timelinesRef.current = timelines;
  const inFlight = useRef(new Map());
  const refreshTimeline = (clientId) => {
    if (inFlight.current.has(clientId)) return inFlight.current.get(clientId);
    const partial = partialTimelines.current.has(clientId);
    const have = partial ? null : timelinesRef.current[clientId];
    const after = have ? lastSavedId(have) : 0;
    const request = ((!after && takeWarmTimeline(clientId)) || api.get(`/api/csm?clientId=${clientId}${after ? `&after=${after}` : ""}`))
      .then(({ entries: list }) => {
        partialTimelines.current.delete(clientId);
        updateTimeline(clientId, (prev) => mergeEntries(prev, list || [], !have));
      })
      .finally(() => inFlight.current.delete(clientId));
    inFlight.current.set(clientId, request);
    return request;
  };
  // Load a timeline before it's clicked (hovering a client, or the top
  // of the list right after it loads).
  const prefetchTimeline = (clientId) => {
    if (!timelinesRef.current[clientId]) refreshTimeline(clientId).catch(() => {});
  };

  const loadClients = () =>
    takeWarmCsm()
      .then(({ clients: list, unread: counts }) => {
        if (list) setClients((prev) => list.map((c) => ({ ...(prev.find((p) => p.id === c.id) || {}), ...c })));
        if (counts) setUnread(withMentions(counts));
        return list || [];
      });

  useEffect(() => {
    let cancelled = false;
    loadClients()
      .then((list) => {
        if (cancelled) return;
        setSelectedId((id) => (id && list.some((c) => c.id === id) ? id : list[0]?.id ?? null));
        // Warm up the next few timelines, a moment after the first one —
        // one at a time, so it never holds several database connections.
        setTimeout(async () => {
          for (const c of sortClients(list || [], sortKey).slice(0, 6)) {
            if (cancelled) return;
            if (!timelinesRef.current[c.id]) await refreshTimeline(c.id).catch(() => {});
          }
        }, 800);
      })
      .catch((err) => !cancelled && setError(err.message || "Could not load clients."))
      .finally(() => !cancelled && setLoadingClients(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    // Already loaded: show it straight away and just check for new entries.
    setLoadingEntries(!timelinesRef.current[selectedId]);
    setMoodOpen(false);
    setWaOpen(false);
    setShownCount(TIMELINE_PAGE);
    refreshTimeline(selectedId)
      .catch((err) => !cancelled && setError(err.message || "Could not load the timeline."))
      .finally(() => !cancelled && setLoadingEntries(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Keep the sidebar bells in step with what this tab knows.
  useEffect(() => {
    onUnreadChange({ total: unread.total, mentions: unread.mentions.total });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.total, unread.mentions.total]);

  useEffect(() => {
    api
      .get("/api/csm?op=people")
      .then((r) => setPeople(r.people || []))
      .catch(() => {});
  }, []);

  // Every 15s: fresh client list (last activity, counts) and unread
  // badges, so new WhatsApp messages show up on clients you're not
  // looking at.
  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      if (!activeRef.current || document.visibilityState === "hidden") return;
      try {
        if (!cancelled) await loadClients();
      } catch {
        // try again next tick
      }
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Back on this tab after another one: catch up straight away.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      loadClients().catch(() => {});
      if (selectedId) refreshTimeline(selectedId).catch(() => {});
    }
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Remember what's on screen for next time (see readSnapshot).
  useEffect(() => {
    const timer = setTimeout(
      () => writeSnapshot(currentUserId, { clients, unread, people, selectedId, timelines }),
      1000
    );
    return () => clearTimeout(timer);
  }, [currentUserId, clients, unread, people, selectedId, timelines]);

  // Looking at a client means you've seen its messages and mentions:
  // clear its badges (on open, and again whenever new ones arrive while
  // it's open).
  const selectedUnread =
    (selectedId && (unread.byClient[selectedId] || 0) + (unread.mentions.byClient[selectedId] || 0)) || 0;
  useEffect(() => {
    if (!active || !selectedId || !selectedUnread || document.visibilityState === "hidden") return;
    setUnread((u) => {
      const byClient = { ...u.byClient, [selectedId]: 0 };
      const m = u.mentions;
      const mentions = {
        total: Math.max(0, m.total - (m.byClient[selectedId] || 0)),
        byClient: { ...m.byClient, [selectedId]: 0 },
        items: m.items.filter((i) => i.clientId !== selectedId),
      };
      return { total: Math.max(0, u.total - (u.byClient[selectedId] || 0)), byClient, mentions };
    });
    api
      .post("/api/csm", { action: "mark-read", clientId: selectedId })
      .then((counts) => counts && setUnread(withMentions(counts)))
      .catch(() => {});
  }, [active, selectedId, selectedUnread]);

  // WhatsApp connection status — every 3s while the WhatsApp panel is
  // open (so a scanned QR code turns into "Connected" quickly), every
  // 30s otherwise.
  useEffect(() => {
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (!activeRef.current) {
        timer = setTimeout(tick, 5000);
        return;
      }
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

  // The open client: check for new entries (WhatsApp messages,
  // teammates' comments) every 5s while the page is visible.
  useEffect(() => {
    if (!selectedId) return undefined;
    const timer = setInterval(() => {
      if (!activeRef.current || document.visibilityState === "hidden") return;
      refreshTimeline(selectedId).catch(() => {
        // try again next tick
      });
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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

  const hiddenCount = Math.max(0, visibleEntries.length - shownCount);

  // Entries grouped by day, oldest first.
  const days = useMemo(() => {
    const groups = [];
    for (const e of visibleEntries.slice(-shownCount)) {
      const label = formatDay(e.createdAt);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    return groups;
  }, [visibleEntries, shownCount]);

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
    updateTimeline(client.id, (list) => [...list, { ...entry, id: tempId, clientId: client.id, createdAt: now, pending: true }]);
    try {
      const result = await api.post("/api/csm", body);
      // (The 5s WhatsApp poll may already have brought the saved copy in.)
      updateTimeline(client.id, (list) =>
        list.filter((e) => e.id !== result.entry.id).map((e) => (e.id === tempId ? result.entry : e))
      );
      onSaved?.();
      if (latestRequest.current[key] === seq && result.client) {
        setClients((list) => list.map((c) => (c.id === result.client.id ? result.client : c)));
      }
    } catch (err) {
      updateTimeline(client.id, (list) => list.filter((e) => e.id !== tempId));
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
    setMentionPicker(null);
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
          mentions: batchText ? mentionedIn(batchText, people).map((p) => p.id) : [],
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

  // ---------- @mentions ----------

  // Typing "@" (at the start or after a space) opens the picker; what
  // follows narrows it down.
  const updateMentionPicker = (value, caret) => {
    if (composeMode !== "comment" || !people.length) return setMentionPicker(null);
    const m = /(^|\s)@([^@\n]{0,30})$/.exec(value.slice(0, caret));
    if (!m) return setMentionPicker(null);
    const query = m[2];
    if (!mentionMatches(people, query, currentUserId).length) return setMentionPicker(null);
    setMentionPicker((prev) => ({ query, start: caret - query.length - 1, index: prev?.query === query ? prev.index : 0 }));
  };

  const pickMention = (person) => {
    if (!mentionPicker) return;
    const box = commentBoxRef.current;
    const end = mentionPicker.start + 1 + mentionPicker.query.length;
    const insert = `@${person.name} `;
    const next = comment.slice(0, mentionPicker.start) + insert + comment.slice(end);
    setComment(next);
    setMentionPicker(null);
    const caret = mentionPicker.start + insert.length;
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(caret, caret);
    });
  };

  const mentionOptions = mentionPicker ? mentionMatches(people, mentionPicker.query, currentUserId) : [];

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
      updateTimeline(selected.id, (prev) => mergeEntries(prev, list || [], true));
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
    updateTimeline(clientId, (list) => [
      ...list,
      { id: tempId, clientId, kind: "whatsapp", value: "out", author: "You", text, createdAt: new Date().toISOString(), pending: true },
    ]);
    try {
      const { messageId } = await api.post("/api/whatsapp", { op: "send", clientId, text });
      updateTimeline(clientId, (list) =>
        list.some((e) => e.waId === messageId && !e.pending)
          ? list.filter((e) => e.id !== tempId)
          : list.map((e) => (e.id === tempId ? { ...e, waId: messageId } : e))
      );
    } catch (err) {
      updateTimeline(clientId, (list) => list.filter((e) => e.id !== tempId));
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

  // The client's ad account link (and which campaigns count): shows
  // straight away, saved behind, then the leads chart reloads.
  const saveAdAccount = async (url, rule) => {
    const client = selected;
    if (!client) return;
    const previous = { adAccountUrl: client.adAccountUrl, adAccountRule: client.adAccountRule };
    setError("");
    setClients((list) =>
      list.map((c) => (c.id === client.id ? { ...c, adAccountUrl: url || null, adAccountRule: rule } : c))
    );
    try {
      const result = await api.post("/api/csm", { action: "ad-account", clientId: client.id, url, rule });
      setClients((list) => list.map((c) => (c.id === result.client.id ? { ...c, ...result.client } : c)));
      loadAdLeads(client.id, { force: true });
    } catch (err) {
      setClients((list) => list.map((c) => (c.id === client.id ? { ...c, ...previous } : c)));
      setError(err.message || "Could not save the ad account link.");
    }
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
            <div className="relative ml-auto mr-1.5">
              <button
                onClick={() => setMentionsOpen((v) => !v)}
                title={
                  unread.mentions.total
                    ? `You were mentioned in ${unread.mentions.total} comment${unread.mentions.total === 1 ? "" : "s"}`
                    : "Comments that mention you"
                }
                className={`relative h-7 w-7 flex items-center justify-center rounded-lg border ${
                  unread.mentions.total
                    ? "border-blue-200 bg-blue-50 text-blue-600"
                    : "border-gray-200 bg-white text-gray-400 hover:text-gray-700"
                }`}
              >
                <Bell size={14} />
                {unread.mentions.total > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unread.mentions.total > 99 ? "99+" : unread.mentions.total}
                  </span>
                )}
              </button>
              {mentionsOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMentionsOpen(false)} />
                  <div className="absolute left-0 top-9 z-30 w-80 max-h-96 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg">
                    <div className="px-3 py-2 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Mentions
                    </div>
                    {!unread.mentions.items.length && (
                      <div className="px-3 py-4 text-sm text-gray-400">
                        Nothing new. When someone writes @your name in a comment, it shows up here.
                      </div>
                    )}
                    {unread.mentions.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSelectedId(item.clientId);
                          setTimelineFilter("all");
                          setMentionsOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-blue-50/60"
                      >
                        <div className="flex items-baseline gap-1.5 text-xs">
                          <span className="font-semibold text-gray-900">{item.author}</span>
                          <span className="text-gray-400">on</span>
                          <span className="font-semibold text-blue-700 truncate">{item.clientName}</span>
                          <span className="ml-auto shrink-0 text-gray-400">{formatTime(item.createdAt)}</span>
                        </div>
                        <div className="mt-0.5 text-sm text-gray-600 line-clamp-2 break-words">
                          <MentionText text={item.text} people={people} currentUserId={currentUserId} />
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
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
                onMouseEnter={() => prefetchTimeline(c.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left mb-0.5 ${
                  active ? "bg-white shadow-sm border border-gray-200" : "hover:bg-white border border-transparent"
                }`}
              >
                <span className="w-8 h-8 shrink-0 rounded-full bg-gray-200 text-gray-600 text-xs font-semibold flex items-center justify-center">
                  {initials(c.name)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm text-gray-900 truncate ${unread.byClient[c.id] ? "font-bold" : "font-medium"}`}>
                    {c.name}
                  </span>
                  <span className="block text-xs text-gray-400 truncate">
                    {c.commentCount ? `${c.commentCount} comment${c.commentCount === 1 ? "" : "s"}` : "No comments yet"}
                  </span>
                </span>
                {unread.mentions.byClient[c.id] > 0 && (
                  <span
                    title={`You were mentioned ${unread.mentions.byClient[c.id]} time${unread.mentions.byClient[c.id] === 1 ? "" : "s"}`}
                    className="h-5 px-1.5 rounded-full bg-blue-500 text-white text-[11px] font-bold flex items-center gap-0.5"
                  >
                    <AtSign size={10} strokeWidth={3} />
                    {unread.mentions.byClient[c.id]}
                  </span>
                )}
                {unread.byClient[c.id] > 0 && (
                  <span
                    title={`${unread.byClient[c.id]} new WhatsApp message${unread.byClient[c.id] === 1 ? "" : "s"}`}
                    style={{ backgroundColor: WHATSAPP_GREEN }}
                    className="min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                  >
                    {unread.byClient[c.id] > 99 ? "99+" : unread.byClient[c.id]}
                  </span>
                )}
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
                <div className="flex items-start gap-5">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold truncate">{selected.name}</h2>
                    <div className="text-xs text-gray-400">
                      {selected.lastActivityAt ? `Last update ${formatDay(selected.lastActivityAt).toLowerCase()} at ${formatTime(selected.lastActivityAt)}` : "No activity yet"}
                    </div>
                  </div>
                  <LeadsChart data={adLeads[selected.id]} hasAccount={Boolean(selected.adAccountUrl)} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <div className="relative">
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
                <AdAccountLink
                  key={selected.id}
                  url={selected.adAccountUrl}
                  rule={selected.adAccountRule || ""}
                  onSave={saveAdAccount}
                />
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
                  {hiddenCount > 0 && (
                    <li className="mb-4 -ml-px pl-6">
                      <button
                        onClick={() => setShownCount((n) => n + TIMELINE_PAGE)}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 bg-white rounded-full px-3 py-1"
                      >
                        Show earlier ({hiddenCount})
                      </button>
                    </li>
                  )}
                  {days.map((day) => (
                    <li key={day.label} className="mb-2">
                      <div className="-ml-2 mb-3 inline-block bg-white pr-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        {day.label}
                      </div>
                      {day.items.map((e) => (
                        // Faded until the server has saved it.
                        <div key={e.id} className={e.pending ? "opacity-60" : ""}>
                          <TimelineItem entry={e} people={people} currentUserId={currentUserId} />
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
                <div
                  className={`relative flex-1 min-w-0 rounded-xl ${composeMode === "whatsapp" ? "bg-green-50/30" : "bg-white"}`}
                >
                  {/* Names picked with @ are highlighted behind the text. */}
                  {composeMode === "comment" && (
                    <div
                      ref={highlightRef}
                      aria-hidden
                      className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words border border-transparent rounded-xl px-3 py-2 text-sm text-transparent pointer-events-none"
                    >
                      <MentionText text={comment} people={people} highlightOnly />
                      {"\n"}
                    </div>
                  )}
                  <textarea
                    ref={commentBoxRef}
                    value={comment}
                    onPaste={(e) => {
                      const files = Array.from(e.clipboardData?.files || []);
                      if (composeMode !== "comment" || !files.length) return;
                      e.preventDefault();
                      addFiles(files);
                    }}
                    onChange={(e) => {
                      setComment(e.target.value);
                      updateMentionPicker(e.target.value, e.target.selectionStart);
                    }}
                    onSelect={(e) => updateMentionPicker(e.target.value, e.target.selectionStart)}
                    onBlur={() => setTimeout(() => setMentionPicker(null), 150)}
                    onScroll={(e) => {
                      if (highlightRef.current) highlightRef.current.scrollTop = e.target.scrollTop;
                    }}
                    onKeyDown={(e) => {
                      if (mentionPicker && mentionOptions.length) {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const step = e.key === "ArrowDown" ? 1 : -1;
                          setMentionPicker((p) => ({
                            ...p,
                            index: (p.index + step + mentionOptions.length) % mentionOptions.length,
                          }));
                          return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          pickMention(mentionOptions[Math.min(mentionPicker.index, mentionOptions.length - 1)]);
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setMentionPicker(null);
                          return;
                        }
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (composeMode === "comment") sendComment();
                        else sendWhatsApp();
                      }
                    }}
                    rows={2}
                    placeholder={
                      composeMode === "comment"
                        ? `Add a comment about ${selected.name}… Type @ to mention someone (Enter to send)`
                        : `Message ${selected.name} on WhatsApp…`
                    }
                    className={`relative block w-full bg-transparent resize-none border rounded-xl px-3 py-2 text-sm outline-none ${
                      composeMode === "whatsapp"
                        ? "border-green-200 focus:border-green-400"
                        : "border-gray-200 focus:border-gray-400"
                    }`}
                  />
                  {mentionPicker && mentionOptions.length > 0 && (
                    <div className="absolute left-0 bottom-full mb-1.5 z-30 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
                      <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Mention someone
                      </div>
                      {mentionOptions.map((person, i) => (
                        <button
                          key={person.id}
                          type="button"
                          // mousedown, so the comment box keeps focus
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickMention(person);
                          }}
                          onMouseEnter={() => setMentionPicker((p) => p && { ...p, index: i })}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${
                            i === mentionPicker.index ? "bg-blue-50 text-blue-700" : "text-gray-700"
                          }`}
                        >
                          <span className="w-6 h-6 shrink-0 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold flex items-center justify-center">
                            {initials(person.name)}
                          </span>
                          <span className="truncate">{person.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

const TIMELINE_PAGE = 150;

// ---------- Opening instantly ----------

// The client list, fetched ahead of time (see prefetchCsm), used by the
// panel when it opens if it's still fresh.
// Also the timeline of the client it will open on.
let warmCsm = null;
let warmTimeline = null; // { clientId, at, request }
const WARM_MS = 60000;
export function prefetchCsm(userId = null) {
  if (warmCsm && Date.now() - warmCsm.at < WARM_MS) return;
  const at = Date.now();
  warmCsm = { at, request: api.get("/api/csm") };
  warmCsm.request
    .then(({ clients: list }) => {
      // The client the tab opens on: last one looked at, else the first.
      const saved = readSnapshot(userId)?.selectedId;
      const clientId = (list || []).some((c) => c.id === saved) ? saved : list?.[0]?.id;
      if (clientId) warmTimeline = { clientId, at, request: api.get(`/api/csm?clientId=${clientId}`) };
    })
    .catch(() => {
      warmCsm = null;
    });
}
function takeWarmCsm() {
  const warm = warmCsm && Date.now() - warmCsm.at < WARM_MS ? warmCsm.request : null;
  warmCsm = null;
  return warm || api.get("/api/csm");
}
// A whole-timeline request for this client made ahead of time, if any.
function takeWarmTimeline(clientId) {
  const warm = warmTimeline;
  if (!warm || warm.clientId !== clientId || Date.now() - warm.at > WARM_MS) return null;
  warmTimeline = null;
  return warm.request;
}

// A snapshot of the tab in this browser, per user: the client list,
// counts, people and the timelines looked at most recently (newest
// entries only). Shown on open while fresh data loads.
const SNAPSHOT_TIMELINES = 8;
const snapshotKey = (userId) => `scalbl.csm.snapshot.${userId || "me"}`;
function readSnapshot(userId) {
  try {
    const s = JSON.parse(localStorage.getItem(snapshotKey(userId)) || "null");
    return s && s.v === 1 && Array.isArray(s.clients) ? s : null;
  } catch {
    return null;
  }
}
function writeSnapshot(userId, { clients, unread, people, selectedId, timelines }) {
  if (!clients.length) return;
  const ids = [selectedId, ...Object.keys(timelines).map(Number).reverse()].filter(
    (id, i, all) => id && all.indexOf(id) === i && timelines[id]
  );
  const kept = {};
  for (const id of ids.slice(0, SNAPSHOT_TIMELINES)) {
    kept[id] = timelines[id].filter((e) => !e.pending && typeof e.id === "number").slice(-TIMELINE_PAGE);
  }
  try {
    localStorage.setItem(
      snapshotKey(userId),
      JSON.stringify({ v: 1, clients, unread, people, selectedId, timelines: kept })
    );
  } catch {
    // storage full or blocked — it just opens the normal way next time
  }
}

// Newest saved entry id (ids only go up; pending ones aren't saved yet).
function lastSavedId(list) {
  let max = 0;
  for (const e of list) if (!e.pending && typeof e.id === "number" && e.id > max) max = e.id;
  return max;
}

// Adds fetched entries to a timeline: new ones are added, saved copies
// replace what we had, anything still saving stays (unless its saved
// copy just arrived). full: the fetch was the whole timeline, so it
// replaces the saved entries outright. Kept in time order.
function mergeEntries(prev, fetched, full = false) {
  if (!fetched.length && !full) return prev;
  const byId = new Map((full ? [] : prev.filter((e) => !e.pending)).map((e) => [e.id, e]));
  for (const e of fetched) byId.set(e.id, e);
  const saved = [...byId.values()];
  const pending = prev.filter((e) => e.pending && !(e.waId && saved.some((x) => x.waId === e.waId)));
  const merged = [...saved.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id), ...pending];
  if (merged.length === prev.length && merged.every((e, i) => e === prev[i])) return prev;
  return merged;
}

const NO_MENTIONS = { total: 0, byClient: {}, items: [] };
const withMentions = (counts) => ({ ...counts, mentions: counts.mentions || NO_MENTIONS });

// People whose name starts with (or has a word starting with) what's
// been typed after the @ — never yourself.
function mentionMatches(people, query, currentUserId) {
  const q = query.trim().toLowerCase();
  return people
    .filter((p) => p.id !== currentUserId)
    .filter((p) => !q || p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
    .slice(0, 6);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Splits text into plain parts and "@Name" parts for known people
// (longest names first, so "@Jem Smith" wins over "@Jem").
function splitMentions(text, people) {
  const names = people.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length || !text.includes("@")) return [{ text }];
  const re = new RegExp(`@(${names.map(escapeRegExp).join("|")})`, "g");
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], person: people.find((p) => p.name === m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// The people a comment mentions (sent with it, so they get notified).
function mentionedIn(text, people) {
  const ids = new Set(splitMentions(text, people).filter((p) => p.person).map((p) => p.person.id));
  return people.filter((p) => ids.has(p.id));
}

// Comment text with @mentions shown as blue name tags. highlightOnly:
// the backdrop behind the comment box (same text, only the tags show).
// Web links in comment text (trailing punctuation isn't part of them).
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'}]/g;

// Plain text with its links made clickable.
function Linkified({ text }) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a
        key={m.index}
        href={m[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline decoration-blue-300 hover:decoration-blue-600 break-all"
      >
        {m[0]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// A video link we can play inline → { provider, src } (the provider's
// own embeddable player), else null.
export function videoEmbedFor(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;
  let m;
  if (host === "loom.com" && (m = /^\/(?:share|embed)\/([a-f0-9]{32})/i.exec(path))) {
    return { provider: "Loom", src: `https://www.loom.com/embed/${m[1]}` };
  }
  if (host === "youtu.be" && (m = /^\/([\w-]{11})/.exec(path))) {
    return { provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = url.searchParams.get("v") || (/^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(path) || [])[1];
    if (id && /^[\w-]{11}$/.test(id)) return { provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "vimeo.com" && (m = /^\/(\d+)(?:\/([a-f0-9]+))?/.exec(path))) {
    return { provider: "Vimeo", src: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ""}` };
  }
  if (host === "drive.google.com" && (m = /^\/file\/d\/([\w-]+)/.exec(path))) {
    return { provider: "Google Drive", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  }
  return null;
}

// Players for the Loom / YouTube / Vimeo / Google Drive links in a
// comment, under its text.
function VideoEmbeds({ text }) {
  const seen = new Set();
  const videos = [];
  for (const m of text.matchAll(URL_RE)) {
    const v = videoEmbedFor(m[0]);
    if (v && !seen.has(v.src) && videos.length < 4) {
      seen.add(v.src);
      videos.push({ ...v, link: m[0] });
    }
  }
  if (!videos.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {videos.map((v) => (
        <div key={v.src} className="max-w-xl">
          <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-black" style={{ paddingTop: "56.25%" }}>
            <iframe
              src={v.src}
              title={`${v.provider} video`}
              loading="lazy"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <a
            href={v.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-[11px] text-gray-400 hover:text-gray-700"
          >
            Open in {v.provider} ↗
          </a>
        </div>
      ))}
    </div>
  );
}

// links: make web links clickable (the timeline; not the comment box's
// highlight layer or the Mentions list, which is itself a button).
function MentionText({ text, people, currentUserId = null, highlightOnly = false, links = false }) {
  return splitMentions(text, people).map((part, i) =>
    part.person ? (
      <mark
        key={i}
        className={
          highlightOnly
            ? "bg-blue-100 text-transparent rounded"
            : `rounded px-0.5 font-medium ${
                part.person.id === currentUserId ? "bg-blue-500 text-white" : "bg-blue-100 text-blue-700"
              }`
        }
      >
        {part.text}
      </mark>
    ) : (
      <span key={i}>{links ? <Linkified text={part.text} /> : part.text}</span>
    )
  );
}

const META_BLUE = "#0866FF";

// Last 30 days of Meta leads as a small bar chart (one bar a day,
// today on the right), for the client header.
function LeadsChart({ data, hasAccount }) {
  const [hover, setHover] = useState(null);
  const label = (
    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5 flex items-baseline gap-1.5 whitespace-nowrap">
      Leads · 30 days
      {data?.status === "ok" && (
        <span className="text-gray-900 text-xs normal-case tracking-normal tabular-nums">{data.total}</span>
      )}
    </div>
  );
  let body;
  if (!hasAccount || data?.status === "no-account") {
    body = <div className="h-7 flex items-center text-[11px] text-gray-400 whitespace-nowrap">Add the ad account link to see leads</div>;
  } else if (!data) {
    body = <div className="h-7 w-[150px] rounded bg-gray-50 animate-pulse" />;
  } else if (data.status === "not-configured") {
    body = (
      <div className="h-7 flex items-center text-[11px] text-gray-400 whitespace-nowrap" title="Set META_ACCESS_TOKEN in Vercel">
        Meta not connected yet
      </div>
    );
  } else if (data.status !== "ok") {
    body = (
      <div className="h-7 flex items-center text-[11px] text-amber-600 whitespace-nowrap" title={data.error}>
        Couldn't load leads from Meta
      </div>
    );
  } else {
    const max = Math.max(1, ...data.days.map((d) => d.leads));
    const shown = hover === null ? null : data.days[hover];
    body = (
      <div className="relative">
        <div className="h-7 w-[150px] flex items-end gap-px" onMouseLeave={() => setHover(null)}>
          {data.days.map((d, i) => (
            <div
              key={d.date}
              onMouseEnter={() => setHover(i)}
              className="flex-1 h-full flex items-end"
            >
              <div
                className={`w-full rounded-[1px] ${hover === i ? "bg-gray-900" : d.leads ? "bg-blue-500" : "bg-gray-200"}`}
                style={{ height: d.leads ? `${Math.max(8, (d.leads / max) * 100)}%` : "2px", backgroundColor: hover === i ? undefined : d.leads ? META_BLUE : undefined }}
              />
            </div>
          ))}
        </div>
        {shown && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white shadow">
            {new Date(`${shown.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}:{" "}
            <span className="font-semibold">{shown.leads}</span> lead{shown.leads === 1 ? "" : "s"}
          </div>
        )}
      </div>
    );
  }
  const title =
    data?.status === "ok"
      ? `${data.total} leads in the last 30 days${data.keyword ? ` from campaigns containing "${data.keyword}"` : ""} (Meta)`
      : undefined;
  return (
    <div title={title}>
      {label}
      {body}
    </div>
  );
}

// The client's ad account: opens it in Ads Manager; the pencil edits it.
function AdAccountLink({ url, rule = "", onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url || "");
  const [ruleDraft, setRuleDraft] = useState(rule);
  const act = /[?&]act=(\d+)/.exec(url || "")?.[1];
  const save = (value, nextRule = ruleDraft.trim()) => {
    const next = value.trim();
    if (next && !/^https?:\/\/\S+$/i.test(next)) return;
    setEditing(false);
    if (next !== (url || "") || nextRule !== rule) onSave(next, nextRule);
  };
  return (
    <div className="relative flex items-center">
      {url ? (
        <span className="h-7 flex items-center rounded-full border border-blue-200 bg-blue-50 text-xs font-medium" style={{ color: META_BLUE }}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={act ? `Ad account ${act} — open in Ads Manager` : "Open in Ads Manager"}
            className="h-full flex items-center gap-1.5 pl-2.5 pr-1.5 rounded-l-full hover:bg-blue-100"
          >
            <Megaphone size={13} />
            Ad account
            <ExternalLink size={11} />
          </a>
          <button
            onClick={() => {
              setDraft(url);
              setRuleDraft(rule);
              setEditing(true);
            }}
            title="Change the ad account link"
            className="h-full flex items-center pl-1 pr-2 rounded-r-full border-l border-blue-200 hover:bg-blue-100"
          >
            <Pencil size={11} />
          </button>
        </span>
      ) : (
        <button
          onClick={() => {
            setDraft("");
            setRuleDraft(rule);
            setEditing(true);
          }}
          className="h-7 flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          <Megaphone size={13} /> Add ad account link
        </button>
      )}
      {editing && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditing(false)} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
            className="absolute left-0 top-full mt-1 z-50 w-96 bg-white border border-gray-200 rounded-xl shadow-lg p-3"
          >
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Ad account link (Ads Manager)</label>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              placeholder="https://adsmanager.facebook.com/…?act=…"
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-gray-400"
            />
            {draft.trim() && !/^https?:\/\/\S+$/i.test(draft.trim()) && (
              <div className="mt-1 text-xs text-red-600">Paste the full link, starting with https://</div>
            )}
            <label className="block text-xs font-semibold text-gray-600 mt-3 mb-1.5">
              Count leads from campaigns containing
            </label>
            <input
              value={ruleDraft}
              onChange={(e) => setRuleDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              placeholder="e.g. S.IO — leave empty for every campaign"
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-gray-400"
            />
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="submit"
                disabled={Boolean(draft.trim()) && !/^https?:\/\/\S+$/i.test(draft.trim())}
                className="bg-gray-900 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                Save
              </button>
              {url && (
                <button type="button" onClick={() => save("", rule)} className="text-xs font-medium text-red-600 hover:text-red-700">
                  Remove
                </button>
              )}
              <button type="button" onClick={() => setEditing(false)} className="ml-auto text-xs text-gray-500 hover:text-gray-800">
                Cancel
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function TimelineItem({ entry, people = [], currentUserId = null }) {
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
          {entry.text && (
            <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">
              <MentionText text={entry.text} people={people} currentUserId={currentUserId} links />
            </div>
          )}
          {entry.text && <VideoEmbeds text={entry.text} />}
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
