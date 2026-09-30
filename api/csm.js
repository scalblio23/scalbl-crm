// CSM tab — the clients being looked after, each with a retention
// confidence (0.1–1.0), a mood, and a timeline of comments (see
// src/components/CsmPanel.jsx). Internal only: client-role users never
// see this tab.
//
//   GET                         → { clients }
//   GET ?clientId=              → { entries }  (oldest first; each has files: [{ id, name, mimeType, size }])
//   GET ?fileId=                → the attached file itself (inline; ?download=1 to save it)
//   POST { action: "add-client", name }
//   POST { action: "comment", clientId, text, files?: [{ name, mimeType, data (base64) }] }
//   POST { action: "confidence", clientId, value }   0.1 … 1.0
//   POST { action: "mood", clientId, mood }          see CSM_MOODS
//   POST { action: "link-whatsapp", clientId, chatId, chatName }   chatId null unlinks
//   DELETE ?clientId=
import {
  ensureSchema,
  getCsmClients,
  getCsmEntries,
  getCsmFile,
  createCsmClient,
  deleteCsmClient,
  addCsmComment,
  setCsmConfidence,
  setCsmMood,
  linkCsmWhatsApp,
  CSM_MOODS,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { callWhatsAppGateway } from "../server/voiceConfig.js";

const MAX_COMMENT_LENGTH = 5000;
// The whole request has to fit under the platform's ~4.5MB body limit
// with base64's ⅓ overhead, so attachments are capped at 3MB in total
// per comment (the browser shrinks pictures and sends big batches as
// separate comments to stay under it).
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_FILES_PER_COMMENT = 10;

function cleanFileName(name) {
  return (
    String(name || "file")
      .replace(/[\\/\r\n"]/g, "_")
      .trim()
      .slice(0, 200) || "file"
  );
}

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  const author = user.name || user.email || "Someone";
  try {
    await ensureSchema();

    if (req.method === "GET") {
      const fileId = Number(req.query?.fileId);
      if (fileId) {
        const file = await getCsmFile(fileId);
        if (!file) return res.status(404).json({ error: "File not found" });
        // Pictures and PDFs open in the browser; anything else downloads.
        const viewable = /^image\/(png|jpe?g|gif|webp|heic|heif|avif)$|^application\/pdf$/.test(file.mimeType);
        const disposition = viewable && !req.query?.download ? "inline" : "attachment";
        res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
        res.setHeader("Content-Length", String(file.data.length));
        res.setHeader(
          "Content-Disposition",
          `${disposition}; filename="${cleanFileName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`
        );
        res.setHeader("Cache-Control", "private, max-age=86400");
        // Never let an uploaded file run as a page on our domain.
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
        return res.status(200).end(file.data);
      }
      const clientId = Number(req.query?.clientId);
      if (clientId) return res.status(200).json({ entries: await getCsmEntries(clientId) });
      return res.status(200).json({ clients: await getCsmClients() });
    }

    if (req.method === "POST") {
      const { action } = req.body || {};
      const clientId = Number(req.body?.clientId);

      if (action === "add-client") {
        const name = String(req.body?.name || "").trim();
        if (!name) return res.status(400).json({ error: "Give the client a name." });
        const result = await createCsmClient(name, author);
        if (result.error) return res.status(409).json({ error: result.error });
        return res.status(201).json(result);
      }

      if (!clientId) return res.status(400).json({ error: "Missing clientId" });

      if (action === "comment") {
        const text = String(req.body?.text || "").trim();
        const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
        if (!text && !rawFiles.length) return res.status(400).json({ error: "Write something or attach a file first." });
        if (text.length > MAX_COMMENT_LENGTH) return res.status(400).json({ error: "That comment is too long." });
        if (rawFiles.length > MAX_FILES_PER_COMMENT) return res.status(400).json({ error: "Too many files in one go." });
        const files = rawFiles.map((f) => ({
          name: cleanFileName(f?.name),
          mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(String(f?.mimeType || "")) ? String(f.mimeType) : "application/octet-stream",
          data: Buffer.from(String(f?.data || ""), "base64"),
        }));
        if (files.some((f) => !f.data.length)) return res.status(400).json({ error: "One of the files was empty." });
        const total = files.reduce((sum, f) => sum + f.data.length, 0);
        if (total > MAX_ATTACHMENT_BYTES) {
          return res.status(413).json({ error: "That's too big — attachments are limited to 3MB per comment." });
        }
        return res.status(201).json(await addCsmComment(clientId, text, author, files));
      }

      if (action === "confidence") {
        const value = Math.round(Number(req.body?.value) * 10) / 10;
        if (!(value >= 0.1 && value <= 1)) return res.status(400).json({ error: "Confidence goes from 0.1 to 1." });
        const result = await setCsmConfidence(clientId, value, author);
        if (!result) return res.status(404).json({ error: "Client not found" });
        return res.status(200).json(result);
      }

      if (action === "link-whatsapp") {
        const chatId = req.body?.chatId ? String(req.body.chatId) : null;
        const chatName = String(req.body?.chatName || "").slice(0, 200);
        const result = await linkCsmWhatsApp(clientId, chatId, chatName, author);
        if (!result) return res.status(404).json({ error: "Client not found" });
        // Fill the timeline with the chat's recent messages. Best effort:
        // the link itself is saved either way, and new messages arrive
        // regardless.
        if (chatId) {
          result.backfilled = await callWhatsAppGateway("/whatsapp/backfill", { method: "POST", body: { clientId, chatId } })
            .then((r) => r.stored || 0)
            .catch(() => 0);
        }
        return res.status(200).json(result);
      }

      if (action === "mood") {
        const mood = String(req.body?.mood || "");
        if (!CSM_MOODS.includes(mood)) return res.status(400).json({ error: "Unknown mood" });
        const result = await setCsmMood(clientId, mood, author);
        if (!result) return res.status(404).json({ error: "Client not found" });
        return res.status(200).json(result);
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "DELETE") {
      const clientId = Number(req.query?.clientId);
      if (!clientId) return res.status(400).json({ error: "Missing clientId" });
      await deleteCsmClient(clientId);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/csm]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
