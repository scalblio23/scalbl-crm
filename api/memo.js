// Inbox / Memo tab — chats between team members: one "Team" chat for
// everyone plus a private chat between any two of them (see
// src/components/MemoPanel.jsx). Never clients: client-role users and
// the API key (which isn't a person) are refused, and a private chat
// can only be read or written by its two members.
//
//   GET                         → { conversations: [{ key, kind, name, userId?, unread, lastMessage }], unreadTotal }
//   GET ?op=unread              → { unreadTotal }
//   GET ?conv=<key>[&after=id]  → { messages: [{ id, senderId, author, text, createdAt, files }] }  oldest first
//   GET ?fileId=                → an attached file (inline; ?download=1 to save it)
//   POST { action: "send", conv, text, files?: [{ name, mimeType, data (base64) }] } → { message }
//   POST { action: "mark-read", conv }
import {
  ensureSchema,
  getCsmPeople,
  getMemoOverview,
  getMemoMessages,
  addMemoMessage,
  markMemoRead,
  getMemoFile,
  memoOtherUserId,
  MEMO_TEAM,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

const MAX_TEXT_LENGTH = 5000;
// Same limits as CSM comments (the platform caps a request body ~4.5MB).
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 10;

function cleanFileName(name) {
  return (
    String(name || "file")
      .replace(/[\\/\r\n"]/g, "_")
      .trim()
      .slice(0, 200) || "file"
  );
}

export default async function handler(req, res) {
  const schema = ensureSchema();
  schema.catch(() => {});
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  if (user.isApiKey || !Number.isInteger(user.id)) {
    return res.status(403).json({ error: "The Inbox is for signed-in team members only." });
  }
  try {
    await schema;

    // A chat this user may use: the team chat, or a private chat they're
    // one of the two people in (and the other is still a team member).
    const canUse = async (conv) => {
      if (conv === MEMO_TEAM) return true;
      const other = memoOtherUserId(conv, user.id);
      if (!other) return false;
      return (await getCsmPeople()).some((p) => p.id === other);
    };

    if (req.method === "GET") {
      const fileId = Number(req.query?.fileId);
      if (fileId) {
        const file = await getMemoFile(fileId);
        if (!file || !(await canUse(file.conv))) return res.status(404).json({ error: "File not found" });
        const viewable = /^image\/(png|jpe?g|gif|webp|heic|heif|avif)$|^application\/pdf$/.test(file.mimeType);
        const disposition = viewable && !req.query?.download ? "inline" : "attachment";
        res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
        res.setHeader("Content-Length", String(file.data.length));
        res.setHeader(
          "Content-Disposition",
          `${disposition}; filename="${cleanFileName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`
        );
        res.setHeader("Cache-Control", "private, max-age=86400");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
        return res.status(200).end(file.data);
      }
      if (req.query?.op === "unread") {
        const { unreadTotal } = await getMemoOverview(user.id);
        return res.status(200).json({ unreadTotal });
      }
      const conv = String(req.query?.conv || "");
      if (conv) {
        if (!(await canUse(conv))) return res.status(404).json({ error: "Chat not found" });
        const after = Math.max(0, Number(req.query?.after) || 0);
        return res.status(200).json({ messages: await getMemoMessages(conv, after) });
      }
      return res.status(200).json(await getMemoOverview(user.id));
    }

    if (req.method === "POST") {
      const { action } = req.body || {};
      const conv = String(req.body?.conv || "");
      if (!(await canUse(conv))) return res.status(404).json({ error: "Chat not found" });

      if (action === "mark-read") {
        await markMemoRead(user.id, conv);
        return res.status(200).json({ ok: true });
      }

      if (action === "send") {
        const text = String(req.body?.text || "").trim();
        const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
        if (!text && !rawFiles.length) return res.status(400).json({ error: "Write something or attach a file first." });
        if (text.length > MAX_TEXT_LENGTH) return res.status(400).json({ error: "That message is too long." });
        if (rawFiles.length > MAX_FILES) return res.status(400).json({ error: "Too many files in one go." });
        const files = rawFiles.map((f) => ({
          name: cleanFileName(f?.name),
          mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(String(f?.mimeType || "")) ? String(f.mimeType) : "application/octet-stream",
          data: Buffer.from(String(f?.data || ""), "base64"),
        }));
        if (files.some((f) => !f.data.length)) return res.status(400).json({ error: "One of the files was empty." });
        if (files.reduce((n, f) => n + f.data.length, 0) > MAX_ATTACHMENT_BYTES) {
          return res.status(413).json({ error: "That's too big — attachments are limited to 3MB per message." });
        }
        const message = await addMemoMessage(conv, { id: user.id, name: user.name || user.email || "Someone" }, text, files);
        return res.status(201).json({ message });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/memo]", err);
    return res.status(err.status || 500).json({ error: err.message || "Database error" });
  }
}
