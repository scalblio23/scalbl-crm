// SIP call recording: the recorder itself, the retention sweep, the
// recording tokens, and a recorded call end to end through the gateway.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { execFileSync } from "child_process";
import { WebSocket } from "ws";
import { FakeTrunk, FakeMedia, newTag } from "./fakeTrunk.js";
import { loadSipConfig } from "../config.js";
import { SipUserAgent } from "../ua.js";
import { createVoiceGateway } from "../gateway.js";
import { encode } from "../g711.js";
import { CallRecorder, findRecordingFile, sweepRecordings, RECORDING_ID_RE } from "../recorder.js";
import { mintRecordingToken, verifyRecordingToken, voiceGatewayHttpUrl } from "../../voiceConfig.js";

const quiet = { log() {}, warn() {} };
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rec-test-"));
}

function frames(count, value) {
  return Array.from({ length: count }, () => new Int16Array(160).fill(value));
}

test("recorder mixes both sides into an MP3 and removes the raw files", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = tmpDir();
  let now = 0;
  const rec = new CallRecorder({ dir, log: quiet, now: () => now });
  assert.match(rec.id, RECORDING_ID_RE);
  for (const f of frames(150, 3000)) {
    now += 20;
    rec.write("remote", f);
    rec.write("local", f);
  }
  const saved = await rec.finish();
  assert.equal(saved.seconds, 3);
  assert.equal(path.extname(saved.file), ".mp3");
  assert.ok(fs.statSync(saved.file).size > 1000);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(saved.file)]);
  assert.equal(findRecordingFile(dir, rec.id).contentType, "audio/mpeg");
  assert.equal(await rec.finish(), saved); // idempotent
});

test("recorder keeps both sides in step across a gap, and falls back to WAV without ffmpeg", async () => {
  const dir = tmpDir();
  let now = 0;
  const rec = new CallRecorder({ dir, log: quiet, ffmpegPath: path.join(dir, "no-such-ffmpeg"), now: () => now });
  // 1 s of the lead talking; the rep's mic sends nothing for 1 s, then 1 s of audio.
  for (const f of frames(50, 1000)) {
    now += 20;
    rec.write("remote", f);
  }
  for (const f of frames(50, 2000)) {
    now += 20;
    rec.write("remote", f);
    rec.write("local", f);
  }
  const saved = await rec.finish();
  assert.equal(path.extname(saved.file), ".wav");
  const wav = fs.readFileSync(saved.file);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  const samples = (wav.length - 44) / 2;
  assert.equal(samples, 16000); // 2 s — the rep's side was padded, not appended
  // First second: lead only; second second: both mixed.
  assert.equal(wav.readInt16LE(44 + 2 * 4000), 1000);
  assert.equal(wav.readInt16LE(44 + 2 * 12000), 4000);
  assert.equal(findRecordingFile(dir, rec.id).contentType, "audio/wav");
});

test("recorder drops calls under 2 seconds", async () => {
  const dir = tmpDir();
  const rec = new CallRecorder({ dir, log: quiet });
  for (const f of frames(20, 500)) rec.write("remote", f);
  assert.equal(await rec.finish(), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("retention sweep deletes recordings older than the limit and stale raw files", async () => {
  const dir = tmpDir();
  const old = "sip-" + "a".repeat(24);
  const fresh = "sip-" + "b".repeat(24);
  const touch = (name, daysAgo) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "x");
    const t = new Date(Date.now() - daysAgo * 86400000);
    fs.utimesSync(file, t, t);
  };
  touch(`${old}.mp3`, 46);
  touch(`${fresh}.mp3`, 44);
  touch("sip-cccccccccccccccccccccccc.local.raw", 2);
  touch("unrelated.txt", 100);
  const removed = await sweepRecordings(dir, 45);
  assert.deepEqual(removed, [old]);
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${fresh}.mp3`, "unrelated.txt"]);
});

test("recording tokens are scoped to one recording", () => {
  const env = { VOICE_GATEWAY_SECRET: "s3cret", VOICE_GATEWAY_URL: "wss://voice.example.com/voice" };
  const token = mintRecordingToken("sip-abc", env);
  assert.equal(verifyRecordingToken(token, "sip-abc", env), true);
  assert.equal(verifyRecordingToken(token, "sip-other", env), false);
  assert.equal(verifyRecordingToken(token, "sip-abc", { VOICE_GATEWAY_SECRET: "wrong" }), false);
  assert.equal(voiceGatewayHttpUrl(env), "https://voice.example.com");
  assert.equal(voiceGatewayHttpUrl({ VOICE_GATEWAY_URL: "ws://localhost:3002/voice" }), "http://localhost:3002");
});

test("gateway records an answered call and reports it with the lead id", async () => {
  const dir = tmpDir();
  const trunk = new FakeTrunk({ username: "T909317", password: "pw" });
  const port = await trunk.listen();
  const ua = new SipUserAgent(
    loadSipConfig({
      SIP_SERVER: "127.0.0.1",
      SIP_PORT: String(port),
      SIP_USERNAME: "T909317",
      SIP_PASSWORD: "pw",
      SIP_CALLER_ID: "+61480851534",
      SIP_MAX_CHANNELS: "1",
      SIP_RTP_PORTS: "45000-45999",
    }),
    { log: quiet }
  );
  await new Promise((resolve) => {
    ua.on("registration", (r) => r.state === "registered" && resolve());
    ua.start();
  });
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let reportRecording;
  const recorded = new Promise((r) => (reportRecording = r));
  const gw = createVoiceGateway({
    ua,
    server,
    verifyToken: () => ({ sub: "1", name: "Rep" }),
    record: () => new CallRecorder({ dir, log: quiet, ffmpegPath: path.join(dir, "no-ffmpeg") }),
    onRecording: reportRecording,
    log: quiet,
  });
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

  const media = await new FakeMedia().open();
  const invitePromise = trunk.next("invite");
  ws.send(JSON.stringify({ type: "dial", ref: "r1", to: "0412345678", leadId: 42 }));
  const invite = await invitePromise;
  const toTag = newTag();
  trunk.reply(invite, 200, "OK", { toTag, body: media.sdp(["PCMA"]), headers: { contact: "<sip:callee@127.0.0.1>" } });
  await nextMsg((m) => m.type === "call-state" && m.state === "answered");

  // 2.2 s from the rep, and some audio from the lead.
  for (const f of frames(110, 5000)) ws.send(Buffer.from(f.buffer));
  for (let i = 0; i < 10; i++) media.sendTo(invite.body, 8, encode("PCMA", new Int16Array(160).fill(4000)));
  await new Promise((r) => setTimeout(r, 200));

  const byePromise = trunk.next("bye");
  ws.send(JSON.stringify({ type: "hangup" }));
  trunk.reply(await byePromise, 200, "OK");

  const saved = await recorded;
  assert.equal(saved.call.leadId, 42);
  assert.equal(saved.call.remoteNumber, "+61412345678");
  assert.equal(saved.seconds, 2);
  assert.ok(fs.existsSync(saved.file));

  ws.close();
  media.close();
  gw.wss.close();
  server.close();
  await ua.stop();
  trunk.close();
});
