// WhatsApp service + CSM sync + HTTP API, against a fake WhatsApp
// connection (the real one needs a phone to scan the QR code).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { WhatsAppService } from "../service.js";
import { createWhatsAppSync } from "../sync.js";
import { normalizeMessage } from "../messages.js";
import { createWhatsAppServer } from "../../whatsappGateway.js";

const quiet = { log() {}, warn() {}, error() {} };
const GROUP = "120363000000000001@g.us";
const JANE = "61400000001@s.whatsapp.net";
const OTHER = "61400000002@s.whatsapp.net";

// Just enough of a Baileys socket for the service.
function fakeSocketFactory() {
  const made = [];
  const factory = (config) => {
    const ev = new EventEmitter();
    const sock = {
      config,
      ev,
      user: { id: "61480000000:12@s.whatsapp.net", name: "Scalbl Team" },
      sent: [],
      async sendMessage(jid, content, opts) {
        sock.sent.push({ jid, content, opts });
        // WhatsApp echoes our own message back as an upsert.
        ev.emit("messages.upsert", {
          type: "append",
          messages: [{ key: { remoteJid: jid, fromMe: true, id: opts.messageId }, message: { conversation: content.text }, messageTimestamp: 1790000100 }],
        });
        return {};
      },
      async logout() {
        sock.loggedOut = true;
      },
      end() {},
      async groupFetchAllParticipating() {
        return { [GROUP]: { id: GROUP, subject: "Cable Co × Scalbl" } };
      },
    };
    made.push(sock);
    return sock;
  };
  factory.made = made;
  return factory;
}

function fakeDb(links) {
  const stored = [];
  return {
    stored,
    async getCsmClientIdsForChat(chatId) {
      return links[chatId] || [];
    },
    async addCsmWhatsAppMessage(row) {
      if (stored.some((s) => s.clientId === row.clientId && s.waId === row.waId)) return null;
      stored.push(row);
      return { id: stored.length, ...row };
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

async function startService() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-test-"));
  const factory = fakeSocketFactory();
  const service = new WhatsAppService({
    dataDir,
    log: quiet,
    makeSocket: factory,
    authState: async () => ({ state: {}, saveCreds() {} }),
  });
  await service.start();
  return { service, sock: factory.made[0] };
}

test("normalizes text, captions, media and skips protocol noise", () => {
  const base = { key: { remoteJid: GROUP, fromMe: false, id: "A1", participant: JANE }, pushName: "Jane", messageTimestamp: 1790000000 };
  assert.deepEqual(
    (({ id, chatId, sender, text, fromMe }) => ({ id, chatId, sender, text, fromMe }))(normalizeMessage({ ...base, message: { conversation: "Hi team" } })),
    { id: "A1", chatId: GROUP, sender: "Jane", text: "Hi team", fromMe: false }
  );
  const photo = normalizeMessage({ ...base, message: { imageMessage: { mimetype: "image/jpeg", caption: "Our new ad", fileLength: 2048 } } });
  assert.equal(photo.text, "Our new ad");
  assert.equal(photo.media.mimeType, "image/jpeg");
  const voice = normalizeMessage({ ...base, message: { audioMessage: { seconds: 4 } } });
  assert.equal(voice.text, "🎤 Voice message");
  assert.equal(normalizeMessage({ ...base, message: { reactionMessage: { text: "👍" } } }), null);
  assert.equal(normalizeMessage({ ...base, key: { ...base.key, remoteJid: "status@broadcast" }, message: { conversation: "x" } }), null);
});

test("QR → connected, chat list with names, and syncing only linked chats", async () => {
  const { service, sock } = await startService();
  const db = fakeDb({ [GROUP]: [7] });
  const sync = createWhatsAppSync({ service, db, log: quiet });
  service.downloadMedia = async (n) => ({ name: n.media.fileName, mimeType: n.media.mimeType, data: Buffer.from("img") });

  sock.ev.emit("connection.update", { qr: "2@abc,def" });
  await settle();
  assert.equal(service.status().state, "qr");
  assert.match(service.status().qr, /^data:image\/png;base64,/);

  sock.ev.emit("connection.update", { connection: "open" });
  await settle();
  assert.equal(service.status().state, "connected");
  assert.equal(service.status().me.number, "+61480000000");
  assert.equal(service.status().qr, null);

  // History arrives: two chats, a contact name, an older group message.
  sock.ev.emit("messaging-history.set", {
    chats: [{ id: JANE, conversationTimestamp: 1789999000 }, { id: GROUP, conversationTimestamp: 1789999500 }],
    contacts: [{ id: JANE, name: "Jane Client" }],
    messages: [
      { key: { remoteJid: GROUP, fromMe: false, id: "H1", participant: JANE }, pushName: "Jane", message: { conversation: "Old message" }, messageTimestamp: 1789999500 },
    ],
  });
  await settle();
  const chats = service.listChats();
  assert.deepEqual(chats.map((c) => c.name), ["Cable Co × Scalbl", "Jane Client"]);
  assert.equal(chats[0].isGroup, true);
  // History of a linked chat is stored too.
  assert.deepEqual(db.stored.map((s) => [s.clientId, s.waId, s.text]), [[7, "H1", "Old message"]]);

  // Live messages: the linked group is stored, the other chat isn't.
  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      { key: { remoteJid: GROUP, fromMe: false, id: "M1", participant: JANE }, pushName: "Jane", message: { conversation: "Leads look great this week" }, messageTimestamp: 1790000000 },
      { key: { remoteJid: OTHER, fromMe: false, id: "M2" }, pushName: "Someone else", message: { conversation: "Private chat" }, messageTimestamp: 1790000001 },
      { key: { remoteJid: GROUP, fromMe: false, id: "M3", participant: JANE }, pushName: "Jane", message: { imageMessage: { mimetype: "image/png", fileLength: 3 } }, messageTimestamp: 1790000002 },
    ],
  });
  await settle();
  const live = db.stored.filter((s) => s.waId !== "H1");
  assert.deepEqual(live.map((s) => [s.waId, s.direction, s.author, s.text]), [
    ["M1", "in", "Jane", "Leads look great this week"],
    ["M3", "in", "Jane", ""],
  ]);
  assert.equal(live[1].files[0].mimeType, "image/png");
  assert.equal(live[0].createdAt.toISOString(), new Date(1790000000 * 1000).toISOString());

  // Sending from the CRM: goes to WhatsApp and is stored under the sender's name.
  const { messageId } = await sync.send({ chatId: GROUP, text: "Thanks Jane!", author: "Henry" });
  await settle();
  assert.equal(sock.sent[0].jid, GROUP);
  assert.equal(sock.sent[0].opts.messageId, messageId);
  const out = db.stored.find((s) => s.waId === messageId);
  assert.deepEqual([out.direction, out.author, out.text], ["out", "Henry", "Thanks Jane!"]);

  // Linking another client later fills it with the chat's recent messages.
  const count = await sync.backfill(9, GROUP);
  assert.ok(count >= 3);
  assert.ok(db.stored.some((s) => s.clientId === 9 && s.waId === "M1"));
  // …and running it again doesn't duplicate anything.
  assert.equal(await sync.backfill(9, GROUP), 0);
  await service.stop();
});

