// Live transfer through the gateway: the rep's call stays up while a
// third party rings on another channel; once they answer everyone hears
// the other two; "complete" bridges lead ↔ third party and drops the rep.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { WebSocket } from "ws";
import { FakeTrunk, FakeMedia, newTag } from "./fakeTrunk.js";
import { loadSipConfig } from "../config.js";
import { SipUserAgent } from "../ua.js";
import { createVoiceGateway } from "../gateway.js";
import { encode, decode } from "../g711.js";

const quiet = { log() {}, warn() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const trunk = new FakeTrunk({ username: "T909317", password: "pw" });
  const port = await trunk.listen();
  const ua = new SipUserAgent(
    loadSipConfig({
      SIP_SERVER: "127.0.0.1",
      SIP_PORT: String(port),
      SIP_USERNAME: "T909317",
      SIP_PASSWORD: "pw",
      SIP_CALLER_ID: "+61480851534",
      SIP_MAX_CHANNELS: "3",
      SIP_RTP_PORTS: "46000-46999",
    }),
    { log: quiet }
  );
  await new Promise((resolve) => {
    ua.on("registration", (r) => r.state === "registered" && resolve());
    ua.start();
  });
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const gw = createVoiceGateway({ ua, server, verifyToken: () => ({ sub: "1", name: "Rep" }), log: quiet });
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/voice?token=x`);
  const inbox = [];
  const heard = [];
  ws.on("message", (d, bin) => (bin ? heard.push(new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length))) : inbox.push(JSON.parse(d))));
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
  await nextMsg((m) => m.type === "hello");

  // Places the rep's call to the lead and answers it.
  const lead = await new FakeMedia().open();
  const leadInvite = trunk.next("invite");
  ws.send(JSON.stringify({ type: "dial", ref: "r1", to: "0412000001", leadId: 7 }));
  const leadInv = await leadInvite;
  trunk.reply(leadInv, 200, "OK", { toTag: newTag(), body: lead.sdp(["PCMA"]), headers: { contact: "<sip:lead@127.0.0.1>" } });
  await nextMsg((m) => m.type === "call-state" && m.state === "answered");

  const close = async () => {
    ws.close();
    lead.close();
    gw.wss.close();
    server.close();
    await ua.stop();
    trunk.close();
  };
  return { trunk, ua, ws, inbox, heard, nextMsg, lead, leadInv, close };
}

// Streams a constant tone into the gateway for `ms`, every 20 ms.
function stream(ms, sendFrame) {
  return new Promise((resolve) => {
    const t = setInterval(sendFrame, 20);
    setTimeout(() => {
      clearInterval(t);
      resolve();
    }, ms);
  });
}

const tone = (v) => encode("PCMA", new Int16Array(160).fill(v));
const levels = (packets) => packets.filter((p) => p.pt === 8).map((p) => decode("PCMA", p.payload)[80]);
const near = (actual, expected) => Math.abs(actual - expected) <= expected * 0.08;

test("transfer: three-way audio, then handover bridges lead and third party", async () => {
  const s = await setup();
  const { trunk, ws, nextMsg, lead, leadInv } = s;
  try {
    const target = await new FakeMedia().open();
    const targetInvite = trunk.next("invite");
    ws.send(JSON.stringify({ type: "transfer-start", to: "0412 000 002" }));
    assert.equal((await nextMsg((m) => m.type === "transfer-state")).status, "placing");
    const tInv = await targetInvite;
    assert.match(tInv.uri, /\+61412000002/);
    const targetTag = newTag();
    trunk.reply(tInv, 180, "Ringing", { toTag: targetTag });
    assert.equal((await nextMsg((m) => m.type === "transfer-state")).status, "ringing");
    trunk.reply(tInv, 200, "OK", { toTag: targetTag, body: target.sdp(["PCMA"]), headers: { contact: "<sip:target@127.0.0.1>" } });
    const connected = await nextMsg((m) => m.type === "transfer-state");
    assert.equal(connected.status, "connected");
    assert.equal(connected.to, "+61412000002");

    // Rep 3000, lead 1000, third party 2000 — all at once.
    lead.packets.length = 0;
    target.packets.length = 0;
    s.heard.length = 0;
    await stream(600, () => {
      ws.send(Buffer.from(new Int16Array(160).fill(3000).buffer));
      lead.sendTo(leadInv.body, 8, tone(1000));
      target.sendTo(tInv.body, 8, tone(2000));
    });
    await sleep(100);
    // Lead hears rep + third party; third party hears rep + lead; rep hears lead + third party.
    assert.ok(levels(lead.packets).some((v) => near(v, 5000)), `lead heard ${levels(lead.packets).slice(0, 10)}`);
    assert.ok(levels(target.packets).some((v) => near(v, 4000)), `target heard ${levels(target.packets).slice(0, 10)}`);
    assert.ok(s.heard.some((f) => near(f[80], 3000)), `rep heard ${s.heard.slice(0, 10).map((f) => f[80])}`);

    // Hand over: the rep's call ends as "transferred"; lead ↔ third party carry on.
    ws.send(JSON.stringify({ type: "transfer-complete" }));
    assert.equal((await nextMsg((m) => m.type === "transfer-state")).status, "completed");
    assert.equal((await nextMsg((m) => m.type === "call-ended")).reason, "transferred");
    lead.packets.length = 0;
    target.packets.length = 0;
    await stream(400, () => {
      ws.send(Buffer.from(new Int16Array(160).fill(3000).buffer)); // rep's mic no longer goes anywhere
      lead.sendTo(leadInv.body, 8, tone(1000));
      target.sendTo(tInv.body, 8, tone(2000));
    });
    await sleep(100);
    assert.ok(levels(lead.packets).some((v) => near(v, 2000)));
    assert.ok(!levels(lead.packets).some((v) => near(v, 5000)), "rep's mic still reaching the lead");
    assert.ok(levels(target.packets).some((v) => near(v, 1000)));
    assert.equal(s.ua.channels.inUse, 2);

    // Third party hangs up → the lead is hung up too, both channels freed.
    const leadBye = trunk.next("bye", (m) => m.callId === leadInv.callId);
    trunk.sendRequest("BYE", "sip:T909317@127.0.0.1", {
      from: tInv.get("to").includes("tag=") ? tInv.get("to") : `${tInv.get("to")};tag=${targetTag}`,
      to: tInv.get("from"),
      callId: tInv.callId,
      cseq: 1,
    });
    trunk.reply(await leadBye, 200, "OK");
    await sleep(200);
    assert.equal(s.ua.channels.inUse, 0);
    target.close();
  } finally {
    await s.close();
  }
});

test("transfer: busy third party, then cancelling a ringing one; the rep's call carries on", async () => {
  const s = await setup();
  const { trunk, ws, nextMsg } = s;
  try {
    let inv = trunk.next("invite");
    ws.send(JSON.stringify({ type: "transfer-start", to: "0412000003" }));
    await nextMsg((m) => m.type === "transfer-state" && m.status === "placing");
    trunk.reply(await inv, 486, "Busy Here", { toTag: newTag() });
    assert.equal((await nextMsg((m) => m.type === "transfer-state")).status, "busy");

    inv = trunk.next("invite");
    ws.send(JSON.stringify({ type: "transfer-start", to: "0412000004" }));
    await nextMsg((m) => m.type === "transfer-state" && m.status === "placing");
    const tInv = await inv;
    const tag = newTag();
    trunk.reply(tInv, 180, "Ringing", { toTag: tag });
    await nextMsg((m) => m.type === "transfer-state" && m.status === "ringing");
    const cancel = trunk.next("cancel");
    ws.send(JSON.stringify({ type: "transfer-cancel" }));
    const c = await cancel;
    trunk.reply(c, 200, "OK");
    trunk.reply(tInv, 487, "Request Terminated", { toTag: tag });
    assert.equal((await nextMsg((m) => m.type === "transfer-state")).status, "cancelled");
    assert.equal(s.ua.channels.inUse, 1);
    assert.ok(!s.inbox.some((m) => m.type === "call-ended"), "the rep's call should still be up");

    // Completing with nobody on the line is refused without touching the call.
    ws.send(JSON.stringify({ type: "transfer-complete" }));
    assert.equal((await nextMsg((m) => m.type === "transfer-state")).status, "error");
  } finally {
    await s.close();
  }
});

test("transfer: the rep hanging up mid-transfer drops the ringing third party too", async () => {
  const s = await setup();
  const { trunk, ws, nextMsg, leadInv } = s;
  try {
    const inv = trunk.next("invite");
    ws.send(JSON.stringify({ type: "transfer-start", to: "0412000005" }));
    const tInv = await inv;
    const tag = newTag();
    trunk.reply(tInv, 180, "Ringing", { toTag: tag });
    await nextMsg((m) => m.type === "transfer-state" && m.status === "ringing");
    const cancel = trunk.next("cancel");
    const bye = trunk.next("bye", (m) => m.callId === leadInv.callId);
    ws.send(JSON.stringify({ type: "hangup" }));
    trunk.reply(await cancel, 200, "OK");
    trunk.reply(tInv, 487, "Request Terminated", { toTag: tag });
    trunk.reply(await bye, 200, "OK");
    assert.equal((await nextMsg((m) => m.type === "call-ended")).reason, "hangup-local");
    await sleep(200);
    assert.equal(s.ua.channels.inUse, 0);
  } finally {
    await s.close();
  }
});
