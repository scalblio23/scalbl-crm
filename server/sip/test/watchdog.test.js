// The dead-call watchdog (Call.startMediaWatchdog): a connected call
// whose far end goes silent, or that runs past the cap, is hung up so
// its SIP channel is released. A live call or one on hold is left alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Call } from "../call.js";
import { ChannelPool } from "../channels.js";

function makeCall(config) {
  const ua = { config: { rtpPortMin: 30000, rtpPortMax: 30999, ...config }, log: { log() {}, warn() {} }, calls: new Map() };
  const pool = new ChannelPool(1);
  const lease = pool.tryAcquire("test");
  const call = new Call(ua, { direction: "outbound", lease });
  call.byes = 0;
  call.sendBye = () => { call.byes++; };
  call.rtp.close = () => {};
  call.answeredAt = Date.now();
  return { call, pool };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("a silent connected call is ended and its channel freed", async () => {
  const { call, pool } = makeCall({ mediaTimeoutSeconds: 0.2, maxCallSeconds: 0 });
  call.setState("answered");
  assert.equal(pool.available, 0);
  await wait(600);
  assert.equal(call.endReason, "media-timeout");
  assert.equal(call.byes, 1);
  assert.equal(pool.available, 1);
});

test("a call still receiving audio stays up", async () => {
  const { call, pool } = makeCall({ mediaTimeoutSeconds: 0.3, maxCallSeconds: 0 });
  call.setState("answered");
  const feed = setInterval(() => { call.rtp.lastPacketAt = Date.now(); }, 50);
  await wait(900);
  clearInterval(feed);
  assert.equal(call.isEnded, false);
  assert.equal(pool.available, 0);
  call.end("test-done");
});

test("a call on hold isn't ended for being quiet", async () => {
  const { call } = makeCall({ mediaTimeoutSeconds: 0.2, maxCallSeconds: 0 });
  call.rtp.paused = true;
  call.setState("answered");
  await wait(700);
  assert.equal(call.isEnded, false);
  call.end("test-done");
});

test("the maximum call length ends a call even with audio flowing", async () => {
  const { call, pool } = makeCall({ mediaTimeoutSeconds: 0, maxCallSeconds: 0.3 });
  call.setState("answered");
  const feed = setInterval(() => { call.rtp.lastPacketAt = Date.now(); }, 50);
  await wait(800);
  clearInterval(feed);
  assert.equal(call.endReason, "max-duration");
  assert.equal(pool.available, 1);
});

test("both limits at 0 turn the watchdog off", async () => {
  const { call } = makeCall({ mediaTimeoutSeconds: 0, maxCallSeconds: 0 });
  call.setState("answered");
  await wait(300);
  assert.equal(call.isEnded, false);
  call.end("test-done");
});
