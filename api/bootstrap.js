import {
  ensureSchema,
  getClients,
  getClientColumns,
  getContacts,
  getContactColumns,
  getConversations,
  getDialLists,
  getCalledLeadIds,
  getCallLog,
} from "../server/db.js";
import { requireAuth } from "../server/auth.js";

// GET /api/bootstrap — everything the app needs on first load, in one
// request. Firing separate requests on mount meant separate
// serverless cold starts and separate new database connections in
// parallel — on a database that suspends when idle (common on free
// tiers), that compounded into a very slow first paint. One request
// only pays that cold-start/wake-up cost once.
export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    await ensureSchema();
    const [clients, clientColumns, contacts, contactColumns, conversations, dialLists, calledLeadIds, callLog] =
      await Promise.all([
        getClients(),
        getClientColumns(),
        getContacts(),
        getContactColumns(),
        getConversations(),
        getDialLists(),
        getCalledLeadIds(),
        getCallLog(),
      ]);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      clients,
      clientColumns,
      contacts,
      contactColumns,
      conversations,
      dialLists,
      calledLeadIds,
      callLog,
    });
  } catch (err) {
    console.error("[api/bootstrap]", err);
    res.status(500).json({ error: err.message || "Database error" });
  }
}
