import { getUserFromRequest } from "../server/auth.js";

// GET /api/auth-me — who (if anyone) the session cookie belongs to.
// Always 200; check `user` for null rather than relying on status.
export default function handler(req, res) {
  const user = getUserFromRequest(req);
  res.status(200).json({ user });
}
