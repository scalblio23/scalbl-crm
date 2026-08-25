import { ensureSchema, getClients } from "../server/db.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    return res.status(200).json(await getClients());
  } catch (err) {
    console.error("[api/clients]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
