// Browser softphone for the SIP trunk (VoIPcloud/VoIPline) — the SIP
// equivalent of twilioDevice.js, with the same call-object shape so
// the Powerdialler doesn't care which one it's talking to.
//
// The browser never speaks SIP itself: it holds one WebSocket to the
// voice gateway (server/voiceGateway.js), which owns the SIP
// registration and RTP. Over that socket go JSON control messages and
// raw audio — 16-bit mono PCM at 8 kHz, 20 ms per frame — resampled
// to/from the sound card here by two small AudioWorklets.
//
// Call objects emit the same events the Twilio SDK's Call does, so the
// existing UI wiring works unchanged:
//   "ringing", "accept", "disconnect" (info), "cancel", "error" (err)
// plus "dtmf" (digit) and, for multi-line, "legs" (legs[]).
// "disconnect" carries { outcome, outcomeMessage } — outcome is
// busy / no-answer / declined / hangup-local / hangup-remote / …
import { getSoundboardProcessor } from "./soundboardProcessor";

const WORKLET_SOURCE = `
class SipCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 8000;
    this.pos = 0; this.acc = 0; this.n = 0;
    this.frame = new Int16Array(160); this.i = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      for (let k = 0; k < input.length; k++) {
        // Box-filter decimation to 8 kHz: average every input sample
        // that falls into one output sample's window.
        this.acc += input[k]; this.n++; this.pos += 1;
        if (this.pos >= this.ratio) {
          this.pos -= this.ratio;
          let v = this.acc / this.n; this.acc = 0; this.n = 0;
          v = v < -1 ? -1 : v > 1 ? 1 : v;
          this.frame[this.i++] = v < 0 ? v * 0x8000 : v * 0x7fff;
          if (this.i === 160) {
            this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
            this.frame = new Int16Array(160); this.i = 0;
          }
        }
      }
    }
    return true;
  }
}
class SipPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 16000; this.buf = new Float32Array(this.size);
    this.r = 0; this.w = 0; this.count = 0;
    this.step = 8000 / sampleRate; this.frac = 0; this.primed = false;
    this.port.onmessage = (e) => {
      if (e.data === "flush") { this.r = this.w = this.count = 0; this.primed = false; return; }
      const s = new Int16Array(e.data);
      for (let k = 0; k < s.length; k++) {
        this.buf[this.w] = s[k] / 32768;
        this.w = (this.w + 1) % this.size;
        this.count++;
      }
      // More than 300 ms queued (network hiccup then a burst) — skip
      // ahead to ~100 ms so the conversation doesn't lag behind.
      if (this.count > 2400) {
        const drop = this.count - 800;
        this.r = (this.r + drop) % this.size;
        this.count -= drop;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    // 60 ms jitter buffer before playback starts (or restarts).
    if (!this.primed && this.count >= 480) this.primed = true;
    for (let k = 0; k < out.length; k++) {
      if (!this.primed || this.count < 2) { out[k] = 0; this.primed = false; continue; }
      const a = this.buf[this.r], b = this.buf[(this.r + 1) % this.size];
      out[k] = a + (b - a) * this.frac;
      this.frac += this.step;
      while (this.frac >= 1) { this.frac -= 1; this.r = (this.r + 1) % this.size; this.count--; }
    }
    return true;
  }
}
registerProcessor("sip-capture", SipCapture);
registerProcessor("sip-playback", SipPlayback);
`;

