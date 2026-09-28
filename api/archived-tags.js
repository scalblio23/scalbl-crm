import { ensureSchema, getArchivedTags, archiveTag, unarchiveTag } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// Tags hidden from the Contacts sidebar's tag list. POST { tag }
// archives one, DELETE ?tag= brings it back; both return the full
// list. The contacts under a tag are never touched.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getArchivedTags());
    }

    if (req.method === "POST") {
      const tag = String(req.body?.tag || "");
      if (!tag) return res.status(400).json({ error: "Missing tag" });
      await archiveTag(tag);
      return res.status(201).json(await getArchivedTags());
    }

    if (req.method === "DELETE") {
      const tag = String(req.query.tag || "");
      if (!tag) return res.status(400).json({ error: "Missing tag" });
      await unarchiveTag(tag);
      return res.status(200).json(await getArchivedTags());
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/archived-tags]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
