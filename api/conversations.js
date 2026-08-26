import { ensureSchema, getConversations, getContactById, logCall, deleteConversations } from "../server/db.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    const allowedTags = scopeTagsForUser(user);

    if (req.method === "GET") {
      return res.status(200).json(await getConversations(allowedTags));
    }

    if (req.method === "POST") {
      const { leadId, name, text, time } = req.body || {};
      if (!leadId || !text) return res.status(400).json({ error: "Missing leadId or text" });
      if (allowedTags) {
        const lead = await getContactById(leadId);
        if (!lead || !allowedTags.includes(lead.tag)) {
          return res.status(403).json({ error: "Not found" });
        }
      }
      const conversationId = await logCall({ leadId, name, text, time });
      return res.status(201).json({ conversationId });
    }

    if (req.method === "DELETE") {
      if (allowedTags) {
        return res.status(403).json({ error: "Not allowed to delete conversations." });
      }
      const ids = String(req.query.ids || "")
        .split(",")
        .map((id) => Number(id.trim()))
        .filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: "Missing ids" });
      await deleteConversations(ids);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/conversations]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
