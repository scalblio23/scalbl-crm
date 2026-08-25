import { ensureSchema, getUserByEmail } from "../server/db.js";
import { verifyPassword, createSessionCookie } from "../server/auth.js";

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

    const row = await getUserByEmail(email);
    if (!row || !row.password_hash) {
      // Same message either way — don't reveal which emails exist.
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });

    const user = { id: row.id, name: row.name, email: row.email };
    res.setHeader("Set-Cookie", createSessionCookie(user));
    return res.status(200).json({ user });
  } catch (err) {
    console.error("[api/auth-login]", err);
    return res.status(500).json({ error: err.message || "Could not log in" });
  }
}
