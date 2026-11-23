// Several SIP accounts pooled into more lines (SIP_TRUNKS_FILE +
// TrunkPool): the file loader, and round-robin dialling against fake
// registrars — one per account, each with its own credentials.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { FakeTrunk } from "./fakeTrunk.js";
import { loadSipConfig, loadSipConfigs, missingSipEnv, MAX_TRUNKS } from "../config.js";
import { SipUserAgent, ChannelsBusyError } from "../ua.js";
import { TrunkPool } from "../trunkPool.js";
import { parseNameAddr } from "../message.js";

const quiet = { log() {}, warn() {} };
const ACCOUNTS = [
  { username: "ct111111", password: "Ab*c$d!e1", callerId: "+61485000001" },
  { username: "ct222222", password: "pw-two", callerId: "+61485000002" },
  { username: "ct333333", password: "pw three", callerId: "+61485000003" },
];

function writeTrunksFile(accounts, { dir = fs.mkdtempSync(path.join(os.tmpdir(), "trunks-")) } = {}) {
  const rows = accounts.map((a) => {
    const passwordFile = path.join(dir, `${a.username}.password`);
    fs.writeFileSync(passwordFile, a.password, { mode: 0o600 });
    return { username: a.username, authUsername: a.username, passwordFile, callerId: a.callerId };
  });
  const file = path.join(dir, "trunks.json");
  fs.writeFileSync(file, JSON.stringify(rows), { mode: 0o600 });
  return file;
}

const baseEnv = { SIP_SERVER: "sip.crazytel.net.au", SIP_PORT: "5060", SIP_RTP_PORTS: "10000-10999", SIP_LISTEN_PORT: "5070" };

test("SIP_TRUNKS_FILE loads every account with its own password, number and port range", () => {
  const configs = loadSipConfigs({ ...baseEnv, SIP_TRUNKS_FILE: writeTrunksFile(ACCOUNTS) });
  assert.equal(configs.length, 3);
  configs.forEach((c, i) => {
    assert.equal(c.username, ACCOUNTS[i].username);
    assert.equal(c.authUsername, ACCOUNTS[i].username);
    assert.equal(c.password, ACCOUNTS[i].password, "password read verbatim");
    assert.equal(c.callerId, ACCOUNTS[i].callerId);
    assert.deepEqual(c.callerIds, [ACCOUNTS[i].callerId]);
    assert.equal(c.fromUser, ACCOUNTS[i].username);
    assert.equal(c.maxChannels, 1);
    assert.equal(c.server, "sip.crazytel.net.au");
    assert.equal(c.port, 5060);
    assert.equal(c.rtpPortMin % 2, 0, "RTP slice starts even");
    assert.ok(!JSON.stringify(c).includes(ACCOUNTS[i].password), "password never serialised");
  });
  // Disjoint RTP slices covering the whole range.
  assert.equal(configs[0].rtpPortMin, 10000);
  assert.equal(configs[2].rtpPortMax, 10999);
  assert.ok(configs[0].rtpPortMax < configs[1].rtpPortMin && configs[1].rtpPortMax < configs[2].rtpPortMin);
  // Only the first account owns the extra listener.
  assert.deepEqual(configs.map((c) => c.listenPort), [5070, 0, 0]);
  assert.deepEqual(missingSipEnv({ SIP_TRUNKS_FILE: "/x" }), []);
});

test("six accounts (the live Crazytel setup) are accepted", () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ username: `ct90000${i}`, password: `p${i}`, callerId: `+6148500010${i}` }));
  const configs = loadSipConfigs({ ...baseEnv, SIP_TRUNKS_FILE: writeTrunksFile(six) });
  assert.equal(configs.length, 6);
  for (let i = 1; i < 6; i++) assert.ok(configs[i - 1].rtpPortMax < configs[i].rtpPortMin);
});

test("bad SIP_TRUNKS_FILE setups fail clearly without leaking passwords", () => {
  const tooMany = Array.from({ length: MAX_TRUNKS + 1 }, (_, i) => ({ username: `u${i}`, password: "x", callerId: "+61485000001" }));
  assert.throws(() => loadSipConfigs({ ...baseEnv, SIP_TRUNKS_FILE: writeTrunksFile(tooMany) }), /1 to 10 accounts/);
  assert.throws(
    () => loadSipConfigs({ ...baseEnv, SIP_TRUNKS_FILE: writeTrunksFile([ACCOUNTS[0], ACCOUNTS[0]]) }),
    /lists ct111111 twice/
  );
  const file = writeTrunksFile([ACCOUNTS[0]]);
  fs.unlinkSync(path.join(path.dirname(file), "ct111111.password"));
  assert.throws(() => loadSipConfigs({ ...baseEnv, SIP_TRUNKS_FILE: file }), /password file for ct111111 \(ENOENT\)/);
  assert.throws(() => loadSipConfigs({ ...baseEnv, SIP_TRUNKS_FILE: "/nope/trunks.json" }), /Can't read SIP_TRUNKS_FILE/);
});

test("without SIP_TRUNKS_FILE the single trunk loads exactly as before", () => {
  const env = { SIP_USERNAME: "T1", SIP_PASSWORD: "p", SIP_CALLER_ID: "0485000111" };
  assert.deepEqual(loadSipConfigs(env), [loadSipConfig(env)]);
});

// ---------- live pool against fake registrars ----------

let trunks;
let pool;

function waitFor(emitter, event, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    const handler = (arg) => {
      if (!predicate(arg)) return;
      clearTimeout(t);
      emitter.off(event, handler);
      resolve(arg);
    };
    emitter.on(event, handler);
  });
}

