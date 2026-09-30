// End-to-end tests for the SIP stack against a fake trunk:
//   node --test server/sip/test/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { WebSocket } from "ws";
import { FakeTrunk, FakeMedia, newTag } from "./fakeTrunk.js";
import { loadSipConfig } from "../config.js";
import { SipUserAgent, ChannelsBusyError } from "../ua.js";
import { createVoiceGateway } from "../gateway.js";
import { encode } from "../g711.js";
import { parseNameAddr } from "../message.js";
import { toE164, formatForDial } from "../phone.js";

const quiet = { log() {}, warn() {} };
const USER = "T909317";
const PASS = "test-password";

let trunk;
let ua;

function waitFor(emitter, event, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    const handler = (...args) => {
      if (!predicate(...args)) return;
      clearTimeout(t);
      emitter.off(event, handler);
      resolve(args[0]);
    };
    emitter.on(event, handler);
  });
}

before(async () => {
  trunk = new FakeTrunk({ username: USER, password: PASS });
  const port = await trunk.listen();
  const config = loadSipConfig({
    SIP_SERVER: "127.0.0.1",
    SIP_PORT: String(port),
    SIP_DOMAIN: "sipm5.au.voipcloud.online",
    SIP_USERNAME: USER,
    SIP_PASSWORD: PASS,
    SIP_CALLER_ID: "+61 480 851 534",
    SIP_MAX_CHANNELS: "1",
    SIP_RTP_PORTS: "41000-41999",
    SIP_KEEPALIVE_SECONDS: "1",
  });
  ua = new SipUserAgent(config, { log: quiet });
  const registered = waitFor(ua, "registration", (r) => r.state === "registered");
  ua.start();
  await registered;
});

after(async () => {
  await ua.stop();
  trunk.close();
});

test("phone numbers normalise to E.164", () => {
  assert.equal(toE164("0412 345 678"), "+61412345678");
  assert.equal(toE164("61412345678"), "+61412345678");
  assert.equal(toE164("+61 480 851 534"), "+61480851534");
  assert.equal(formatForDial("0412 345 678", "national"), "0412345678");
  assert.equal(formatForDial("0412 345 678", "e164-no-plus"), "61412345678");
});

test("registers with digest auth over TCP and schedules refresh", () => {
  assert.equal(ua.registration.state, "registered");
  const reg = trunk.registers.at(-1);
  assert.match(reg.get("authorization"), /username="T909317"/);
  assert.match(reg.get("contact"), /transport=tcp/);
  assert.match(reg.topVia, /^SIP\/2\.0\/TCP /);
  assert.ok(ua.registration.expiresAt > Date.now());
});

test("outbound call: auth, early media, answer, audio both ways, DTMF, hangup", async () => {
  const media = await new FakeMedia().open();
  const invitePromise = trunk.next("invite");
  const call = ua.dial("0412 345 678");
  const invite = await invitePromise;

  // Request-URI in E.164, caller ID asserted.
  assert.equal(invite.uri, "sip:+61412345678@sipm5.au.voipcloud.online");
  assert.match(invite.get("p-asserted-identity"), /\+61480851534/);
  assert.match(invite.get("from"), /"\+61480851534" <sip:T909317@sipm5\.au\.voipcloud\.online>/);
  assert.match(invite.get("proxy-authorization"), /Digest/);
  assert.match(invite.body, /m=audio \d+ RTP\/AVP 8 0 101/);
  // The 407 before it was ACKed.
  assert.ok(trunk.received.some((m) => m.method === "ACK" && m.cseq.seq === invite.cseq.seq - 1));

  const toTag = newTag();
  trunk.reply(invite, 100, "Trying");
  const ringing = waitFor(call, "state", (s) => s === "ringing");
  trunk.reply(invite, 183, "Session Progress", { toTag, body: media.sdp(["PCMA"]) });
  await ringing;

  // Early media (network ringback) reaches the call's audio stream.
  const earlyAudio = waitFor(call, "audio");
  media.sendTo(invite.body, 8, encode("PCMA", new Int16Array(160).fill(3000)), { marker: true });
  const early = await earlyAudio;
  assert.equal(early.length, 160);
  assert.ok(Math.abs(early[0] - 3000) < 200);

  const answered = waitFor(call, "state", (s) => s === "answered");
  const ackPromise = trunk.next("ack", (m) => m.callId === invite.callId);
  trunk.reply(invite, 200, "OK", {
    toTag,
    body: media.sdp(["PCMA"]),
    headers: { contact: "<sip:callee@127.0.0.1:5060;transport=tcp>", "record-route": "<sip:127.0.0.1;lr>" },
  });
  await answered;
  const ack = await ackPromise;
  assert.equal(ack.uri, "sip:callee@127.0.0.1:5060;transport=tcp");
  assert.equal(ack.get("route"), "<sip:127.0.0.1;lr>");

  // Mic audio goes out as PCMA RTP.
  const gotVoice = waitFor(media, "packet", (p) => p.pt === 8 && p.payload[0] !== 0xd5);
  call.pushAudio(new Int16Array(320).fill(8000));
  await gotVoice;

  // DTMF out (RFC 4733): marker on first packet, E bit on the last ones.
  const dtmfEnd = waitFor(media, "packet", (p) => p.pt === 101 && p.payload[1] & 0x80);
  call.sendDtmf("5");
  const endPkt = await dtmfEnd;
  assert.equal(endPkt.payload[0], 5);

  // DTMF in.
  const dtmfIn = waitFor(call, "dtmf");
  media.sendTo(invite.body, 101, Buffer.from([9, 10, 0, 160]), { ts: 5000, seq: 50 });
  assert.equal(await dtmfIn, "9");

  // Hang up → BYE.
  const byePromise = trunk.next("bye", (m) => m.callId === invite.callId);
  const ended = waitFor(call, "ended");
  call.hangup();
  const bye = await byePromise;
  trunk.reply(bye, 200, "OK");
  assert.equal((await ended).reason, "hangup-local");
  assert.equal(ua.channels.inUse, 0);
  media.close();
});

