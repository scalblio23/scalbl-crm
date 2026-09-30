// Sums several 8 kHz audio streams into one, 20 ms at a time. Each
// source keeps its own queue, so streams arriving on different clocks
// (RTP from two calls, WebSocket frames from a browser) mix instead of
// being played one after the other.
export const SAMPLES_PER_FRAME = 160; // 20 ms at 8 kHz
const MAX_QUEUED_SAMPLES = 8000 * 0.4; // cap each source's backlog at 400 ms

export class FrameMixer {
  constructor() {
    this.queues = new Map();
  }

  push(samples, source = "main") {
    if (!samples.length) return;
    const queue = this.queues.get(source) || new Int16Array(0);
    let merged = new Int16Array(queue.length + samples.length);
    merged.set(queue, 0);
    merged.set(samples, queue.length);
    if (merged.length > MAX_QUEUED_SAMPLES) merged = merged.subarray(merged.length - MAX_QUEUED_SAMPLES);
    this.queues.set(source, merged);
  }

  drop(source) {
    this.queues.delete(source);
  }

  // The next 20 ms frame — every source that has one, summed — or null
  // if none has a full frame yet.
  take() {
    let frame = null;
    for (const [source, queue] of this.queues) {
      if (queue.length < SAMPLES_PER_FRAME) continue;
      const part = queue.subarray(0, SAMPLES_PER_FRAME);
      this.queues.set(source, queue.subarray(SAMPLES_PER_FRAME));
      if (!frame) {
        frame = Int16Array.from(part);
        continue;
      }
      for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
        frame[i] = Math.max(-32768, Math.min(32767, frame[i] + part[i]));
      }
    }
    return frame;
  }
}

// A FrameMixer on its own 20 ms clock, calling onFrame with each mixed
// frame — used for what a rep hears during a three-way transfer call.
export class TimedMixer extends FrameMixer {
  constructor(onFrame) {
    super();
    let next = Date.now();
    const tick = () => {
      const now = Date.now();
      if (now - next > 200) next = now;
      while (next <= now) {
        const frame = this.take();
        if (frame) onFrame(frame);
        next += 20;
      }
      this.timer = setTimeout(tick, Math.max(1, next - Date.now()));
    };
    this.timer = setTimeout(tick, 20);
  }

  stop() {
    clearTimeout(this.timer);
    this.queues.clear();
  }
}
