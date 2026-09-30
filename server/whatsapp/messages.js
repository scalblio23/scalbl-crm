// Turns raw WhatsApp (Baileys) messages into the small shape the CRM
// stores: { id, chatId, fromMe, sender, text, timestamp, media }.
// Kept free of any connection state so it can be tested on its own.
import { getContentType, normalizeMessageContent } from "baileys";

// Message types that are protocol noise, not something a person wrote.
const IGNORED_TYPES = new Set([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "reactionMessage",
  "pollUpdateMessage",
  "messageContextInfo",
  "keepInChatMessage",
  "encReactionMessage",
  "editedMessage",
]);

// What a media message says in the timeline when it has no caption.
const MEDIA_LABELS = {
  imageMessage: "📷 Photo",
  videoMessage: "🎥 Video",
  audioMessage: "🎤 Voice message",
  stickerMessage: "Sticker",
  documentMessage: "📄 Document",
  documentWithCaptionMessage: "📄 Document",
  locationMessage: "📍 Location",
  liveLocationMessage: "📍 Live location",
  contactMessage: "👤 Contact",
  contactsArrayMessage: "👤 Contacts",
  pollCreationMessage: "📊 Poll",
  pollCreationMessageV3: "📊 Poll",
};

export function isStorableChat(chatId) {
  if (!chatId) return false;
  if (chatId === "status@broadcast") return false;
  if (chatId.endsWith("@newsletter") || chatId.endsWith("@broadcast")) return false;
  return chatId.endsWith("@g.us") || chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@lid");
}

export const isGroupChat = (chatId) => String(chatId || "").endsWith("@g.us");

// "61412345678@s.whatsapp.net" → "+61412345678"
export function phoneFromJid(jid) {
  const m = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid || ""));
  return m ? `+${m[1]}` : "";
}

function toSeconds(ts) {
  if (ts === null || ts === undefined) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts === "object" && typeof ts.toNumber === "function") return ts.toNumber();
  return Number(ts) || 0;
}

// Returns null for messages that shouldn't appear in a timeline.
// `names` resolves a jid to a display name (contacts / push names).
export function normalizeMessage(msg, names = () => "") {
  const chatId = msg?.key?.remoteJid;
  if (!isStorableChat(chatId) || !msg.message) return null;
  const content = normalizeMessageContent(msg.message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type || IGNORED_TYPES.has(type)) return null;

  const inner = content[type] || {};
  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    inner.caption ||
    (type === "conversation" ? content.conversation : "") ||
    "";

  let media = null;
  if (type === "imageMessage" || type === "documentMessage" || type === "stickerMessage") {
    media = {
      type,
      mimeType: inner.mimetype || (type === "imageMessage" ? "image/jpeg" : "application/octet-stream"),
      fileName:
        inner.fileName ||
        (type === "imageMessage" ? "photo.jpg" : type === "stickerMessage" ? "sticker.webp" : "document"),
      size: toSeconds(inner.fileLength),
    };
  }

  const fromMe = Boolean(msg.key.fromMe);
  const senderJid = fromMe ? "" : msg.key.participant || msg.participant || chatId;
  const sender = fromMe ? "" : msg.pushName || names(senderJid) || phoneFromJid(senderJid) || "Client";
  const label =
    MEDIA_LABELS[type] && type === "documentMessage" && inner.fileName ? `📄 ${inner.fileName}` : MEDIA_LABELS[type];

  const finalText = text || (media ? "" : label || "");
  if (!finalText && !media) return null;
  return {
    id: msg.key.id,
    chatId,
    fromMe,
    sender,
    text: finalText,
    placeholder: label || "",
    timestamp: toSeconds(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
    media,
  };
}
