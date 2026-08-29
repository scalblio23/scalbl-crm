import { ensureSchema } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { handleGoogleDisconnect } from "../server/bookingApi.js";

// POST /api/google-disconnect — revokes the token with Google and
// drops the connection (and cached calendar list) for the logged-in user.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { status, body } = await handleGoogleDisconnect(user);
    if (status === 204) return res.status(204).end();
    return res.status(status).json(body);
  } catch (err) {
    console.error("[api/google-disconnect]", err);
    return res.status(500).json({ error: err.message || "Could not disconnect Google." });
  }
}