class Emitter {
  constructor() {
    this.listeners = {};
  }
  on(event, fn) {
    (this.listeners[event] ||= new Set()).add(fn);
    return this;
  }
  off(event, fn) {
    this.listeners[event]?.delete(fn);
    return this;
  }
  emit(event, ...args) {
    for (const fn of [...(this.listeners[event] || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error("[sipDevice] listener error", err);
      }
    }
  }
}

class SipCall extends Emitter {
  constructor(direction, props = {}) {
    super();
    this.direction = direction;
    this.callId = null;
    this.answered = false;
    Object.assign(this, props);
  }
  // Same values the Twilio Call's status() uses where the Powerdialler
  // checks it: "closed" once this call is over.
  status() {
    if (current !== this) return "closed";
    return this.answered ? "open" : "ringing";
  }
  sendDigits(digits) {
    send({ type: "dtmf", digits: String(digits) });
  }
  disconnect() {
    if (current === this) send({ type: "hangup" });
  }
  // Inbound only.
  accept() {
    return answerIncoming(this);
  }
  reject() {
    incomingOffers.delete(this.callId);
    send({ type: "reject", callId: this.callId });
  }
}

let config = null; // { gatewayUrl, token, callerIds }
let fetchConfig = null; // async () => fresh config (new token) for reconnects
let ws = null;
let ready = false;
let connectPromise = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let status = { connected: false, registration: { state: "unknown", error: "" }, callerId: "", lastError: "" };
let current = null; // the rep's one active call (outbound, answered inbound, or multi-line round)
let pending = null; // { ref, call, resolve, reject } — a dial waiting on the gateway's go-ahead
let nextRef = 1;
const incomingOffers = new Map(); // callId → SipCall
const incomingListeners = new Set();
const statusListeners = new Set();

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of statusListeners) fn(status);
}

// ---------- connection ----------

// Called once with the /api/token response; connects straight away so
// inbound calls can ring this browser even before it places a call.
export function configureSip(initialConfig, refetchConfig) {
  config = initialConfig;
  fetchConfig = refetchConfig;
  ensureConnected().catch(() => {}); // failures reconnect in the background
}

function ensureConnected() {
  if (ready && ws?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;
  if (!config?.gatewayUrl) return Promise.reject(new Error("The voice gateway URL isn't configured (VOICE_GATEWAY_URL)."));
  connectPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(`${config.gatewayUrl}?token=${encodeURIComponent(config.token)}`);
    socket.binaryType = "arraybuffer";
    ws = socket;
    let settled = false;
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        // Real audio from the network before answer (early media) is
        // its own ringback or an announcement — let that play instead.
        if (ringback && hasSound(ev.data)) stopRingback();
        playbackNode?.port.postMessage(ev.data, [ev.data]);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "hello") {
        ready = true;
        settled = true;
        reconnectDelay = 1000;
        connectPromise = null;
        setStatus({ connected: true, registration: msg.registration, callerId: msg.callerId, lastError: "" });
        resolve();
      }
      handleMessage(msg);
    };
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (ws !== socket) return;
      ws = null;
      ready = false;
      connectPromise = null;
      setStatus({ connected: false });
      const error = new Error(
        ev.code === 4001
          ? "The voice gateway rejected this browser's login token — check VOICE_GATEWAY_SECRET matches on both servers."
          : settled
            ? "Lost connection to the voice gateway — reconnecting."
            : `Can't reach the voice gateway at ${config.gatewayUrl}. Is it running (npm run voice-gateway)?`
      );
      setStatus({ lastError: error.message });
      if (!settled) {
        settled = true;
        reject(error);
      }
      onConnectionLost();
      scheduleReconnect();
    };
  });
  return connectPromise;
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  reconnectTimer = setTimeout(async () => {
    try {
      // Tokens are short-lived — get a fresh one for each reconnect.
      if (fetchConfig) config = await fetchConfig();
      await ensureConnected();
    } catch {
      scheduleReconnect();
    }
  }, delay);
}

function onConnectionLost() {
  if (pending) {
    pending.reject(new Error("Lost connection to the voice gateway."));
    pending = null;
  }
  if (current) {
    const call = current;
    finishCall();
    call.emit("error", new Error("Lost connection to the voice gateway — the call was dropped."));
  }
  for (const offer of incomingOffers.values()) offer.emit("cancel", { reason: "gateway-disconnected" });
  incomingOffers.clear();
}

// ---------- gateway messages ----------

