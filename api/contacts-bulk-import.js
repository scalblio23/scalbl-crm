import { ensureSchema, importContactsBulk } from "../server/db.js";
import { requireAuth } from "../server/auth.js";

// POST /api/contacts-bulk-import — bulk-loads leads from an external
// source (e.g. the Google Sheets lead tracker). Body: an array of
// { name, email, phone, client, status, notes, leadDate, tag, fields }.
// `fields` keys become contact_columns automatically. Large imports
// should be sent in batches (a few hundred records at a time) rather
// than one huge request, to stay under the serverless body-size limit.
export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: "Expected a non-empty array of contact records" });
    }
    const result = await importContactsBulk(records);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[api/contacts-bulk-import]", err);
    return res.status(500).json({ error: err.message || "Import failed" });
  }
}
