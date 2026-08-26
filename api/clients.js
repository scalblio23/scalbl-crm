import { ensureSchema, getClients, createClient, updateClient, deleteClients } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getClients());
    }

    if (req.method === "POST") {
      const client = await createClient(req.body || {});
      return res.status(201).json(client);
    }

    if (req.method === "PATCH") {
      const { id, ...patch } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      const client = await updateClient(id, patch);
      if (!client) return res.status(404).json({ error: "Client not found" });
      return res.status(200).json(client);
    }

    if (req.method === "DELETE") {
      const ids = String(req.query.ids || "")
        .split(",")
        .map((id) => Number(id.trim()))
        .filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: "Missing ids" });
      await deleteClients(ids);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/clients]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
