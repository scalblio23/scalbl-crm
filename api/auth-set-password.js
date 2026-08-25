import { ensureSchema, getUserByEmail, claimUserPassword } from "../server/db.js";
import { hashPassword, createSessionCookie } from "../server/auth.js";

// POST /api/auth-set-password — lets someone claim their invited
// account (a users row that exists but has no password yet). Once
// claimed, this becomes a no-op for that email — use auth-login
// instead. Nobody can claim an email that was never invited.
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const existing = await getUserByEmail(email);
    if (!existing) {
      return res.status(404).json({ error: "That email hasn't been invited." });
    }
    if (existing.password_hash) {
      return res.status(409).json({ error: "This account already has a password — log in instead." });
    }

    const hash = await hashPassword(password);
    const row = await claimUserPassword(email, hash);
    if (!row) {
      return res.status(409).json({ error: "This account already has a password — log in instead." });
    }

    const user = { id: row.id, name: row.name, email: row.email };
    res.setHeader("Set-Cookie", createSessionCookie(user));
    return res.status(200).json({ user });
  } catch (err) {
    console.error("[api/auth-set-password]", err);
    return res.status(500).json({ error: err.message || "Could not set your password" });
  }
}