test("outbound call: busy (486)", async () => {
  const invitePromise = trunk.next("invite");
  const call = ua.dial("0412345678");
  const invite = await invitePromise;
  const ended = waitFor(call, "ended");
  const ack = trunk.next("ack", (m) => m.callId === invite.callId);
  trunk.reply(invite, 486, "Busy Here", { toTag: newTag() });
  const info = await ended;
  assert.equal(info.reason, "busy");
  assert.equal(info.status, 486);
  await ack;
  assert.equal(ua.channels.inUse, 0);
});

test("outbound call: failed (404) and remote hangup", async () => {
  let invitePromise = trunk.next("invite");
  let call = ua.dial("0299999999");
  let invite = await invitePromise;
  let ended = waitFor(call, "ended");
  trunk.reply(invite, 404, "Not Found", { toTag: newTag() });
  assert.equal((await ended).reason, "failed");

  // Answered then the far end hangs up.
  const media = await new FakeMedia().open();
  invitePromise = trunk.next("invite");
  call = ua.dial("0412345678");
  invite = await invitePromise;
  const toTag = newTag();
  const answered = waitFor(call, "state", (s) => s === "answered");
  trunk.reply(invite, 200, "OK", { toTag, body: media.sdp(), headers: { contact: "<sip:callee@127.0.0.1>" } });
  await answered;
  ended = waitFor(call, "ended");
  const byeOk = trunk.next("response", (r) => r.cseq.method === "BYE");
  trunk.sendRequest("BYE", `sip:${USER}@127.0.0.1`, {
    from: `<${invite.uri}>;tag=${toTag}`,
    to: invite.get("from"),
    callId: invite.callId,
    cseq: 1,
  });
  assert.equal((await ended).reason, "hangup-remote");
  assert.equal((await byeOk).status, 200);
  media.close();
});

test("outbound call: ring timeout sends CANCEL → no-answer", async () => {
  const invitePromise = trunk.next("invite");
  const call = ua.dial("0412345678", { ringTimeoutSeconds: 1 });
  const invite = await invitePromise;
  const toTag = newTag();
  trunk.reply(invite, 180, "Ringing", { toTag });
  const cancel = await trunk.next("cancel", (m) => m.callId === invite.callId, 3000);
  assert.equal(cancel.branch, invite.branch);
  const ended = waitFor(call, "ended");
  trunk.reply(cancel, 200, "OK");
  trunk.reply(invite, 487, "Request Terminated", { toTag });
  assert.equal((await ended).reason, "no-answer");
});

test("channel limit: second outbound call and inbound call are refused while one is up", async () => {
  const invitePromise = trunk.next("invite");
  const call = ua.dial("0412345678");
  const invite = await invitePromise;
  assert.throws(() => ua.dial("0412000000"), ChannelsBusyError);

  const busy = trunk.next("response", (r) => r.status === 486 && r.callId === "inbound-while-busy");
  trunk.sendRequest("INVITE", `sip:${USER}@127.0.0.1`, {
    from: `<sip:+61412000000@sipm5.au.voipcloud.online>;tag=${newTag()}`,
    to: `<sip:${USER}@sipm5.au.voipcloud.online>`,
    callId: "inbound-while-busy",
    body: "v=0\r\nc=IN IP4 127.0.0.1\r\nm=audio 4000 RTP/AVP 8\r\n",
  });
  await busy;

  const ended = waitFor(call, "ended");
  call.hangup(); // before any provisional → CANCEL deferred until one arrives
  trunk.reply(invite, 100, "Trying");
  const cancel = await trunk.next("cancel", (m) => m.callId === invite.callId);
  trunk.reply(cancel, 200, "OK");
  trunk.reply(invite, 487, "Request Terminated", { toTag: newTag() });
  assert.equal((await ended).reason, "cancelled");
  assert.equal(ua.channels.inUse, 0);
});

