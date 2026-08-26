import { ensureSchema, getUsers, getUserById, inviteUser, updateUser, deleteUserById } from "../server/db.js";
import { requireAuth, canManageUsers, canDeleteUser, ROLES } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    // Anyone signed in can see the roster (so an admin knows who has
    // access) — only owner/super_admin can change it.
    if (req.method === "GET") {
      return res.status(200).json(await getUsers());
    }

    if (req.method === "POST") {
      if (!canManageUsers(user.role)) {
        return res.status(403).json({ error: "Only an owner or super admin can invite users." });
      }
      const { name, email, role, allowedTags } = req.body || {};
      if (!name || !email) return res.status(400).json({ error: "Missing name or email" });
      if (role && (role === "owner" || !ROLES.includes(role))) {
        return res.status(400).json({ error: "Invalid role" });
      }
      const created = await inviteUser({ name, email, role, allowedTags });
      if (!created) return res.status(409).json({ error: "That email is already invited." });
      return res.status(201).json(created);
    }

    if (req.method === "PATCH") {
      if (!canManageUsers(user.role)) {
        return res.status(403).json({ error: "Only an owner or super admin can edit users." });
      }
      const { id, name, role, allowedTags } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      if (role && (role === "owner" || !ROLES.includes(role))) {
        return res.status(400).json({ error: "Invalid role" });
      }
      const target = await getUserById(id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.role === "owner") {
        return res.status(403).json({ error: "The owner's account can't be edited." });
      }
      const updated = await updateUser(id, { name, role, allowedTags });
      return res.status(200).json(updated);
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: "Missing id" });
      if (id === Number(user.id)) {
        return res.status(400).json({ error: "You can't delete your own account." });
      }
      const target = await getUserById(id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!canDeleteUser(user.role, target.role)) {
        return res.status(403).json({ error: "Not allowed to delete this user." });
      }
      await deleteUserById(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/users]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
