import { ensureSchema, resetContactImport, importContactDataBatch } from "../server/db.js";
import { requireAuth } from "../server/auth.js";

// Bumps this function's execution time limit as far as Vercel allows
// (60s on Hobby, more on paid plans).
export const config = { maxDuration: 60 };

// POST /api/contacts-import — imports the real lead data (from the
// team's spreadsheet) into contacts + contact_columns, one step at a
// time so no single request risks a 504:
//   1. { reset: true } — wipes existing contacts/columns and seeds
//      the column list, returns { total, columns }.
//   2. { offset, limit } (repeated, increasing offset) — inserts up
//      to `limit` rows starting at `offset`, returns
//      { inserted, nextOffset, total, done }.
// Triggered by the "Import leads" button on the Contacts page, which
// drives this two-step loop itself.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { reset, offset, limit } = req.body || {};
    if (reset) {
      return res.status(200).json(await resetContactImport());
    }
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
