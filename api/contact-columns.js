import {
  ensureSchema,
  getContactColumns,
  createContactColumn,
  deleteContactColumn,
  updateContactColumnByKey,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      // Reading column definitions is fine for a client role — they
      // need it to render their own leads' criteria. Changing the
      // schema (add/retype/delete a column) is not, since it affects
      // every lead, not just theirs.
      return res.status(200).json(await getContactColumns());
    }
    if (forbidClientRole(user, res)) return;

    if (req.method === "POST") {
      const { label, type, options } = req.body || {};
      if (!label || !type) return res.status(400).json({ error: "Missing label or type" });
      const column = await createContactColumn({ label, type, options });
      return res.status(201).json(column);
    }

    if (req.method === "PATCH") {
      const { key, label, type, options } = req.body || {};
      if (!key) return res.status(400).json({ error: "Missing key" });
      const column = await updateContactColumnByKey(key, { label, type, options });
      if (!column) return res.status(404).json({ error: `No column with key "${key}"` });
      return res.status(200).json(column);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteContactColumn(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/contact-columns]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
