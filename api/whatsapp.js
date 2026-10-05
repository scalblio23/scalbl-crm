// The CRM's side of the WhatsApp service (server/whatsappGateway.js on
// the voice server) — used by the CSM tab. Internal roles only.
//
//   GET  ?op=status   → { state, qr, me, error, canManage }  (state "unreachable" if the service can't be reached;
//                       the QR code is only included for super admins)
//   GET  ?op=chats    → { chats }                          super admins only
//   POST { op: "send", clientId, text, author? }   → { messageId }  anyone — only ever to the client's assigned chat
//                                      (author: API key callers only — the name shown on the timeline)
//   POST { op: "logout" }                 → unlinks the WhatsApp account   super admins only
import { ensureSchema, getCsmClientById } from "../server/db.js";
import { requireAuth, forbidClientRole, canManageWhatsApp } from "../server/auth.js";
import { callWhatsAppGateway } from "../server/voiceConfig.js";

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (forbidClientRole(user, res)) return;
  const canManage = canManageWhatsApp(user.role);
  const adminOnly = () =>
    res.status(403).json({ error: "Only a super admin can manage the WhatsApp connection and chat assignments." });
  try {
    if (req.method === "GET") {
      const op = String(req.query?.op || "status");
      if (op === "status") {
        try {
          const status = await callWhatsAppGateway("/whatsapp/status");
          // Scanning the QR code connects the whole team's account.
          return res.status(200).json({ ...status, qr: canManage ? status.qr : null, canManage });
        } catch (err) {
          return res.status(200).json({ state: "unreachable", qr: null, me: null, error: err.message, canManage });
        }
      }
      if (op === "chats") {
        if (!canManage) return adminOnly();
        return res.status(200).json(await callWhatsAppGateway("/whatsapp/chats"));
      }
      return res.status(400).json({ error: "Unknown op" });
    }

    if (req.method === "POST") {
      const op = String(req.body?.op || "");
      if (op === "logout") {
        if (!canManage) return adminOnly();
        return res.status(200).json(await callWhatsAppGateway("/whatsapp/logout", { method: "POST" }));
      }
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
          body: {
            chatId: client.whatsappChatId,
            text,
            // Who the timeline shows as the sender (the API key may name itself).
            author: user.isApiKey
              ? String(req.body?.author || "").trim().slice(0, 80) || "API"
              : user.name || user.email || "Team",
          },
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
