import { ensureSchema, getConversations, logCall } from "../server/db.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getConversations());
    }

    if (req.method === "POST") {
      const { leadId, name, text, time } = req.body || {};
      if (!leadId || !text) return res.status(400).json({ error: "Missing leadId or text" });
      const conversationId = await logCall({ leadId, name, text, time });
      return res.status(201).json({ conversationId });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/conversations]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