test("logged out from the phone → forgets the login and offers a new QR", async () => {
  const { service, sock } = await startService();
  sock.ev.emit("connection.update", { connection: "open" });
  await settle();
  sock.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 }, message: "logged out" } } });
  await settle();
  assert.equal(service.status().state, "disconnected");
  assert.equal(service.status().me, null);
  assert.equal(fs.existsSync(service.authDir), false);
  await service.stop();
});

test("HTTP API: token required; status, chats, send, backfill", async () => {
  const { service, sock } = await startService();
  sock.ev.emit("connection.update", { connection: "open" });
  await settle();
  const db = fakeDb({ [GROUP]: [3] });
  const sync = createWhatsAppSync({ service, db, log: quiet });
  const server = createWhatsAppServer({ service, sync, verifyToken: (t) => t === "good", log: quiet });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/whatsapp`;
  const call = (p, opts = {}) =>
    fetch(base + p, { ...opts, headers: { Authorization: "Bearer good", "Content-Type": "application/json", ...(opts.headers || {}) } });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/status`, { headers: { Authorization: "Bearer bad" } })).status, 401);
    assert.equal((await (await call("/status")).json()).state, "connected");
    await settle();
    assert.ok((await (await call("/chats")).json()).chats.some((c) => c.id === GROUP));
    const sent = await (await call("/send", { method: "POST", body: JSON.stringify({ chatId: GROUP, text: "Hello", author: "Jem" }) })).json();
    assert.ok(sent.messageId);
    await settle();
    assert.equal(db.stored.find((s) => s.waId === sent.messageId)?.author, "Jem");
    assert.equal((await call("/send", { method: "POST", body: JSON.stringify({ chatId: GROUP }) })).status, 400);
    const bf = await (await call("/backfill", { method: "POST", body: JSON.stringify({ clientId: 5, chatId: GROUP }) })).json();
    assert.equal(typeof bf.stored, "number");
  } finally {
    server.close();
    await service.stop();
  }
});
