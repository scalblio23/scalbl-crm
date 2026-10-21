// CRUD for the Calendars feature's calendars themselves — the
// Sidebar → Calendars → Add Calendar → Calendar settings flow.
// Full-access roles see and manage every calendar. A client_team user
// sees only the calendars assigned to them, can edit those (connect
// Google/Outlook, set availability, …), and can create one of their
// own only while they have none assigned — it's assigned to them
// automatically. Assigning people and deleting calendars stays with
// full-access roles. A plain client keeps managing (creating and
// deleting) the calendars they own, plus any they're assigned to.
import { ensureSchema, getCalendars, getCalendarById, createCalendar, updateCalendar, deleteCalendar } from "../server/db.js";
import { requireAuth, forbidNonCalendarRole, hasFullAccess, canAccessCalendar } from "../server/auth.js";
import { WORKFLOWS, workflowReadiness } from "../server/patientReminders.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidNonCalendarRole(user, res)) return;
  const fullAccess = hasFullAccess(user.role);
  const isClientTeam = user.role === "client_team";
  try {
    await ensureSchema();

    // Setup checklist for the "Patient reminders" settings tab.
    if (req.method === "GET" && req.query.workflowReadiness) {
      const calendar = await getCalendarById(req.query.workflowReadiness);
      if (!canAccessCalendar(user, calendar)) return res.status(404).json({ error: "Calendar not found" });
      return res.status(200).json({ checks: workflowReadiness(calendar) });
    }

    if (req.method === "GET") {
      const calendars = await getCalendars();
      return res.status(200).json(fullAccess ? calendars : calendars.filter((c) => canAccessCalendar(user, c)));
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Missing name" });
      let assignedUserIds = [];
      if (isClientTeam) {
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
      if (patch.name !== undefined) {
        patch.name = String(patch.name || "").trim();
        if (!patch.name) return res.status(400).json({ error: "Calendar name can't be empty" });
      }
      // Pixel IDs are all digits; "" clears it.
      if (patch.metaPixelId !== undefined) {
        patch.metaPixelId = String(patch.metaPixelId || "").trim();
        if (patch.metaPixelId && !/^\d{5,20}$/.test(patch.metaPixelId)) {
          return res.status(400).json({ error: "Meta Pixel ID should be a number, e.g. 1234567890123456" });
        }
      }
      if (
        Object.prototype.hasOwnProperty.call(patch, "confirmationWorkflow") &&
        patch.confirmationWorkflow !== null &&
        !Object.prototype.hasOwnProperty.call(WORKFLOWS, patch.confirmationWorkflow)
      ) {
        return res.status(400).json({ error: "Unknown confirmation workflow" });
      }
      // Other CRM calendars to check for clashes: only ones this user
      // can access themselves (a client can't link someone else's
      // calendar and read its busy times through their booking page).
      if (Array.isArray(patch.clashCrmCalendarIds)) {
        const allowed = [];
        for (const otherId of patch.clashCrmCalendarIds.map(Number)) {
          if (otherId === Number(id)) continue;
          if (canAccessCalendar(user, await getCalendarById(otherId))) allowed.push(otherId);
        }
        patch.clashCrmCalendarIds = allowed;
      }
      const calendar = await updateCalendar(id, patch);
      if (!calendar) return res.status(404).json({ error: "Calendar not found" });
      return res.status(200).json(calendar);
    }

    if (req.method === "DELETE") {
      if (isClientTeam) return res.status(403).json({ error: "Only an admin can delete a calendar." });
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      if (!canAccessCalendar(user, await getCalendarById(id))) return res.status(404).json({ error: "Calendar not found" });
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
