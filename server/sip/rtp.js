// One call's RTP media stream: a UDP socket that sends 20 ms G.711
// frames on a steady clock (mic audio when there is some, silence
// otherwise) and decodes whatever arrives. Also sends and receives
// RFC 4733 telephone-events for DTMF.
//
// Symmetric RTP: the far end's actual source address is latched from
// the first packet received, which is what makes media work when the
// gateway (or the provider's media server) sits behind NAT.
import dgram from "dgram";
import crypto from "crypto";
import { EventEmitter } from "events";
import { encode, decode, silenceByte } from "./g711.js";

const SAMPLES_PER_FRAME = 160; // 20 ms at 8 kHz
const FRAME_MS = 20;
const MAX_QUEUED_SAMPLES = 8000 * 0.4; // cap mic backlog at 400 ms
const DTMF_EVENTS = "0123456789*#ABCD";

export class RtpSession extends EventEmitter {
  constructor({ portMin = 10000, portMax = 10999 } = {}) {
    super();
    this.portMin = portMin;
    this.portMax = portMax;
    this.socket = null;
    this.localPort = 0;
    this.remote = null; // { address, port } from SDP
    this.latched = null; // actual source seen on the wire
    this.codec = null; // { pt, name }
    this.dtmfPt = null;
    this.ssrc = crypto.randomBytes(4).readUInt32BE(0);
    this.seq = crypto.randomBytes(2).readUInt16BE(0);
    this.timestamp = crypto.randomBytes(4).readUInt32BE(0);
    this.marker = true;
    this.queue = new Int16Array(0);
    this.dtmfQueue = [];
    this.dtmfActive = null;
    this.lastRxDtmfTs = null;
    this.timer = null;
    this.sending = false;
    this.paused = false; // on hold: stop sending
    this.packetsIn = 0;
    this.lastPacketAt = 0;
  }

  async open() {
    const span = Math.max(2, this.portMax - this.portMin);
    for (let attempt = 0; attempt < 50; attempt++) {
      // RTP ports are conventionally even (RTCP takes the odd one above).
      const port = this.portMin + (Math.floor(Math.random() * (span / 2)) * 2);
      try {
        await this.bind(port);
        return this.localPort;
      } catch {
        // taken — try another
      }
    }
    throw new Error(`No free RTP port in ${this.portMin}-${this.portMax}`);
  }