test("inbound call: ring, answer, BYE; and caller cancelling before answer", async () => {
  const media = await new FakeMedia().open();
  const incoming = waitFor(ua, "incoming");
  const ringing = trunk.next("response", (r) => r.status === 180 && r.callId === "inbound-1");
  const invite = trunk.sendRequest("INVITE", `sip:${USER}@127.0.0.1`, {
    from: `"Jane" <sip:0412345678@sipm5.au.voipcloud.online>;tag=abc`,
    to: `<sip:${USER}@sipm5.au.voipcloud.online>`,
    callId: "inbound-1",
    headers: { contact: "<sip:caller@127.0.0.1:5060;transport=tcp>" },
    body: media.sdp(["PCMU", "PCMA"]),
  });
  const call = await incoming;
  await ringing;
  assert.equal(call.remoteNumber, "+61412345678");
  assert.equal(call.remoteName, "Jane");

  const ok = trunk.next("response", (r) => r.status === 200 && r.callId === "inbound-1");
  call.answer();
  const res = await ok;
  assert.match(res.body, /m=audio \d+ RTP\/AVP 0 101/); // their preferred codec (u-law)
  const localTag = parseNameAddr(res.get("to")).params.tag;
  trunk.sendRequest("ACK", "sip:T909317@127.0.0.1", {
    from: invite.get("from"),
    to: res.get("to"),
    callId: "inbound-1",
    cseq: 1,
  });

  const heard = waitFor(call, "audio");
  media.sendTo(res.body, 0, encode("PCMU", new Int16Array(160).fill(-2000)));
  assert.ok(Math.abs((await heard)[0] + 2000) < 200);

  const ended = waitFor(call, "ended");
  trunk.sendRequest("BYE", "sip:T909317@127.0.0.1", {
    from: invite.get("from"),
    to: `<sip:${USER}@sipm5.au.voipcloud.online>;tag=${localTag}`,
    callId: "inbound-1",
    cseq: 2,
  });
  assert.equal((await ended).reason, "hangup-remote");
  media.close();

  // Caller hangs up while it's still ringing → missed call.
  const incoming2 = waitFor(ua, "incoming");
  const invite2 = trunk.sendRequest("INVITE", `sip:${USER}@127.0.0.1`, {
    from: `<sip:+61412345678@sipm5.au.voipcloud.online>;tag=def`,
    to: `<sip:${USER}@sipm5.au.voipcloud.online>`,
    callId: "inbound-2",
    body: "v=0\r\nc=IN IP4 127.0.0.1\r\nm=audio 4000 RTP/AVP 8\r\n",
  });
  const call2 = await incoming2;
  const ended2 = waitFor(call2, "ended");
  const terminated = trunk.next("response", (r) => r.status === 487 && r.callId === "inbound-2");
  trunk.sendRequest("CANCEL", `sip:${USER}@127.0.0.1`, {
    from: invite2.get("from"),
    to: invite2.get("to"),
    callId: "inbound-2",
    cseq: 1,
    branch: invite2.branch,
  });
  await terminated;
  assert.equal((await ended2).reason, "cancelled");
  assert.equal(ua.channels.inUse, 0);
});

