import { ensureSchema, getContacts, getContactById, createContact, updateContact, deleteContacts } from "../server/db.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";
import { runAutomationsForTrigger } from "../server/automations.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    const allowedTags = scopeTagsForUser(user);

    if (req.method === "GET") {
      return res.status(200).json(await getContacts(allowedTags));
    }

    if (req.method === "POST") {
      const body = req.body || {};
      // A client-role caller can only ever create leads under one of
      // their own tags — never blank (which would mean "untagged, and
      // therefore invisible to them and everyone else with their
      // role") and never someone else's.
      if (allowedTags && (!body.tag || !allowedTags.includes(body.tag))) {
        return res.status(403).json({ error: "You can only add leads under your own tag." });
      }
      const contact = await createContact(body);
      // Genuinely awaited, not fire-and-forget — waitUntil() only
      // actually extends the function's lifetime when Vercel's
      // runtime has wired up its special request context, which
      // isn't guaranteed on every plan/runtime; when it hasn't, it's
      // a silent no-op, and this response gets returned (freezing the
      // container) well before an automation chain (DB writes + a
      // real send) would finish. See api/calendar-book.js for the
      // same fix with more detail.
      if (contact.tag) {
        await runAutomationsForTrigger("contact_tag_added", { tag: contact.tag, contact }).catch((err) =>
          console.error("[api/contacts] automation trigger failed", err)
        );
      }
      return res.status(201).json(contact);
    }

    if (req.method === "PATCH") {
      const { id, ...patch } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      const existing = await getContactById(id);
      if (allowedTags) {
        if (!existing || !allowedTags.includes(existing.tag)) {
          return res.status(403).json({ error: "Not found" });
        }
        delete patch.tag; // the tag is how access is scoped — not theirs to change
      }
      const contact = await updateContact(id, patch);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      // "Tag added" = the tag actually changed to something new, not
      // every save that happens to leave it unchanged.
      if (patch.tag && patch.tag !== existing?.tag) {
        await runAutomationsForTrigger("contact_tag_added", { tag: patch.tag, contact }).catch((err) =>
          console.error("[api/contacts] automation trigger failed", err)
        );
      }
      return res.status(200).json(contact);
    }

    if (req.method === "DELETE") {
      if (allowedTags) {
        return res.status(403).json({ error: "Not allowed to delete leads." });
      }
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
