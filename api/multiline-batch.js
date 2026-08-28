import { ensureSchema, getMultilineBatchWithCalls } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

// GET /api/multiline-batch?id=<batchId> — polled by the frontend
// (every ~1s) while a multi-line dial is in flight, to find out once
// someone's answered (status: "connected", with which lead) or every
// line has been exhausted with nobody picking up ("no-answer").
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const id = Number(req.query?.id);
    if (!id) return res.status(400).json({ error: "Missing id" });
    const batch = await getMultilineBatchWithCalls(id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(batch);
  } catch (err) {
    console.error("[api/multiline-batch]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