test("gateway: browser dials over WebSocket, hears audio, sends audio and DTMF", async () => {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const gw = createVoiceGateway({
    ua,
    server,
    verifyToken: (t) => (t === "good" ? { sub: "1", name: "Henry" } : null),
    log: quiet,
  });
  const url = `ws://127.0.0.1:${server.address().port}/voice`;

  // Bad token is refused.
  const bad = new WebSocket(`${url}?token=nope`);
  const closeCode = await new Promise((r) => bad.on("close", (code) => r(code)));
  assert.equal(closeCode, 4001);

  const ws = new WebSocket(`${url}?token=good`);
  const inbox = [];
  const audio = [];
  ws.on("message", (data, isBinary) => (isBinary ? audio.push(data) : inbox.push(JSON.parse(data))));
  const nextMsg = (type, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
        if (Date.now() - started > timeoutMs) return reject(new Error(`no ${type}`));
        setTimeout(poll, 10);
      };
      poll();
    });
  const hello = await nextMsg("hello");
  assert.equal(hello.registration.state, "registered");
  assert.equal(hello.callerId, "+61480851534");

  const media = await new FakeMedia().open();
  const invitePromise = trunk.next("invite");
  ws.send(JSON.stringify({ type: "dial", ref: "r1", to: "0412 345 678" }));
  const started = await nextMsg("call-started");
  assert.equal(started.to, "+61412345678");
  const invite = await invitePromise;
  const toTag = newTag();
  assert.equal((await nextMsg("call-state")).state, "calling");
  trunk.reply(invite, 180, "Ringing", { toTag });
  assert.equal((await nextMsg("call-state")).state, "ringing");
  trunk.reply(invite, 200, "OK", { toTag, body: media.sdp(["PCMA"]), headers: { contact: "<sip:callee@127.0.0.1>" } });
  assert.equal((await nextMsg("call-state")).state, "answered");

  // Far end → browser.
  media.sendTo(invite.body, 8, encode("PCMA", new Int16Array(160).fill(4000)));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(audio.length >= 1);
  assert.equal(audio[0].length, 320);

  // Browser → far end.
  const voice = waitFor(media, "packet", (p) => p.pt === 8 && p.payload[0] !== 0xd5);
  ws.send(Buffer.from(new Int16Array(160).fill(9000).buffer));
  await voice;

  const dtmf = waitFor(media, "packet", (p) => p.pt === 101);
  ws.send(JSON.stringify({ type: "dtmf", digits: "#" }));
  assert.equal((await dtmf).payload[0], 11);

  const byePromise = trunk.next("bye");
  ws.send(JSON.stringify({ type: "hangup" }));
  trunk.reply(await byePromise, 200, "OK");
  const ended = await nextMsg("call-ended");
  assert.equal(ended.reason, "hangup-local");

  // Inbound call offered to the browser and answered from it.
  trunk.sendRequest("INVITE", `sip:${USER}@127.0.0.1`, {
    from: `<sip:0412999888@sipm5.au.voipcloud.online>;tag=zz`,
    to: `<sip:${USER}@sipm5.au.voipcloud.online>`,
    callId: "gw-inbound",
    headers: { contact: "<sip:caller@127.0.0.1>" },
    body: media.sdp(["PCMA"]),
  });
  const offer = await nextMsg("incoming");
  assert.equal(offer.from, "+61412999888");
  const ok = trunk.next("response", (r) => r.status === 200 && r.callId === "gw-inbound");
  ws.send(JSON.stringify({ type: "answer", callId: offer.callId }));
  await ok;
  assert.equal((await nextMsg("call-started")).direction, "inbound");
  ws.send(JSON.stringify({ type: "hangup" }));
  const bye = await trunk.next("bye", (m) => m.callId === "gw-inbound");
  trunk.reply(bye, 200, "OK");
  await nextMsg("call-ended");

  // Multi-line needs ≥2 free channels; this trunk has 1.
  ws.send(JSON.stringify({ type: "dial-multi", ref: "m1", legs: [{ ref: 1, to: "0412000001" }, { ref: 2, to: "0412000002" }] }));
  assert.match((await nextMsg("dial-error")).message, /at least 2 free SIP channels/);

  ws.close();
  media.close();
  gw.wss.close();
  server.close();
});

test("re-registers after the TCP connection drops", async () => {
  const before = trunk.registers.length;
  const down = waitFor(ua, "registration", (r) => r.state === "unregistered");
  trunk.flow.socket.destroy();
  await down;
  await waitFor(ua, "registration", (r) => r.state === "registered", 6000);
  assert.ok(trunk.registers.length > before);
});

test("a failure's Q.850 cause is kept and explained", async () => {
  const { parseQ850 } = await import("../call.js");
  const { endedMessage } = await import("../gateway.js");
  assert.equal(parseQ850('Q.850;cause=1;text="Unallocated number"'), 1);
  assert.equal(parseQ850("SIP;cause=500, Q.850 ; cause = 34"), 34);
  assert.equal(parseQ850(""), 0);

  const invitePromise = trunk.next("invite");
  const call = ua.dial("0412345678");
  const invite = await invitePromise;
  const ended = waitFor(call, "ended");
  trunk.reply(invite, 500, "Server Internal Error", {
    toTag: newTag(),
    headers: { reason: 'Q.850;cause=1;text="Unallocated (unassigned) number"' },
  });
  const info = await ended;
  assert.equal(info.reason, "failed");
  assert.equal(info.cause, 1);
  assert.match(endedMessage(info), /doesn't exist.*500 Server Internal Error, cause 1/);
});
