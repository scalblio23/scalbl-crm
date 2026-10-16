// CRUD for the Calendars feature's calendars themselves — the
// Sidebar → Calendars → Add Calendar → Calendar settings flow. Full-
// access roles only, same as Clients/Dial lists.
import { ensureSchema, getCalendars, getCalendarById, createCalendar, updateCalendar, deleteCalendar } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { WORKFLOWS, workflowReadiness } from "../server/patientReminders.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    // Setup checklist for the "Patient reminders" settings tab.
    if (req.method === "GET" && req.query.workflowReadiness) {
      const calendar = await getCalendarById(req.query.workflowReadiness);
      if (!calendar) return res.status(404).json({ error: "Calendar not found" });
      return res.status(200).json({ checks: workflowReadiness(calendar) });
    }

    if (req.method === "GET") {
      return res.status(200).json(await getCalendars());
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Missing name" });
      const calendar = await createCalendar({ name: String(name).trim(), ownerUserId: user.isApiKey ? null : user.id });
      return res.status(201).json(calendar);
    }

    if (req.method === "PATCH") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const patch = req.body || {};
      if (
        Object.prototype.hasOwnProperty.call(patch, "confirmationWorkflow") &&
        patch.confirmationWorkflow !== null &&
        !Object.prototype.hasOwnProperty.call(WORKFLOWS, patch.confirmationWorkflow)
      ) {
        return res.status(400).json({ error: "Unknown confirmation workflow" });
      }
      const calendar = await updateCalendar(id, patch);
      if (!calendar) return res.status(404).json({ error: "Calendar not found" });
      return res.status(200).json(calendar);
    }

    if (req.method === "DELETE") {
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
