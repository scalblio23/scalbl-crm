// The linked WhatsApp account (the shared team number), connected the
// same way WhatsApp Web is: scan a QR code once from the phone's
// Settings → Linked devices, and this process stays connected.
//
// It keeps:
//   - the login (auth files in `dataDir/auth`, so a restart reconnects
//     without a new QR);
//   - the chat list (names only) so a CSM client can be linked to one;
//   - the last few messages of each chat in memory, so linking a client
//     can fill its timeline with recent history.
// Messages themselves are only written anywhere permanent for chats
// linked to a CSM client — that's the `sink` (see sync.js).
//
// Events: "status" (status object), "messages" ([{ normalized, raw }]).
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  generateMessageIDV2,
  useMultiFileAuthState,
} from "baileys";
import { isGroupChat, isStorableChat, normalizeMessage, phoneFromJid } from "./messages.js";

const RECENT_PER_CHAT = 60;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

// Baileys wants a pino-style logger; this one only lets warnings and
// errors through, prefixed, to the service's normal log.
function makeLogger(log, bindings = {}) {
  const tag = bindings.class ? `[whatsapp:${bindings.class}]` : "[whatsapp]";
  const out = (fn) => (obj, msg) => fn(`${tag} ${msg || ""}`.trim(), typeof obj === "string" ? obj : obj?.err?.message || "");
  return {
    level: "warn",
    child: (b) => makeLogger(log, { ...bindings, ...b }),
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: out(log.warn.bind(log)),
    error: out(log.error.bind(log)),
  };
}

export class WhatsAppService extends EventEmitter {
  constructor({ dataDir, log = console, makeSocket = makeWASocket, authState = useMultiFileAuthState } = {}) {
    super();
    this.dataDir = dataDir;
    this.authDir = path.join(dataDir, "auth");
    this.log = log;
    this.makeSocket = makeSocket;
    this.authState = authState;
    this.sock = null;
    this.state = "starting"; // starting | qr | connecting | connected | disconnected
    this.qr = null; // data: URL of the current QR code
    this.me = null; // { number, name }
    this.lastError = "";
    this.chats = new Map(); // id → { id, name, isGroup, lastMessageAt }
    this.names = new Map(); // jid (phone or @lid) → display name
    this.lidToPn = new Map(); // "…@lid" → "…@s.whatsapp.net"
    this.recent = new Map(); // chatId → [{ normalized, raw }]
    this.stopped = false;
    this.reconnectTimer = null;
  }

  status() {
    return { state: this.state, qr: this.state === "qr" ? this.qr : null, me: this.me, error: this.lastError };
  }

  setState(state, extra = {}) {
    Object.assign(this, extra);
    this.state = state;
    this.emit("status", this.status());
  }

