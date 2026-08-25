import { ensureSchema, getContactColumns, createContactColumn, deleteContactColumn } from "../server/db.js";
import { requireAuth } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getContactColumns());
    }

    if (req.method === "POST") {
      const { label, type, options } = req.body || {};
      if (!label || !type) return res.status(400).json({ error: "Missing label or type" });
      const column = await createContactColumn({ label, type, options });
      return res.status(201).json(column);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteContactColumn(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/contact-columns]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