before(async () => {
  trunks = [];
  const configs = [];
  for (const [i, a] of ACCOUNTS.entries()) {
    const fake = new FakeTrunk({ username: a.username, password: a.password });
    const port = await fake.listen();
    trunks.push(fake);
    // Same shape loadSipConfigs builds, but each account on its own fake
    // registrar so the test can see which one a call went to.
    const c = loadSipConfig({
      SIP_SERVER: "127.0.0.1",
      SIP_PORT: String(port),
      SIP_DOMAIN: "sip.crazytel.net.au",
      SIP_USERNAME: a.username,
      SIP_PASSWORD: a.password,
      SIP_CALLER_ID: a.callerId,
      SIP_RTP_PORTS: `${43000 + i * 200}-${43000 + i * 200 + 199}`,
      SIP_KEEPALIVE_SECONDS: "1",
    });
    configs.push({ ...c, id: a.username, fromUser: a.username, callerIds: [a.callerId], callerIdInFrom: true, maxChannels: 1 });
  }
  pool = new TrunkPool(configs, { createUa: (c) => new SipUserAgent(c, { log: quiet }) });
  const all = Promise.all(pool.trunks.map((ua) => waitFor(ua, "registration", (r) => r.state === "registered")));
  pool.start();
  await all;
});

after(async () => {
  await pool.stop();
  for (const t of trunks) t.close();
});

test("the pool is registered and counts every account's line", () => {
  assert.equal(pool.isRegistered, true);
  assert.equal(pool.registration.state, "registered");
  assert.equal(pool.registration.degraded, false);
  assert.deepEqual(pool.channels.snapshot(), { max: 3, inUse: 0, available: 3, calls: [] });
  assert.deepEqual(pool.config.callerIds, ACCOUNTS.map((a) => a.callerId));
  const s = pool.status();
  assert.deepEqual(s.trunks.map((t) => [t.id, t.callerId, t.registration.state, t.channels.max]), [
    ["ct111111", "+61485000001", "registered", 1],
    ["ct222222", "+61485000002", "registered", 1],
    ["ct333333", "+61485000003", "registered", 1],
  ]);
  assert.ok(!JSON.stringify(s).includes("pw-two"));
});

test("calls spread across accounts, each from its own account and number; a full pool says so", async () => {
  const calls = [];
  for (const [i, a] of ACCOUNTS.entries()) {
    const invite = trunks[i].next("invite");
    calls.push(pool.dial(`0412 000 00${i}`, { label: `rep ${i}` }));
    const req = await invite;
    const from = parseNameAddr(req.get("from"));
    assert.match(from.uri, new RegExp(`^sip:${a.username}@`), "From user is the account");
    assert.match(req.get("p-asserted-identity"), new RegExp(a.callerId.replace("+", "\\+")), "PAI is the account's number");
  }
  assert.equal(pool.channels.available, 0);
  assert.throws(() => pool.dial("0412 000 009"), (err) => err instanceof ChannelsBusyError && /No registered SIP trunk has a free channel/.test(err.message));

  // Freeing the second account's line makes it the next one used.
  calls[1].end("test-done");
  assert.equal(pool.channels.available, 1);
  const invite = trunks[1].next("invite");
  calls[1] = pool.dial("0412 000 010");
  await invite;
  for (const c of calls) c.end("test-done");
  assert.equal(pool.channels.inUse, 0);
});

test("an account that drops off is skipped, and the pool reports itself degraded", async () => {
  pool.trunks[0].setRegistration("unregistered", "Connection to the SIP server dropped — reconnecting");
  try {
    assert.equal(pool.registration.state, "registered");
    assert.equal(pool.registration.degraded, true);
    assert.equal(pool.channels.available, 2);
    const calls = [];
    for (let i = 0; i < 2; i++) calls.push(pool.dial(`0412 000 02${i}`));
    assert.throws(() => pool.dial("0412 000 029"), ChannelsBusyError, "the unregistered account isn't used");
    for (const c of calls) c.end("test-done");
  } finally {
    pool.trunks[0].setRegistration("registered");
  }
});

