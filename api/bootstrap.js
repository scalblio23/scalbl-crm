import {
  ensureSchema,
  getClients,
  getClientColumns,
  getContacts,
  getContactColumns,
  getConversations,
  getDialLists,
  getCallLog,
} from "../server/db.js";
import { requireAuth, scopeTagsForUser } from "../server/auth.js";

// GET /api/bootstrap — everything the app needs on first load, in one
// request. Firing separate requests on mount meant separate
// serverless cold starts and separate new database connections in
// parallel — on a database that suspends when idle (common on free
// tiers), that compounded into a very slow first paint. One request
// only pays that cold-start/wake-up cost once.
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    const allowedTags = scopeTagsForUser(user);
    // A client-role user never sees the Clients org list or Powerlists
    // — those aren't on their tab list at all — so skip fetching them
    // rather than shipping data down just to hide it client-side.
    const scoped = allowedTags !== null;
    const [clients, clientColumns, contacts, contactColumns, conversations, dialLists, callLog] = await Promise.all([
      scoped ? [] : getClients(),
      scoped ? [] : getClientColumns(),
      getContacts(allowedTags),
      getContactColumns(),
      getConversations(allowedTags),
      scoped ? [] : getDialLists(),
      getCallLog(allowedTags),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      clients,
      clientColumns,
      contacts,
      contactColumns,
      conversations,
      dialLists,
      callLog,
    });
  } catch (err) {
    console.error("[api/bootstrap]", err);
    res.status(500).json({ error: err.message || "Database error" });
  }
}
