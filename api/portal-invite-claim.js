import { ensureSchema, getPortalInviteByToken, claimPortalInvite } from "../server/db.js";
import { hashPassword, createSessionCookie } from "../server/auth.js";

// Public — the landing point for a client's self-signup link (minted
// by api/portal-invites.js). GET lets the frontend show which tags
// the invite grants before the form is filled in; POST creates the
// account and logs the new user straight in, the same way
// api/auth-set-password.js does for a named invite.
export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === "GET") {
      const token = String(req.query?.token || "").trim();
      if (!token) return res.status(400).json({ error: "Missing token" });
      const invite = await getPortalInviteByToken(token);
      if (!invite) return res.status(404).json({ error: "This invite link is invalid or has been revoked." });
      return res.status(200).json({ tags: invite.tags || [] });
    }

    if (req.method === "POST") {
      const { token, name, email, password } = req.body || {};
      if (!token || !name || !email || !password) {
        return res.status(400).json({ error: "Missing name, email or password" });
      }
      if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

      const hash = await hashPassword(password);
      const result = await claimPortalInvite({ token, name: String(name).trim(), email, passwordHash: hash });
      if (result.error === "invalid") {
        return res.status(404).json({ error: "This invite link is invalid or has been revoked." });
      }
      if (result.error === "exists") {
        return res.status(409).json({ error: "An account with that email already exists — log in instead." });
      }
      res.setHeader("Set-Cookie", createSessionCookie(result.user));
      return res.status(200).json({ user: result.user });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/portal-invite-claim]", err);
    return res.status(500).json({ error: err.message || "Could not create your account" });
  }
}
