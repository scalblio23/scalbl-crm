import { ensureSchema, importContactData } from "../server/db.js";
import { requireAuth } from "../server/auth.js";

// Bumps this function's execution time limit as far as Vercel allows
// (60s on Hobby, more on paid plans) — a several-thousand-row import
// can run long. If it still times out on the deployed site, use the
// local dev server instead (see note below).
export const config = { maxDuration: 60 };

// POST /api/contacts-import — wipes existing contacts + column
// definitions and replaces them with the real lead data imported from
// the team's spreadsheet. Triggered by the "Import leads" button on
// the Contacts page. Safe to re-run.
//
// This is a big one-off write (thousands of rows) — if it's timing
// out on the deployed site, run it against the local dev server
// instead (npm run server, pointed at the same POSTGRES_URL via
// .env), which has no serverless execution-time limit.
export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const result = await importContactData();
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/contacts-import]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
