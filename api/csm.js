// CSM tab — the clients being looked after, each with a retention
// confidence (0.1–1.0), a mood, and a timeline of comments (see
// src/components/CsmPanel.jsx). Internal only: client-role users never
// see this tab.
//
//   GET                         → { clients }
//   GET ?clientId=              → { entries }  (oldest first)
//   POST { action: "add-client", name }
//   POST { action: "comment", clientId, text }
//   POST { action: "confidence", clientId, value }   0.1 … 1.0
//   POST { action: "mood", clientId, mood }          see CSM_MOODS
//   DELETE ?clientId=
import {
  ensureSchema,
  getCsmClients,
  getCsmEntries,
  createCsmClient,
  deleteCsmClient,
  addCsmComment,
  setCsmConfidence,
  setCsmMood,
  CSM_MOODS,
} from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";

const MAX_COMMENT_LENGTH = 5000;

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  const author = user.name || user.email || "Someone";
  try {
    await ensureSchema();

    if (req.method === "GET") {
      const clientId = Number(req.query?.clientId);
      if (clientId) return res.status(200).json({ entries: await getCsmEntries(clientId) });
      return res.status(200).json({ clients: await getCsmClients() });
    }

    if (req.method === "POST") {
      const { action } = req.body || {};
      const clientId = Number(req.body?.clientId);

      if (action === "add-client") {
        const name = String(req.body?.name || "").trim();
        if (!name) return res.status(400).json({ error: "Give the client a name." });
        const result = await createCsmClient(name, author);
        if (result.error) return res.status(409).json({ error: result.error });
        return res.status(201).json(result);
      }

      if (!clientId) return res.status(400).json({ error: "Missing clientId" });

      if (action === "comment") {
        const text = String(req.body?.text || "").trim();
        if (!text) return res.status(400).json({ error: "Write something first." });
        if (text.length > MAX_COMMENT_LENGTH) return res.status(400).json({ error: "That comment is too long." });
        return res.status(201).json(await addCsmComment(clientId, text, author));
      }

      if (action === "confidence") {
        const value = Math.round(Number(req.body?.value) * 10) / 10;
        if (!(value >= 0.1 && value <= 1)) return res.status(400).json({ error: "Confidence goes from 0.1 to 1." });
        const result = await setCsmConfidence(clientId, value, author);
        if (!result) return res.status(404).json({ error: "Client not found" });
        return res.status(200).json(result);
      }

      if (action === "mood") {
        const mood = String(req.body?.mood || "");
        if (!CSM_MOODS.includes(mood)) return res.status(400).json({ error: "Unknown mood" });
        const result = await setCsmMood(clientId, mood, author);
        if (!result) return res.status(404).json({ error: "Client not found" });
        return res.status(200).json(result);
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "DELETE") {
      const clientId = Number(req.query?.clientId);
      if (!clientId) return res.status(400).json({ error: "Missing clientId" });
      await deleteCsmClient(clientId);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/csm]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
