import { ensureSchema, getCalledLeadIds, markLeadCalled } from "../server/db.js";
import { requireAuth } from "../server/auth.js";

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getCalledLeadIds());
    }

    if (req.method === "POST") {
      const { leadId } = req.body || {};
      if (!leadId) return res.status(400).json({ error: "Missing leadId" });
      await markLeadCalled(leadId);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/called-leads]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
