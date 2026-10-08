// CRUD for the Calendars feature's calendars themselves — the
// Sidebar → Calendars → Add Calendar → Calendar settings flow.
// Full-access roles see and manage every calendar. A client_team user
// sees only the calendars assigned to them, can edit those (connect
// Google/Outlook, set availability, …), and can create one of their
// own only while they have none assigned — it's assigned to them
// automatically. Assigning people and deleting calendars stays with
// full-access roles. A plain client gets nothing here.
import { ensureSchema, getCalendars, getCalendarById, createCalendar, updateCalendar, deleteCalendar } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, hasFullAccess, canAccessCalendar } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  const fullAccess = hasFullAccess(user.role);
  try {
    await ensureSchema();

    if (req.method === "GET") {
      const calendars = await getCalendars();
      return res.status(200).json(fullAccess ? calendars : calendars.filter((c) => canAccessCalendar(user, c)));
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Missing name" });
      let assignedUserIds = [];
      if (!fullAccess) {
        const mine = (await getCalendars()).filter((c) => canAccessCalendar(user, c));
        if (mine.length) {
          return res.status(403).json({ error: "You already have a calendar — ask an admin if you need another." });
        }
        assignedUserIds = [Number(user.id)];
      }
      const calendar = await createCalendar({
        name: String(name).trim(),
        ownerUserId: user.isApiKey ? null : user.id,
        assignedUserIds,
      });
      return res.status(201).json(calendar);
    }

    if (req.method === "PATCH") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const existing = await getCalendarById(id);
      if (!canAccessCalendar(user, existing)) return res.status(404).json({ error: "Calendar not found" });
      const patch = { ...(req.body || {}) };
      if (!fullAccess) delete patch.assignedUserIds;
      const calendar = await updateCalendar(id, patch);
      if (!calendar) return res.status(404).json({ error: "Calendar not found" });
      return res.status(200).json(calendar);
    }

    if (req.method === "DELETE") {
      if (!fullAccess) return res.status(403).json({ error: "Only an admin can delete a calendar." });
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteCalendar(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/calendars]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
