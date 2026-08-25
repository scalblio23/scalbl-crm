import { ensureSchema, getCallLog, addCallLogEntry } from "../server/db.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getCallLog());
    }

    if (req.method === "POST") {
      const entry = await addCallLogEntry(req.body || {});
      return res.status(201).json(entry);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/call-log]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
