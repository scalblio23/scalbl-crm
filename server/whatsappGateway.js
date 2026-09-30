// WhatsApp service — a long-running process (npm run whatsapp-gateway)
// that keeps the team's WhatsApp account linked (like WhatsApp Web)
// and syncs chats linked to CSM clients into their timelines. It runs
// on the same always-on server as the voice gateway, as its own
// service, so restarting one never affects the other.
//
// HTTP (all under /whatsapp; everything but /whatsapp/health needs a
// token from the CRM backend — see server/voiceConfig.js):
//   GET  /whatsapp/health                      → { ok, state }
//   GET  /whatsapp/status                      → { state, qr, me, error }
//   GET  /whatsapp/chats                       → { chats: [{ id, name, isGroup, lastMessageAt }] }
//   POST /whatsapp/send      { chatId, text, author } → { messageId }
//   POST /whatsapp/backfill  { clientId, chatId }     → { stored }
//   POST /whatsapp/logout
import http from "http";
import path from "path";
import dotenv from "dotenv";
import { WhatsAppService } from "./whatsapp/service.js";
import { createWhatsAppSync } from "./whatsapp/sync.js";
import { verifyWhatsAppToken } from "./voiceConfig.js";
import { isDbConfigured, ensureSchema, getCsmClientIdsForChat, addCsmWhatsAppMessage } from "./db.js";

dotenv.config();

const PORT = Number(process.env.WHATSAPP_GATEWAY_PORT || 3003);
const DATA_DIR = path.resolve(process.env.WHATSAPP_DATA_DIR || "whatsapp-data");
const MAX_BODY = 64 * 1024;

export function createWhatsAppServer({ service, sync, verifyToken = verifyWhatsAppToken, log = console }) {
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("Request too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://whatsapp");
    const route = `${req.method} ${url.pathname.replace(/\/+$/, "")}`;
    try {
      if (route === "GET /whatsapp/health") return json(res, 200, { ok: service.state === "connected", state: service.state });

      const auth = String(req.headers.authorization || "");
      if (!verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "")) return json(res, 401, { error: "Not authorised" });

      if (route === "GET /whatsapp/status") return json(res, 200, service.status());
      if (route === "GET /whatsapp/chats") return json(res, 200, { chats: service.listChats() });
      if (route === "POST /whatsapp/logout") {
        await service.logout();
        return json(res, 200, { ok: true });
      }
      if (route === "POST /whatsapp/send") {
        const body = await readBody(req);
        const text = String(body.text || "").trim();
        if (!body.chatId || !text) return json(res, 400, { error: "Missing chat or message." });
        if (text.length > 4000) return json(res, 400, { error: "That message is too long." });
        return json(res, 200, await sync.send({ chatId: String(body.chatId), text, author: String(body.author || "") }));
      }
      if (route === "POST /whatsapp/backfill") {
        const body = await readBody(req);
        const clientId = Number(body.clientId);
        if (!clientId || !body.chatId) return json(res, 400, { error: "Missing client or chat." });
        const stored = await sync.backfill(clientId, String(body.chatId));
        return json(res, 200, { stored: stored || 0 });
      }
      return json(res, 404, { error: "Not found" });
    } catch (err) {
      log.error("[whatsapp] request failed:", err.message);
      return json(res, 500, { error: err.message || "Something went wrong" });
    }
  });
}

// Started directly (not imported by a test).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!process.env.VOICE_GATEWAY_SECRET && !process.env.SESSION_SECRET) {
    console.error("✖ WhatsApp service can't start — set VOICE_GATEWAY_SECRET (the same one the CRM uses).");
    process.exit(1);
  }
  if (!isDbConfigured()) {
    console.error("✖ WhatsApp service can't start — set POSTGRES_URL (messages are written to the CRM database).");
    process.exit(1);
  }
  await ensureSchema();
  const service = new WhatsAppService({ dataDir: DATA_DIR });
  const sync = createWhatsAppSync({ service, db: { getCsmClientIdsForChat, addCsmWhatsAppMessage } });
  service.on("status", (s) => s.state !== "qr" && console.log(`[whatsapp] ${s.state}${s.error ? ` (${s.error})` : ""}`));
  const server = createWhatsAppServer({ service, sync });
  server.listen(PORT, () => {
    console.log(`WhatsApp service listening on :${PORT} (data in ${DATA_DIR})`);
    service.start().catch((err) => console.error("[whatsapp] couldn't start:", err.message));
  });
  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