test("an inbound call on any account reaches the gateway", async () => {
  const incoming = waitFor(pool, "incoming");
  trunks[2].sendRequest("INVITE", "sip:ct333333@127.0.0.1", {
    from: "<sip:+61412999888@sip.crazytel.net.au>;tag=abc",
    to: "<sip:ct333333@sip.crazytel.net.au>",
    callId: "inbound-pool-test",
    body: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio 40000 RTP/AVP 8\r\na=rtpmap:8 PCMA/8000\r\n",
  });
  const call = await incoming;
  assert.equal(call.direction, "inbound");
  call.reject(486, "Busy Here", "declined");
});

test("through the gateway: a live transfer takes a second account, a third call is refused until a line frees", async () => {
  const { default: http } = await import("http");
  const { WebSocket } = await import("ws");
  const { createVoiceGateway } = await import("../gateway.js");
  const { FakeMedia, newTag } = await import("./fakeTrunk.js");
  const fakes = [];
  const configs = [];
  for (const [i, a] of ACCOUNTS.slice(0, 2).entries()) {
    const fake = new FakeTrunk({ username: a.username, password: a.password });
    const port = await fake.listen();
    fakes.push(fake);
    const c = loadSipConfig({
      SIP_SERVER: "127.0.0.1", SIP_PORT: String(port), SIP_USERNAME: a.username, SIP_PASSWORD: a.password,
      SIP_CALLER_ID: a.callerId, SIP_RTP_PORTS: `${47000 + i * 200}-${47000 + i * 200 + 199}`,
    });
    configs.push({ ...c, id: a.username, fromUser: a.username, callerIds: [a.callerId], callerIdInFrom: true, maxChannels: 1 });
  }
  const gwPool = new TrunkPool(configs, { createUa: (c) => new SipUserAgent(c, { log: quiet }) });
  const ready = Promise.all(gwPool.trunks.map((ua) => waitFor(ua, "registration", (r) => r.state === "registered")));
  gwPool.start();
  await ready;
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const gw = createVoiceGateway({ ua: gwPool, server, verifyToken: () => ({ sub: "1", name: "Rep" }), log: quiet });
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/voice?token=x`);
  const inbox = [];
  ws.on("message", (d, bin) => !bin && inbox.push(JSON.parse(d)));
  const nextMsg = (pred, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const i = inbox.findIndex(pred);
        if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
        if (Date.now() - started > timeoutMs) return reject(new Error("timeout"));
        setTimeout(poll, 10);
      };
      poll();
    });
  const lead = await new FakeMedia().open();
  const target = await new FakeMedia().open();
  try {
    const hello = await nextMsg((m) => m.type === "hello");
    assert.equal(hello.channels.max, 2);
    assert.equal(hello.callerId, ACCOUNTS[0].callerId);

    const leadInvite = fakes[0].next("invite");
    ws.send(JSON.stringify({ type: "dial", ref: "r1", to: "0412000001", leadId: 7 }));
    const leadInv = await leadInvite;
    fakes[0].reply(leadInv, 200, "OK", { toTag: newTag(), body: lead.sdp(["PCMA"]), headers: { contact: "<sip:lead@127.0.0.1>" } });
    await nextMsg((m) => m.type === "call-state" && m.state === "answered");

    // The transfer leg goes out on the other account.
    const targetInvite = fakes[1].next("invite");
    ws.send(JSON.stringify({ type: "transfer-start", to: "0412 000 002" }));
    const tInv = await targetInvite;
    assert.match(parseNameAddr(tInv.get("from")).uri, /^sip:ct222222@/);
    fakes[1].reply(tInv, 200, "OK", { toTag: newTag(), body: target.sdp(["PCMA"]), headers: { contact: "<sip:target@127.0.0.1>" } });
    await nextMsg((m) => m.type === "transfer-state" && m.status === "connected");
    ws.send(JSON.stringify({ type: "transfer-complete" }));
    await nextMsg((m) => m.type === "call-ended" && m.reason === "transferred");
    // Handed over, but both legs still hold their account's line.
    assert.equal(gwPool.channels.inUse, 2);
    assert.equal(gwPool.channels.available, 0);

    ws.send(JSON.stringify({ type: "dial", ref: "r2", to: "0412000003", leadId: 8 }));
    const err = await nextMsg((m) => m.type === "dial-error");
    assert.match(err.message, /No registered SIP trunk has a free channel/);

    // The third party hangs up → the lead is hung up too and both lines free.
    const bye = fakes[0].next("bye");
    fakes[1].sendRequest("BYE", "sip:x@127.0.0.1", {
      from: tInv.get("to"), to: tInv.get("from"), callId: tInv.callId, cseq: 2,
    });
    await bye;
    for (let i = 0; i < 50 && gwPool.channels.inUse; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(gwPool.channels.inUse, 0);
  } finally {
    ws.close();
    lead.close();
    target.close();
    gw.wss.close();
    server.close();
    await gwPool.stop();
    for (const f of fakes) f.close();
  }
});
