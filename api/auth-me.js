import { ensureSchema } from "../server/db.js";
import { getSessionUser } from "../server/auth.js";

// GET /api/auth-me — who (if anyone) the session cookie belongs to,
// including their current role/allowedTags (looked up fresh, not
// baked into the cookie — see getSessionUser). Always 200; check
// `user` for null rather than relying on status.
export default async function handler(req, res) {
  await ensureSchema();
  const user = await getSessionUser(req);
  res.status(200).json({ user });
}