  bind(port) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      const onError = (err) => {
        socket.close();
        reject(err);
      };
      socket.once("error", onError);
      socket.bind(port, () => {
        socket.off("error", onError);
        socket.on("error", (err) => this.emit("error", err));
        socket.on("message", (buf, rinfo) => this.onPacket(buf, rinfo));
        this.socket = socket;
        this.localPort = port;
        resolve();
      });
    });
  }

  setRemote(address, port) {
    if (!address || !port) return;
    const changed = !this.remote || this.remote.address !== address || this.remote.port !== port;
    this.remote = { address, port };
    if (changed) this.latched = null;
  }

  setCodec(codec, dtmfPt) {
    this.codec = codec;
    this.dtmfPt = dtmfPt ?? null;
  }

  // Starts the 20 ms send clock. Sending even silence right away
  // opens the NAT pinhole so the provider's early media (network
  // ringback) and answered-call audio can reach us.
  start() {
    if (this.sending) return;
    this.sending = true;
    let next = Date.now();
    const tick = () => {
      if (!this.sending) return;
      const now = Date.now();
      // Fell badly behind (event loop stall) — resync instead of bursting.
      if (now - next > 200) next = now;
      while (next <= now) {
        this.sendFrame();
        next += FRAME_MS;
      }
      this.timer = setTimeout(tick, Math.max(1, next - Date.now()));
    };
    tick();
  }

  // Microphone audio in, as 16-bit 8 kHz mono samples of any length.
  pushAudio(samples) {
    if (!samples.length) return;
    let merged = new Int16Array(this.queue.length + samples.length);
    merged.set(this.queue, 0);
    merged.set(samples, this.queue.length);
    if (merged.length > MAX_QUEUED_SAMPLES) merged = merged.subarray(merged.length - MAX_QUEUED_SAMPLES);
    this.queue = merged;
  }

  sendDtmf(digits) {
    for (const d of String(digits).toUpperCase()) {
      const event = DTMF_EVENTS.indexOf(d);
      if (event >= 0) this.dtmfQueue.push(event);
    }
  }

  destination() {
    return this.latched || this.remote;
  }

  writePacket(pt, payload, { marker = false, timestamp = this.timestamp } = {}) {
    const dest = this.destination();
    if (!dest || !this.socket) return;
    const header = Buffer.allocUnsafe(12);
    header[0] = 0x80;
    header[1] = (marker ? 0x80 : 0) | (pt & 0x7f);
    header.writeUInt16BE(this.seq, 2);
    header.writeUInt32BE(timestamp >>> 0, 4);
    header.writeUInt32BE(this.ssrc, 8);
    this.seq = (this.seq + 1) & 0xffff;
    this.socket.send(Buffer.concat([header, payload]), dest.port, dest.address);
  }

  sendFrame() {
    // Take this frame's audio off the queue either way, so the mic
    // doesn't fall behind while DTMF is playing.
    let frame;
    if (this.queue.length >= SAMPLES_PER_FRAME) {
      frame = this.queue.subarray(0, SAMPLES_PER_FRAME);
      this.queue = this.queue.subarray(SAMPLES_PER_FRAME);
    }

    if (!this.codec || this.paused) {
      this.timestamp = (this.timestamp + SAMPLES_PER_FRAME) >>> 0;
      return;
    }

    if (this.dtmfActive || (this.dtmfQueue.length && this.dtmfPt !== null)) {
      this.sendDtmfFrame();
    } else {
      const payload = frame ? encode(this.codec.name, frame) : Buffer.alloc(SAMPLES_PER_FRAME, silenceByte(this.codec.name));
      this.writePacket(this.codec.pt, payload, { marker: this.marker });
      this.marker = false;
    }
    this.timestamp = (this.timestamp + SAMPLES_PER_FRAME) >>> 0;
  }

  // RFC 4733: one event spans several packets sharing the event's start
  // timestamp, with a growing duration; the last three carry the E bit.
  // A short gap of silence follows so consecutive digits register.
  sendDtmfFrame() {
    const TONE_FRAMES = 8; // 160 ms tone
    const GAP_FRAMES = 4; // 80 ms gap
    if (!this.dtmfActive) {
      this.dtmfActive = { event: this.dtmfQueue.shift(), startTs: this.timestamp, frame: 0 };
    }
    const d = this.dtmfActive;
    d.frame++;
    if (d.frame <= TONE_FRAMES + 2) {
      const ending = d.frame >= TONE_FRAMES;
      const duration = Math.min(d.frame, TONE_FRAMES) * SAMPLES_PER_FRAME;
      const payload = Buffer.from([d.event, (ending ? 0x80 : 0) | 10, (duration >> 8) & 0xff, duration & 0xff]);
      this.writePacket(this.dtmfPt, payload, { marker: d.frame === 1, timestamp: d.startTs });
      return;
    }
    // Gap: keep the clock and the stream alive with silence.
    this.writePacket(this.codec.pt, Buffer.alloc(SAMPLES_PER_FRAME, silenceByte(this.codec.name)));
    if (d.frame >= TONE_FRAMES + 2 + GAP_FRAMES) this.dtmfActive = null;
  }

  onPacket(buf, rinfo) {
    if (buf.length < 12 || buf[0] >> 6 !== 2) return;
    // Latch onto the far end's real source address (symmetric RTP).
    // Stray packets from elsewhere are ignored while the latched source
    // is live; if it's gone quiet, the stream has moved (e.g. early
    // media and the answered call coming from different media servers).
    if (!this.latched || this.latched.address !== rinfo.address || this.latched.port !== rinfo.port) {
      if (this.latched && Date.now() - this.lastPacketAt < 500) return;
      this.latched = { address: rinfo.address, port: rinfo.port };
    }
    this.packetsIn++;
    this.lastPacketAt = Date.now();

    const csrcCount = buf[0] & 0x0f;
    const hasExtension = buf[0] & 0x10;
    const hasPadding = buf[0] & 0x20;
    const pt = buf[1] & 0x7f;
    let offset = 12 + csrcCount * 4;
    if (hasExtension) {
      if (buf.length < offset + 4) return;
      offset += 4 + buf.readUInt16BE(offset + 2) * 4;
    }
    let end = buf.length;
    if (hasPadding) end -= buf[buf.length - 1];
    if (end <= offset) return;
    const payload = buf.subarray(offset, end);

    if (this.dtmfPt !== null && pt === this.dtmfPt) {
      const ts = buf.readUInt32BE(4);
      if (payload.length >= 4 && ts !== this.lastRxDtmfTs) {
        this.lastRxDtmfTs = ts;
        const digit = DTMF_EVENTS[payload[0]];
        if (digit) this.emit("dtmf", digit);
      }
      return;
    }
    if (this.codec && pt === this.codec.pt) {
      this.emit("audio", decode(this.codec.name, payload));
    } else if (pt === 0 || pt === 8) {
      // Early media occasionally arrives in the other G.711 law before
      // the answer pins the codec down — decode it anyway.
      this.emit("audio", decode(pt === 0 ? "PCMU" : "PCMA", payload));
    }
  }

  close() {
    this.sending = false;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // already closed
      }
      this.socket = null;
    }
    this.removeAllListeners("audio");
    this.removeAllListeners("dtmf");
  }
}
