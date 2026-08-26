import { ensureSchema, importClientData } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// POST /api/clients-import — wipes existing clients + column
// definitions and replaces them with the real client-list data from
// the team's CSV. Triggered by the "Import client list" button on
// the Clients page. Safe to re-run.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const result = await importClientData();
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/clients-import]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
