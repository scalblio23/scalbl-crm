// Connects the WhatsApp service to CSM timelines: every message in a
// chat that's linked to a CSM client is stored on that client's
// timeline (pictures and documents too, when small enough). Messages
// in chats nobody linked are never stored.
//
// `db` is { getCsmClientIdsForChat, addCsmWhatsAppMessage } — injected
// so this can be tested without a database.
const CACHE_MS = 15000;

export function createWhatsAppSync({ service, db, log = console }) {
  const linkedCache = new Map(); // chatId → { ids, at }
  // Messages sent from the CRM: WhatsApp id → the CRM user who sent it,
  // so the timeline says who wrote it rather than just "the team".
  const sentBy = new Map();
  let queue = Promise.resolve();

  async function clientsFor(chatId) {
    const hit = linkedCache.get(chatId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
    const ids = await db.getCsmClientIdsForChat(chatId);
    linkedCache.set(chatId, { ids, at: Date.now() });
    return ids;
  }

  async function store({ normalized: n, raw }, clientIds) {
    if (!clientIds.length) return [];
    const file = n.media ? await service.downloadMedia(n, raw) : null;
    const text = n.text || (file ? "" : n.placeholder || "");
    const author = n.fromMe ? sentBy.get(n.id) || "Team (WhatsApp)" : n.sender;
    const stored = [];
    for (const clientId of clientIds) {
      const entry = await db.addCsmWhatsAppMessage({
        clientId,
        waId: n.id,
        direction: n.fromMe ? "out" : "in",
        author,
        text,
        createdAt: new Date(n.timestamp * 1000),
        files: file ? [file] : [],
      });
      if (entry) stored.push(entry);
    }
    return stored;
  }

  // One at a time, in arrival order, so the timeline keeps WhatsApp's order.
  function enqueue(fn) {
    queue = queue.then(fn).catch((err) => log.error("[whatsapp] couldn't store a message:", err.message));
    return queue;
  }

  service.on("messages", (batch) => {
    enqueue(async () => {
      for (const item of batch) {
        const ids = await clientsFor(item.normalized.chatId);
        if (ids.length) await store(item, ids);
      }
    });
  });

  return {
    // After linking a client to a chat: fill its timeline with the
    // recent messages the service already has for that chat.
    backfill(clientId, chatId) {
      linkedCache.delete(chatId);
      return enqueue(async () => {
        let count = 0;
        for (const item of service.recentMessages(chatId)) count += (await store(item, [clientId])).length;
        return count;
      });
    },

    forgetLink(chatId) {
      linkedCache.delete(chatId);
    },

    async send({ chatId, text, author }) {
      const messageId = await service.sendText(chatId, text, {
        beforeSend: (id) => {
          sentBy.set(id, author);
          setTimeout(() => sentBy.delete(id), 10 * 60 * 1000).unref?.();
        },
      });
      return { messageId };
    },
  };
}
