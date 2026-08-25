import { ensureSchema, getContacts, createContact, updateContact, deleteContacts } from "../server/db.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getContacts());
    }

    if (req.method === "POST") {
      const contact = await createContact(req.body || {});
      return res.status(201).json(contact);
    }

    if (req.method === "PATCH") {
      const { id, ...patch } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      const contact = await updateContact(id, patch);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      return res.status(200).json(contact);
    }

    if (req.method === "DELETE") {
      const ids = String(req.query.ids || "")
        .split(",")
        .map((id) => Number(id.trim()))
        .filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: "Missing ids" });
      await deleteContacts(ids);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/contacts]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
