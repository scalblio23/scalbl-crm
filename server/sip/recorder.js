// Call recording for the SIP voice gateway. Each answered call writes
// both sides — the rep ("local", what the browser sends, soundboard
// clips included) and the far end ("remote") — as raw 8 kHz PCM, one
// file per side, then mixes them into a single MP3 with ffmpeg once
// the call ends. Without ffmpeg it falls back to a (much larger) WAV
// so a recording is never lost.
//
// The two sides arrive on independent clocks (RTP from the network,
// WebSocket frames from the browser), so each side is laid on a
// wall-clock timeline: a gap longer than the jitter allowance (the
// rep's mic muted, packets lost) is filled with silence, which keeps
// both sides in step for the mix.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomToken } from "./message.js";

const SAMPLE_RATE = 8000;
// How far a side may lag its timeline before silence is inserted —
// generous enough that normal network/browser jitter never adds any.
const JITTER_SAMPLES = SAMPLE_RATE / 5; // 200 ms
// Calls shorter than this aren't worth keeping.
const MIN_SECONDS = 2;

export const RECORDING_ID_RE = /^sip-[a-f0-9]{16,64}$/;
export const RECORDING_TYPES = { ".mp3": "audio/mpeg", ".wav": "audio/wav" };

export function newRecordingId() {
  return `sip-${randomToken(12)}`;
}

// The saved file for a recording id, if it's still there.
export function findRecordingFile(dir, id) {
  if (!RECORDING_ID_RE.test(id)) return null;
  for (const ext of Object.keys(RECORDING_TYPES)) {
    const file = path.join(dir, id + ext);
    if (fs.existsSync(file)) return { file, contentType: RECORDING_TYPES[ext] };
  }
  return null;
}

class Track {
  constructor(file) {
    this.file = file;
    this.stream = fs.createWriteStream(file);
    this.written = 0; // samples
  }
  write(pcm, expectedEnd) {
    // expectedEnd: where on the timeline this frame should finish.
    const gap = expectedEnd - pcm.length - this.written;
    if (gap > JITTER_SAMPLES) {
      this.stream.write(Buffer.alloc(gap * 2));
      this.written += gap;
    }
    this.stream.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    this.written += pcm.length;
  }
  close() {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

export class CallRecorder {
  constructor({ dir, ffmpegPath = "ffmpeg", log = console, now = () => Date.now() }) {
    this.dir = dir;
    this.ffmpegPath = ffmpegPath;
    this.log = log;
    this.now = now;
    this.id = newRecordingId();
    fs.mkdirSync(dir, { recursive: true });
    this.startedAt = now();
    this.tracks = {
      local: new Track(path.join(dir, `${this.id}.local.raw`)),
      remote: new Track(path.join(dir, `${this.id}.remote.raw`)),
    };
    this.finished = null;
  }

  // side: "local" | "remote"; pcm: Int16Array at 8 kHz.
  write(side, pcm) {
    if (this.finished || !pcm?.length) return;
    const elapsed = Math.round(((this.now() - this.startedAt) * SAMPLE_RATE) / 1000);
    this.tracks[side].write(pcm, elapsed);
  }

  // Closes the call's recording. Resolves to { id, file, seconds } or
  // null if the call was too short to keep. Safe to call twice.
  finish() {
    if (!this.finished) this.finished = this.finalize();
    return this.finished;
  }

  async finalize() {
    const { local, remote } = this.tracks;
    await Promise.all([local.close(), remote.close()]);
    const seconds = Math.round(Math.max(local.written, remote.written) / SAMPLE_RATE);
    try {
      if (seconds < MIN_SECONDS) return null;
      const mp3 = path.join(this.dir, `${this.id}.mp3`);
      try {
        await this.encodeMp3(mp3);
        return { id: this.id, file: mp3, seconds };
      } catch (err) {
        this.log.warn(`[recording] ffmpeg failed (${err.message}) — saving ${this.id} as WAV instead`);
        const wav = path.join(this.dir, `${this.id}.wav`);
        await mixToWav(local.file, remote.file, wav);
        return { id: this.id, file: wav, seconds };
      }
    } finally {
      await Promise.all([local, remote].map((t) => fs.promises.rm(t.file, { force: true })));
    }
  }

  encodeMp3(out) {
    const input = (file) => ["-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", file];
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...input(this.tracks.local.file),
      ...input(this.tracks.remote.file),
      "-filter_complex",
      "amix=inputs=2:duration=longest:normalize=0",
      // 16 kHz rather than 8 kHz: every browser decodes MPEG-2 MP3,
      // not all of them decode 8 kHz (MPEG-2.5).
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "24k",
      out,
    ];
    return new Promise((resolve, reject) => {
      let stderr = "";
      let proc;
      try {
        proc = spawn(this.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      } catch (err) {
        reject(err);
        return;
      }
      proc.stderr.on("data", (d) => (stderr += d));
      proc.on("error", reject);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`))));
    });
  }
}

// Fallback mix without ffmpeg: sums both sides into a 16-bit mono WAV.
async function mixToWav(fileA, fileB, out) {
  const [a, b] = await Promise.all([fs.promises.readFile(fileA), fs.promises.readFile(fileB)]);
  const samples = Math.max(a.length, b.length) >> 1;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const s = (i * 2 < a.length ? a.readInt16LE(i * 2) : 0) + (i * 2 < b.length ? b.readInt16LE(i * 2) : 0);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await fs.promises.writeFile(out, Buffer.concat([header, data]));
}

// Deletes recordings older than `days` (and raw files left behind by a
// crash mid-call). Returns the ids of the recordings it removed.
export async function sweepRecordings(dir, days, { now = Date.now() } = {}) {
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const rawCutoff = now - 24 * 60 * 60 * 1000;
  const removed = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const ext = path.extname(name);
    const id = path.basename(name, ext);
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      continue;
    }
    if (ext === ".raw") {
      if (stat.mtimeMs < rawCutoff) await fs.promises.rm(file, { force: true });
      continue;
    }
    if (!(ext in RECORDING_TYPES) || !RECORDING_ID_RE.test(id)) continue;
    if (stat.mtimeMs < cutoff) {
      await fs.promises.rm(file, { force: true });
      removed.push(id);
    }
  }
  return removed;
}
