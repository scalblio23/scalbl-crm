import { ensureSchema, importContactDataBatch } from "../server/db.js";
import { requireAuth } from "../server/auth.js";

// Bumps this function's execution time limit as far as Vercel allows
// (60s on Hobby, more on paid plans).
export const config = { maxDuration: 60 };

// POST /api/contacts-import — imports one page of the real lead data
// (from the team's spreadsheet) into contacts + contact_columns.
// Body: { offset?, limit? }. offset 0 (or omitted) wipes the existing
// contacts/columns first, then every call inserts up to `limit` rows
// starting at `offset` and returns { inserted, nextOffset, total,
// done }. Triggered by the "Import leads" button on the Contacts
// page, which drives the paging loop itself — a single request
// trying to insert everything at once was hitting Vercel's request
// timeout (504) for a batch this size, so this only ever does a
// few hundred rows per call.
export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { offset, limit } = req.body || {};
    const result = await importContactDataBatch({
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 500,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/contacts-import]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
