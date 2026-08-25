import { ensureSchema, createApiKey, getApiKeys, deleteApiKey } from "../server/db.js";
import { getUserFromRequest, generateApiKey, hashApiKey } from "../server/auth.js";

// Deliberately session-only (not requireAuth, which also accepts an
// API key) — a key should never be able to mint itself more keys, or
// see/revoke anyone else's. Managing keys requires an actual logged-
// in person.
export default async function handler(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: "Log in to manage API keys." });
  }
  try {
    await ensureSchema();

    if (req.method === "GET") {
      return res.status(200).json(await getApiKeys());
    }

    if (req.method === "POST") {
      const label = String(req.body?.label || "").trim();
      if (!label) return res.status(400).json({ error: "Give the key a label (e.g. what agent it's for)." });
      const rawKey = generateApiKey();
      const row = await createApiKey({
        label,
        keyHash: hashApiKey(rawKey),
        keyPrefix: rawKey.slice(0, 11), // "sk_" + 8 hex chars — enough to recognize, not enough to brute-force
        createdBy: user.id,
      });
      // The raw key is only ever returned here, once — the database
      // only ever holds its hash.
      return res.status(201).json({
        id: row.id,
        label: row.label,
        key: rawKey,
        keyPrefix: row.key_prefix,
        createdAt: row.created_at,
      });
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteApiKey(id);
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/api-keys]", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
}
