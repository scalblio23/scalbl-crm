import { ensureSchema, listInboundEmails, getInboundEmail, setInboundEmailUnread } from "../server/db.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";

// Conversations → Email. GET lists received emails (newest first);
// GET ?id= returns one with its body and marks it read; PATCH
// { id, unread } flips read state. A client role (or staff limited to
// some tags) only ever sees emails from contacts under their tags.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const scopeTags = scopeTagsForUser(user);
  try {
    await ensureSchema();
    if (req.method === "GET") {
      if (req.query?.id) {
        const email = await getInboundEmail(req.query.id, scopeTags);
        if (!email) return res.status(404).json({ error: "Email not found" });
        if (email.unread) {
          await setInboundEmailUnread(email.id, false, scopeTags);
          email.unread = false;
        }
        return res.status(200).json(email);
      }
      return res.status(200).json(await listInboundEmails(scopeTags));
    }
    if (req.method === "PATCH") {
      const { id, unread } = req.body || {};
      const email = await setInboundEmailUnread(id, unread, scopeTags);
      if (!email) return res.status(404).json({ error: "Email not found" });
      return res.status(200).json(email);
    }
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/emails]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