function handleMessage(msg) {
  switch (msg.type) {
    case "registration":
      setStatus({ registration: { state: msg.state, error: msg.error || "" } });
      return;
    case "call-started":
      if (pending && msg.ref !== undefined && msg.ref === pending.ref) {
        pending.call.callId = msg.callId;
        pending.resolve({ call: pending.call, callerId: msg.callerId || status.callerId });
        pending = null;
      } else if (current && msg.direction === "inbound") {
        current.callId = msg.callId;
      }
      return;
    case "dial-error":
      if (pending && (msg.ref === undefined || msg.ref === pending.ref)) {
        pending.reject(new Error(msg.message));
        pending = null;
        finishCall();
      } else if (current && !current.answered) {
        const call = current;
        finishCall();
        call.emit("error", new Error(msg.message));
      }
      return;
    case "call-state":
      if (!current || current.callId !== msg.callId) return;
      if (msg.state === "ringing") {
        startRingback();
        current.emit("ringing");
      }
      if (msg.state === "answered" && !current.answered) {
        stopRingback();
        current.answered = true;
        current.emit("accept", current);
      }
      return;
    case "call-ended": {
      if (!current || current.callId !== msg.callId) return;
      const call = current;
      finishCall();
      if (msg.reason === "failed") call.emit("error", new Error(msg.message || "The call failed."));
      else call.emit("disconnect", { outcome: msg.reason, outcomeMessage: msg.message || "" });
      return;
    }
    case "dtmf":
      current?.emit("dtmf", msg.digit);
      return;
    case "incoming": {
      const offer = new SipCall("inbound", { callId: msg.callId, from: msg.from, name: msg.name });
      incomingOffers.set(msg.callId, offer);
      for (const fn of incomingListeners) fn(offer);
      return;
    }
    case "incoming-gone": {
      // Caller hung up (or someone else answered) just as this rep
      // clicked Answer — drop the half-started call.
      if (current && current.callId === msg.callId && !current.answered) {
        const call = current;
        finishCall();
        call.emit("cancel", { reason: msg.reason });
        return;
      }
      const offer = incomingOffers.get(msg.callId);
      if (!offer) return;
      incomingOffers.delete(msg.callId);
      offer.emit("cancel", { reason: msg.reason });
      return;
    }
    case "multi-legs":
      if (pending?.multi && msg.ref === pending.ref) {
        pending.resolve({ call: pending.call, callerId: status.callerId });
        pending = null;
      }
      if (current?.multi && current.ref === msg.ref) {
        if (!current.answered && msg.legs?.some((l) => l.status === "ringing")) startRingback();
        current.emit("legs", msg.legs);
      }
      return;
    case "multi-answered":
      if (!current?.multi || current.ref !== msg.ref) return;
      stopRingback();
      current.callId = msg.callId;
      current.answered = true;
      current.emit("accept", { legRef: msg.legRef, to: msg.to });
      return;
    case "multi-ended":
      if (!current?.multi || current.ref !== msg.ref) return;
      {
        const call = current;
        finishCall();
        call.emit("disconnect", { outcome: "no-answer", outcomeMessage: "No answer on any line." });
      }
      return;
    default:
  }
}

// ---------- audio ----------

let audioCtx = null;
let workletReady = null;
let captureNode = null;
let playbackNode = null;
let sinkNode = null;
let micStream = null;
let micSource = null;

async function ensureAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    workletReady = audioCtx.audioWorklet.addModule(url);
  }
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  await workletReady;
}

