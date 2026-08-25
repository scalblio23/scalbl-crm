import { ensureSchema, getDialLists, createDialList, deleteDialList } from "../server/db.js";

export default async function handler(req, res) {
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

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteDialList(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/dial-lists]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