  async start() {
    this.stopped = false;
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await this.authState(this.authDir);
    const sock = this.makeSocket({
      auth: state,
      browser: Browsers.macOS("Scalbl CRM"),
      logger: makeLogger(this.log),
      markOnlineOnConnect: false, // don't stop the phone getting notifications
      syncFullHistory: false,
      getMessage: async (key) => this.findRaw(key)?.message || undefined,
    });
    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => this.onConnectionUpdate(sock, u));
    sock.ev.on("messaging-history.set", ({ chats, contacts, messages, lidPnMappings }) => {
      for (const m of lidPnMappings || []) this.rememberPair(m.lid, m.pn);
      this.addContacts(contacts);
      this.addChats(chats);
      this.addMessages(messages, { live: false });
    });
    sock.ev.on("chats.upsert", (chats) => this.addChats(chats));
    sock.ev.on("chats.update", (chats) => this.addChats(chats));
    sock.ev.on("contacts.upsert", (contacts) => this.addContacts(contacts));
    sock.ev.on("contacts.update", (contacts) => this.addContacts(contacts));
    sock.ev.on("groups.upsert", (groups) => this.addGroups(groups));
    sock.ev.on("groups.update", (groups) => this.addGroups(groups));
    sock.ev.on("lid-mapping.update", (m) => this.rememberPair(m?.lid, m?.pn));
    sock.ev.on("messages.upsert", ({ messages, type }) => this.addMessages(messages, { live: type === "notify" || type === "append" }));
    if (this.state !== "qr") this.setState("connecting");
  }

  async onConnectionUpdate(sock, { connection, lastDisconnect, qr }) {
    if (sock !== this.sock) return; // an old socket we've already replaced
    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 }).catch(() => null);
      this.setState("qr", { qr: dataUrl, lastError: "" });
    }
    if (connection === "open") {
      const id = sock.user?.id || "";
      this.setState("connected", {
        qr: null,
        lastError: "",
        me: { number: phoneFromJid(id.replace(/:\d+@/, "@")), name: sock.user?.name || sock.user?.notify || "" },
      });
      this.log.log(`[whatsapp] connected as ${this.me.number || id}`);
      sock
        .groupFetchAllParticipating?.()
        .then((groups) => this.addGroups(Object.values(groups || {})))
        .catch(() => {});
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone (or logged out here): forget the login
        // and offer a fresh QR code.
        this.log.log("[whatsapp] logged out — waiting for a new QR scan");
        fs.rmSync(this.authDir, { recursive: true, force: true });
        this.me = null;
        this.setState("disconnected", { lastError: "" });
        this.scheduleReconnect(1000);
        return;
      }
      this.lastError = lastDisconnect?.error?.message || "";
      if (this.state === "connected") this.setState("connecting");
      // restartRequired right after pairing, or a dropped connection.
      this.scheduleReconnect(code === DisconnectReason.restartRequired ? 0 : 3000);
    }
  }

  scheduleReconnect(ms) {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.start().catch((err) => {
        this.log.error("[whatsapp] reconnect failed:", err.message);
        this.scheduleReconnect(10000);
      });
    }, ms);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    try {
      this.sock?.end?.(undefined);
    } catch {
      // already closed
    }
  }

  // Unlinks this device from the WhatsApp account.
  async logout() {
    if (!this.sock) return;
    await this.sock.logout().catch(() => {});
  }

  // ---------- chats / names ----------

  // Two ids for the same person, in either order.
  rememberPair(a, b) {
    const lid = [a, b].find((j) => String(j || "").endsWith("@lid"));
    const pn = [a, b].find((j) => String(j || "").endsWith("@s.whatsapp.net"));
    if (lid && pn) this.lidToPn.set(lid, pn.replace(/:\d+@/, "@"));
  }

  setName(jids, name) {
    if (!name) return;
    for (const j of jids) if (j) this.names.set(j, name);
  }

  // A known name for either of a person's ids (or the other id we
  // know for them), or "".
  nameFor(jid, altJid = "") {
    const pn = this.lidToPn.get(jid) || this.lidToPn.get(altJid) || "";
    return this.names.get(jid) || this.names.get(altJid) || (pn && this.names.get(pn)) || "";
  }

  // Name for a message's sender, falling back to their phone number
  // (asking WhatsApp for it when only the private @lid id is known).
  async resolveSender(n) {
    if (n.sender) return n.sender;
    const known = this.nameFor(n.senderJid, n.senderAltJid);
    if (known) return known;
    let pn = [n.senderJid, n.senderAltJid].find((j) => String(j || "").endsWith("@s.whatsapp.net")) || "";
    if (!pn) pn = this.lidToPn.get(n.senderJid) || "";
    if (!pn && String(n.senderJid).endsWith("@lid")) {
      pn = (await this.sock?.signalRepository?.lidMapping?.getPNForLID?.(n.senderJid).catch(() => null)) || "";
      if (pn) this.rememberPair(n.senderJid, pn);
    }
    return (pn && (this.names.get(pn.replace(/:\d+@/, "@")) || phoneFromJid(pn))) || "WhatsApp user";
  }

  addContacts(contacts = []) {
    for (const c of contacts) {
      this.rememberPair(c.id, c.lid);
      this.rememberPair(c.id, c.phoneNumber);
      this.rememberPair(c.lid, c.phoneNumber);
      const name = c.name || c.verifiedName || c.notify;
      this.setName([c.id, c.lid, c.phoneNumber], name);
      if (c.id && name && this.chats.has(c.id) && !this.chats.get(c.id).named) {
        this.chats.get(c.id).name = name;
      }
    }
  }

  addChats(chats = []) {
    for (const c of chats) {
      if (!isStorableChat(c.id)) continue;
      const existing = this.chats.get(c.id);
      const name =
        c.name ||
        c.subject ||
        (existing?.named && existing.name) ||
        this.nameFor(c.id) ||
        existing?.name ||
        phoneFromJid(c.id) ||
        phoneFromJid(this.lidToPn.get(c.id)) ||
        c.id;
      const ts = Number(c.conversationTimestamp?.toNumber?.() ?? c.conversationTimestamp ?? 0) || existing?.lastMessageAt || 0;
      this.chats.set(c.id, {
        id: c.id,
        name,
        named: Boolean(c.name || c.subject || existing?.named),
        isGroup: isGroupChat(c.id),
        lastMessageAt: ts,
      });
    }
  }

  addGroups(groups = []) {
    for (const g of groups) {
      // Members' ids and names — so group messages show who sent them.
      for (const m of g.participants || []) {
        this.rememberPair(m.id, m.phoneNumber);
        this.rememberPair(m.id, m.lid);
        this.setName([m.id, m.lid, m.phoneNumber], m.name || m.notify || m.verifiedName);
      }
    }
    this.addChats(groups.filter((g) => g.id && g.subject).map((g) => ({ id: g.id, subject: g.subject })));
  }

  listChats() {
    return [...this.chats.values()]
      .map(({ id, name, isGroup, lastMessageAt }) => ({ id, name, isGroup, lastMessageAt }))
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0) || a.name.localeCompare(b.name));
  }

  // ---------- messages ----------

  addMessages(messages = [], { live }) {
    const batch = [];
    for (const raw of messages) {
      const key = raw.key || {};
      if (key.participant) this.rememberPair(key.participant, key.participantAlt);
      else this.rememberPair(key.remoteJid, key.remoteJidAlt);
      if (raw.pushName && !key.fromMe) {
        this.setName(key.participant ? [key.participant, key.participantAlt] : [key.remoteJid, key.remoteJidAlt], raw.pushName);
      }
      const normalized = normalizeMessage(raw, (jid, alt) => this.nameFor(jid, alt));
      if (!normalized) continue;
      this.remember(normalized, raw);
      batch.push({ normalized, raw });
    }
    if (batch.length) this.emit("messages", batch, { live });
  }

  remember(normalized, raw) {
    const list = this.recent.get(normalized.chatId) || [];
    if (!list.some((m) => m.normalized.id === normalized.id)) {
      list.push({ normalized, raw });
      list.sort((a, b) => a.normalized.timestamp - b.normalized.timestamp);
      if (list.length > RECENT_PER_CHAT) list.splice(0, list.length - RECENT_PER_CHAT);
      this.recent.set(normalized.chatId, list);
    }
    const chat = this.chats.get(normalized.chatId);
    if (chat) chat.lastMessageAt = Math.max(chat.lastMessageAt || 0, normalized.timestamp);
    else this.addChats([{ id: normalized.chatId, conversationTimestamp: normalized.timestamp }]);
  }

  recentMessages(chatId) {
    return this.recent.get(chatId) || [];
  }

  findRaw(key) {
    return (this.recent.get(key?.remoteJid) || []).find((m) => m.normalized.id === key?.id)?.raw || null;
  }

  // A picture or document's bytes, if it's small enough to keep.
  async downloadMedia(normalized, raw) {
    if (!normalized.media || !raw) return null;
    if (normalized.media.size && normalized.media.size > MAX_MEDIA_BYTES) return null;
    try {
      const data = await downloadMediaMessage(raw, "buffer", {}, {
        logger: makeLogger(this.log),
        reuploadRequest: this.sock?.updateMediaMessage,
      });
      if (!data?.length || data.length > MAX_MEDIA_BYTES) return null;
      return { name: normalized.media.fileName, mimeType: normalized.media.mimeType, data };
    } catch (err) {
      this.log.warn(`[whatsapp] couldn't download media for ${normalized.id}: ${err.message}`);
      return null;
    }
  }

  // Sends a text message; returns the message id it went out with.
  // beforeSend(id) runs before WhatsApp echoes the message back.
  async sendText(chatId, text, { beforeSend } = {}) {
    if (this.state !== "connected" || !this.sock) throw new Error("WhatsApp isn't connected.");
    if (!isStorableChat(chatId)) throw new Error("That isn't a WhatsApp chat this can send to.");
    const messageId = generateMessageIDV2(this.sock.user?.id);
    beforeSend?.(messageId);
    await this.sock.sendMessage(chatId, { text }, { messageId });
    return messageId;
  }
}
