import { ensureSchema, getPortalInvites, createPortalInvite, revokePortalInvite } from "../server/db.js";
import { requireAuth, canManageUsers, forbidClientRole } from "../server/auth.js";

// Manage client self-signup links — see server/db.js's
// createPortalInvite/claimPortalInvite for how a link turns into a
// real account. Anyone signed in (except a client) can see which
// links exist; only an owner/super_admin can mint or revoke one,
// mirroring api/users.js's invite-by-email gating.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getPortalInvites());
    }

    if (req.method === "POST") {
      if (!canManageUsers(user.role)) {
        return res.status(403).json({ error: "Only an owner or super admin can create invite links." });
      }
      const tags = Array.isArray(req.body?.tags) ? req.body.tags.filter(Boolean) : [];
      if (!tags.length) return res.status(400).json({ error: "Pick at least one tag for this invite." });
      const created = await createPortalInvite({ tags, createdBy: user.id });
      return res.status(201).json(created);
    }

    if (req.method === "DELETE") {
      if (!canManageUsers(user.role)) {
        return res.status(403).json({ error: "Only an owner or super admin can revoke invite links." });
      }
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: "Missing id" });
      await revokePortalInvite(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/portal-invites]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
