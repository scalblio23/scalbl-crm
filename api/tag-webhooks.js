import {
  ensureSchema,
  getTagWebhooks,
  ensureTagWebhookToken,
  regenerateTagWebhookToken,
  deleteTagWebhook,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// Manages per-tag lead webhooks (see api/lead-webhook.js) — creating,
// listing, regenerating, and deleting them. Session-only, same
// capability tier as /api/dial-lists and /api/clients: a client role
// has no business managing webhook URLs at all.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getTagWebhooks());
    }

    if (req.method === "POST") {
      const tag = String(req.body?.tag || "").trim();
      if (!tag) return res.status(400).json({ error: "Missing tag" });
      return res.status(201).json(await ensureTagWebhookToken(tag));
    }

    if (req.method === "PATCH") {
      const tag = String(req.body?.tag || "").trim();
      if (!tag) return res.status(400).json({ error: "Missing tag" });
      const row = await regenerateTagWebhookToken(tag);
      if (!row) return res.status(404).json({ error: "That tag doesn't have a webhook yet" });
      return res.status(200).json(row);
    }

    if (req.method === "DELETE") {
      const tag = String(req.query.tag || "").trim();
      if (!tag) return res.status(400).json({ error: "Missing tag" });
      await deleteTagWebhook(tag);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/tag-webhooks]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
