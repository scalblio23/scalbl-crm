// CRUD for Contacts sidebar tag folders — a purely organizational
// grouping layer over the free-text tags already on contacts (see
// server/db.js's tag_folders table comment). GET is open to any
// logged-in role (including client, so their own narrower tag list
// can still show grouped) — only creating/renaming/deleting folders
// or reassigning which tags belong to one is restricted, since that's
// an org-wide organization decision, not a per-client one.
import {
  ensureSchema,
  getTagFolders,
  createTagFolder,
  updateTagFolder,
  deleteTagFolder,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getTagFolders());
    }

    if (forbidClientRole(user, res)) return;

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Missing name" });
      const folder = await createTagFolder({ name: String(name).trim() });
      return res.status(201).json(folder);
    }

    if (req.method === "PATCH") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const folder = await updateTagFolder(id, req.body || {});
      if (!folder) return res.status(404).json({ error: "Folder not found" });
      return res.status(200).json(folder);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteTagFolder(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/tag-folders]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
