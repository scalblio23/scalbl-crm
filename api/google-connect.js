import { ensureSchema } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { handleGoogleConnect } from "../server/bookingApi.js";

// GET /api/google-connect — returns the Google OAuth consent URL for
// the logged-in user to navigate to (a full-page redirect, not a
// fetch — see api/google-callback.js for the other end of the flow).
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    await ensureSchema();
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { status, body } = await handleGoogleConnect(user);
    return res.status(status).json(body);
  } catch (err) {
    console.error("[api/google-connect]", err);
    return res.status(500).json({ error: err.message || "Could not start the Google connection." });
  }
}
