import { ensureSchema, getDialLists, createDialList, addLeadsToDialList, deleteDialList } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getDialLists());
    }

    if (req.method === "POST") {
      const { name, leadIds } = req.body || {};
      if (!name || !Array.isArray(leadIds) || !leadIds.length) {
        return res.status(400).json({ error: "Missing name or leadIds" });
      }
      const list = await createDialList(name, leadIds);
      return res.status(201).json(list);
    }

    if (req.method === "PATCH") {
      const { id, leadIds } = req.body || {};
      if (!id || !Array.isArray(leadIds) || !leadIds.length) {
        return res.status(400).json({ error: "Missing id or leadIds" });
      }
      const list = await addLeadsToDialList(id, leadIds);
      if (!list) return res.status(404).json({ error: "Powerlist not found" });
      return res.status(200).json(list);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteDialList(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/dial-lists]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
