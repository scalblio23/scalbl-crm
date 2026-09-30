// The CRM's side of the WhatsApp service (server/whatsappGateway.js on
// the voice server) — used by the CSM tab. Internal roles only.
//
//   GET  ?op=status   → { state, qr, me, error }  (state "unreachable" if the service can't be reached)
//   GET  ?op=chats    → { chats }
//   POST { op: "send", clientId, text }   → { messageId }  (to the client's linked chat)
//   POST { op: "logout" }                 → unlinks the WhatsApp account
import { ensureSchema, getCsmClientById } from "../server/db.js";
import { requireAuth, forbidClientRole } from "../server/auth.js";
import { callWhatsAppGateway } from "../server/voiceConfig.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  try {
    if (req.method === "GET") {
      const op = String(req.query?.op || "status");
      if (op === "status") {
        try {
          return res.status(200).json(await callWhatsAppGateway("/whatsapp/status"));
        } catch (err) {
          return res.status(200).json({ state: "unreachable", qr: null, me: null, error: err.message });
        }
      }
      if (op === "chats") return res.status(200).json(await callWhatsAppGateway("/whatsapp/chats"));
      return res.status(400).json({ error: "Unknown op" });
    }

    if (req.method === "POST") {
      const op = String(req.body?.op || "");
      if (op === "logout") return res.status(200).json(await callWhatsAppGateway("/whatsapp/logout", { method: "POST" }));
      if (op === "send") {
        const clientId = Number(req.body?.clientId);
        const text = String(req.body?.text || "").trim();
        if (!clientId || !text) return res.status(400).json({ error: "Missing client or message." });
        await ensureSchema();
        const client = await getCsmClientById(clientId);
        if (!client) return res.status(404).json({ error: "Client not found" });
        if (!client.whatsappChatId) return res.status(400).json({ error: `${client.name} isn't linked to a WhatsApp chat yet.` });
        const result = await callWhatsAppGateway("/whatsapp/send", {
          method: "POST",
          body: { chatId: client.whatsappChatId, text, author: user.name || user.email || "Team" },
        });
        return res.status(200).json(result);
      }
      return res.status(400).json({ error: "Unknown op" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[api/whatsapp]", err.message);
    return res.status(err.status && err.status < 500 ? err.status : 502).json({ error: err.message || "WhatsApp error" });
  }
}
