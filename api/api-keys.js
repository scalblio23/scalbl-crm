import { ensureSchema, getApiKey, regenerateApiKey, deleteApiKey } from "../server/db.js";
import { getSessionUser, generateApiKey, hashApiKey } from "../server/auth.js";

// A single global API key — see server/db.js's getApiKey/
// regenerateApiKey. It's shown in full any time it's fetched (not
// just once at creation), since it now doubles as the token pasted
// into /api/lead-webhook?token=... URLs, which need to stay copyable
// indefinitely.
//
// Deliberately session-only (not requireAuth, which also accepts an
// API key) — a key should never be able to regenerate itself. Also
// blocked for the client role — a key is equivalent to full admin
// access (see getUserFromApiKey), so letting a tag-scoped client
// mint one would be a straight-up privilege escalation around their
// own data scoping.
export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Log in to manage the API key." });
  }
  if (user.role === "client") {
    return res.status(403).json({ error: "Not available on this account." });
  }
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getApiKey());
    }

    // POST both creates the first key and regenerates an existing
    // one — there's only ever at most one row (see regenerateApiKey).
    if (req.method === "POST") {
      const rawKey = generateApiKey();
      const row = await regenerateApiKey({
        key: rawKey,
        keyHash: hashApiKey(rawKey),
        keyPrefix: rawKey.slice(0, 11), // "sk_" + 8 hex chars — enough to recognize, not enough to brute-force
        createdBy: user.id,
      });
      return res.status(201).json(row);
    }

    if (req.method === "DELETE") {
      await deleteApiKey();
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/api-keys]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
