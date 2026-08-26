import { ensureSchema, getCallLog, addCallLogEntry } from "../server/db.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getCallLog(scopeTagsForUser(user)));
    }

    if (req.method === "POST") {
      // user_id/user_name are attributed server-side from the
      // authenticated caller — never trusted from the request body —
      // so the Reports tab's per-user numbers can't be spoofed.
      const entry = await addCallLogEntry({
        ...(req.body || {}),
        userId: String(user.id),
        userName: user.name || user.email || "Unknown",
      });
      return res.status(201).json(entry);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/call-log]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
