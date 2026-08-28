// Lets a rep fire off a short pre-recorded clip mid-call and have the
// person on the other end actually hear it — not just play it on the
// rep's own speakers. Built on the Twilio Voice SDK's AudioProcessor
// API (Device.audio.addProcessor): it hands us the raw microphone
// stream, and whatever MediaStream we return becomes what's actually
// sent on the call. So the mic is always passed straight through
// (normal talking keeps working), and playClip() mixes a clip's audio
// into that same outgoing stream on demand via the Web Audio API —
// e.g. for quickly answering a phone's call-screening prompt
// ("please state your name and reason for calling").
//
// One instance lives for the life of the browser tab (added once to
// the Device in getDevice() — see twilioDevice.js) — the SDK calls
// createProcessedStream again on its own whenever a new call's mic
// stream comes up, so this doesn't need to know about individual
// calls at all.
class SoundboardProcessor {
  constructor() {
    this.audioContext = null;
    this.micSource = null;
    this.destination = null;
  }

  async createProcessedStream(stream) {
    if (!this.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Ctx();
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume().catch(() => {});
    }
    this.micSource = this.audioContext.createMediaStreamSource(stream);
    this.destination = this.audioContext.createMediaStreamDestination();
    this.micSource.connect(this.destination);
    return this.destination.stream;
  }

  async destroyProcessedStream() {
    this.micSource?.disconnect();
    this.micSource = null;
    this.destination = null;
  }

  // Plays `audioUrl` (a data: URL works fine) into the current call's
  // outgoing audio, mixed with the live mic. Also plays it through the
  // rep's own speakers so they can hear what the other party's
  // hearing. Resolves once playback finishes.
  playClip(audioUrl) {
    if (!this.destination) {
      return Promise.reject(new Error("No active call to play into."));
    }
    const { audioContext, destination } = this;
    return new Promise((resolve, reject) => {
      const el = new Audio(audioUrl);
      // Wire the routing up before playback starts (matching Twilio's
      // own AudioProcessor example) rather than after — creating the
      // source node redirects the element's output into the Web Audio
      // graph, so doing it first means there's no window where audio
      // could play through the normal (unrouted) path instead.
      const source = audioContext.createMediaElementSource(el);
      source.connect(destination); // into the call
      source.connect(audioContext.destination); // and the rep's own speakers
      const cleanup = () => {
        try {
          source.disconnect();
        } catch {
          // already disconnected — fine
        }
      };
      el.addEventListener("ended", () => {
        cleanup();
        resolve();
      });
      el.addEventListener("error", () => {
        cleanup();
        reject(new Error("Could not play this clip."));
      });
      el.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }
}

let singleton = null;
export function getSoundboardProcessor() {
  if (!singleton) singleton = new SoundboardProcessor();
  return singleton;
}
