// Multi-line dialling through the gateway on a 2-channel trunk: both
// leads ring, the first to answer is bridged, the other is cancelled.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { WebSocket } from "ws";
import { FakeTrunk, FakeMedia, newTag } from "./fakeTrunk.js";
import { loadSipConfig } from "../config.js";
import { SipUserAgent } from "../ua.js";
import { createVoiceGateway } from "../gateway.js";

const quiet = { log() {}, warn() {} };

test("multi-line: first answer wins, the other leg is cancelled", async () => {
  const trunk = new FakeTrunk({ username: "T909317", password: "pw" });
  const port = await trunk.listen();
  const ua = new SipUserAgent(
    loadSipConfig({
      SIP_SERVER: "127.0.0.1",
      SIP_PORT: String(port),
      SIP_USERNAME: "T909317",
      SIP_PASSWORD: "pw",
      SIP_CALLER_ID: "+61480851534",
      SIP_MAX_CHANNELS: "2",
      SIP_RTP_PORTS: "42000-42999",
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
  await nextMsg((m) => m.type === "hello");

  const invites = [];
  trunk.on("invite", (m) => invites.push(m));
  ws.send(
    JSON.stringify({
      type: "dial-multi",
      ref: 7,
      ringSeconds: 20,
      legs: [
        { ref: 101, to: "0412000001" },
        { ref: 102, to: "0412000002" },
        { ref: 103, to: "0412000003" }, // no third channel
      ],
    })
  );
  const firstReport = await nextMsg((m) => m.type === "multi-legs");
  assert.equal(firstReport.legs.find((l) => l.ref === 103).status, "failed");
  while (invites.length < 2) await new Promise((r) => setTimeout(r, 10));
  assert.equal(ua.channels.inUse, 2);

  const [a, b] = invites;
  const tagA = newTag();
  const tagB = newTag();
  trunk.reply(a, 180, "Ringing", { toTag: tagA });
  trunk.reply(b, 180, "Ringing", { toTag: tagB });
  await nextMsg((m) => m.type === "multi-legs" && m.legs.filter((l) => l.status === "ringing").length === 2);

  // Leg B answers first.
  const media = await new FakeMedia().open();
  const cancelA = trunk.next("cancel", (m) => m.callId === a.callId);
  trunk.reply(b, 200, "OK", { toTag: tagB, body: media.sdp(), headers: { contact: "<sip:b@127.0.0.1>" } });
  const won = await nextMsg((m) => m.type === "multi-answered");
  const refFor = (invite) => (invite.uri.includes("61412000002@") ? 102 : 101);
  assert.equal(won.legRef, refFor(b));
  trunk.reply(await cancelA, 200, "OK");
  trunk.reply(a, 487, "Request Terminated", { toTag: tagA });
  await nextMsg((m) => m.type === "multi-legs" && m.legs.some((l) => l.status === "canceled"));
  assert.equal(ua.channels.inUse, 1);

  // Rep hangs up the bridged call.
  ws.send(JSON.stringify({ type: "hangup" }));
  const bye = await trunk.next("bye", (m) => m.callId === b.callId);
  trunk.reply(bye, 200, "OK");
  const ended = await nextMsg((m) => m.type === "call-ended");
  assert.equal(ended.reason, "hangup-local");
  assert.equal(ua.channels.inUse, 0);

  ws.close();
  media.close();
  gw.wss.close();
  server.close();
  await ua.stop();
  trunk.close();
});
