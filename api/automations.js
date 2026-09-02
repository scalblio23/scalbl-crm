// CRUD for the Automations feature — Sidebar → Automations → Add
// Automation → builder (trigger + ordered actions). Full-access roles
// only, same as Calendars/Clients. Execution lives in
// server/automations.js, fired from api/contacts.js (contact tag
// changes) and api/calendar-book.js (a booking being created).
import {
  ensureSchema,
  getAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  getAutomationRunsByAutomationId,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();

    if (req.method === "GET" && req.query.runsFor) {
      return res.status(200).json(await getAutomationRunsByAutomationId(req.query.runsFor));
    }

    if (req.method === "GET") {
      return res.status(200).json(await getAutomations());
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "Missing name" });
      const automation = await createAutomation({ name: String(name).trim() });
      return res.status(201).json(automation);
    }

    if (req.method === "PATCH") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      const automation = await updateAutomation(id, req.body || {});
      if (!automation) return res.status(404).json({ error: "Automation not found" });
      return res.status(200).json(automation);
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteAutomation(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/automations]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