async function startAudio() {
  await ensureAudioContext();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    throw new Error("Microphone access is needed to make calls — allow it in your browser and try again.");
  }
  // Route the mic through the soundboard mixer (see
  // soundboardProcessor.js) so clips are heard by the other party.
  let outgoing = micStream;
  try {
    outgoing = await getSoundboardProcessor().createProcessedStream(micStream);
  } catch (err) {
    console.warn("[sipDevice] Soundboard unavailable:", err);
  }
  micSource = audioCtx.createMediaStreamSource(outgoing);
  captureNode = new AudioWorkletNode(audioCtx, "sip-capture", { numberOfOutputs: 1 });
  captureNode.port.onmessage = (e) => {
    if (current && ws?.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  // A silent sink keeps the capture node pulled by the audio graph.
  sinkNode = audioCtx.createGain();
  sinkNode.gain.value = 0;
  micSource.connect(captureNode).connect(sinkNode).connect(audioCtx.destination);

  playbackNode = new AudioWorkletNode(audioCtx, "sip-playback", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  playbackNode.connect(audioCtx.destination);
}

function stopAudio() {
  for (const node of [micSource, captureNode, sinkNode, playbackNode]) {
    try {
      node?.disconnect();
    } catch {
      // already disconnected
    }
  }
  if (captureNode) captureNode.port.onmessage = null;
  micSource = captureNode = sinkNode = playbackNode = null;
  getSoundboardProcessor()
    .destroyProcessedStream()
    .catch(() => {});
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

function finishCall() {
  current = null;
  stopRingback();
  stopAudio();
}

// ---------- ringback ----------
// VoIPcloud signals ringing (SIP 180) without sending any audio, so
// without this the rep hears silence while the lead's phone rings.
// Plays the Australian ringback tone locally instead — 400 + 450 Hz,
// 0.4 s on, 0.2 s off, 0.4 s on, 2 s off — until the call is answered
// or ends, or the network sends its own early media.
const RINGBACK_LEVEL = 0.06;
const RINGBACK_CYCLE = 3;
let ringback = null; // { gain, oscillators, timer }

function startRingback() {
  if (ringback || !audioCtx) return;
  const gain = audioCtx.createGain();
  gain.gain.value = 0;
  gain.connect(audioCtx.destination);
  const oscillators = [400, 450].map((freq) => {
    const osc = audioCtx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start();
    return osc;
  });
  let next = audioCtx.currentTime + 0.05;
  const scheduleAhead = () => {
    while (next < audioCtx.currentTime + RINGBACK_CYCLE + 0.5) {
      gain.gain.setValueAtTime(RINGBACK_LEVEL, next);
      gain.gain.setValueAtTime(0, next + 0.4);
      gain.gain.setValueAtTime(RINGBACK_LEVEL, next + 0.6);
      gain.gain.setValueAtTime(0, next + 1.0);
      next += RINGBACK_CYCLE;
    }
  };
  scheduleAhead();
  ringback = { gain, oscillators, timer: setInterval(scheduleAhead, 500) };
}

function stopRingback() {
  if (!ringback) return;
  const { gain, oscillators, timer } = ringback;
  ringback = null;
  clearInterval(timer);
  for (const osc of oscillators) {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      // already stopped
    }
  }
  gain.disconnect();
}

// Whether a frame of 16-bit PCM from the gateway is more than silence.
function hasSound(buffer) {
  const samples = new Int16Array(buffer);
  for (let i = 0; i < samples.length; i += 4) {
    if (Math.abs(samples[i]) > 600) return true;
  }
  return false;
}

// ---------- calls ----------

// Same Australia-first E.164 normalization as twilioDevice.js.
function toE164(rawPhone) {
  const cleaned = String(rawPhone || "").replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("0")) return `+61${cleaned.slice(1)}`;
  if (cleaned.startsWith("61")) return `+${cleaned}`;
  return cleaned;
}

async function begin(call, message) {
  await ensureConnected();
  if (current) throw new Error("There's already a call in progress.");
  current = call;
  try {
    await startAudio();
  } catch (err) {
    finishCall();
    throw err;
  }
  return new Promise((resolve, reject) => {
    pending = { ref: message.ref, call, resolve, reject, multi: message.type === "dial-multi" };
    send(message);
  });
}

// Returns { call, callerId } like twilioDevice.placeCall.
export function placeCall(phoneNumber) {
  const to = toE164(phoneNumber);
  const ref = nextRef++;
  return begin(new SipCall("outbound", { to }), { type: "dial", ref, to });
}

// Rings several leads at once on separate SIP channels; the first to
// answer is bridged in and the rest are cancelled (all on the gateway).
// `legs` is [{ ref, phone }]. The call emits "legs" with per-lead
// statuses and "accept" with { legRef } for the winner.
export function placeMultilineCall(legs, { ringSeconds } = {}) {
  const ref = nextRef++;
  const call = new SipCall("outbound", { multi: true, ref });
  return begin(call, {
    type: "dial-multi",
    ref,
    ringSeconds,
    legs: legs.map((l) => ({ ref: l.ref, to: toE164(l.phone) })),
  });
}

async function answerIncoming(offer) {
  if (!incomingOffers.has(offer.callId)) throw new Error("That call has already ended.");
  if (current) throw new Error("Finish your current call before answering.");
  incomingOffers.delete(offer.callId);
  current = offer;
  try {
    await startAudio();
  } catch (err) {
    finishCall();
    send({ type: "reject", callId: offer.callId });
    throw err;
  }
  send({ type: "answer", callId: offer.callId });
}

export function hangUp() {
  if (current || pending) send({ type: "hangup" });
}

export function sendDigits(digits) {
  current?.sendDigits(digits);
}

export function onIncomingCall(listener) {
  incomingListeners.add(listener);
  return () => incomingListeners.delete(listener);
}

export function onStatus(listener) {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}
