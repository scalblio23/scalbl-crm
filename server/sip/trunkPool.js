// Several SIP accounts on one provider, used as one bigger trunk.
//
// Crazytel (and VoIPcloud) give each SIP account one simultaneous call,
// so more lines means more accounts. TrunkPool runs one SipUserAgent per
// account (from SIP_TRUNKS_FILE, see loadSipConfigs in ./config.js) and
// presents the same surface the gateway already uses on a single
// SipUserAgent: dial(), channels, registration, status(), and the
// "registration" / "incoming" events. Every account keeps its own
// connection, registration, calls and caller ID.
//
// Outbound calls go round-robin from the account after the last one used,
// skipping accounts that are busy or not registered. A live transfer is
// just another dial(), so it lands on another free account and both legs
// hold their account until the call ends.
import { EventEmitter } from "events";
import { SipUserAgent, ChannelsBusyError } from "./ua.js";

export class TrunkPool extends EventEmitter {
  constructor(configs, { log = console, createUa } = {}) {
    super();
    if (!configs?.length) throw new Error("TrunkPool needs at least one SIP account");
    this.log = log;
    this.trunks = configs.map((config) => (createUa ? createUa(config) : new SipUserAgent(config, { log })));
    this.next = 0;
    const callerIds = configs.map((c) => c.callerId).filter(Boolean);
    // What the gateway reads from ua.config: the first account's number
    // as the headline caller ID, plus every account's number.
    this.config = { ...configs[0], callerId: callerIds[0] || "", callerIds };
    delete this.config.password;
    const pool = this;
    this.channels = {
      get max() {
        return pool.trunks.reduce((n, ua) => n + ua.channels.max, 0);
      },
      get inUse() {
        return pool.trunks.reduce((n, ua) => n + ua.channels.inUse, 0);
      },
      // Only free lines on registered accounts can take a call.
      get available() {
        return pool.trunks.reduce((n, ua) => n + (ua.isRegistered ? ua.channels.available : 0), 0);
      },
      snapshot() {
        return {
          max: this.max,
          inUse: this.inUse,
          available: this.available,
          calls: pool.trunks.flatMap((ua) => ua.channels.snapshot().calls),
        };
      },
    };
    for (const ua of this.trunks) {
      ua.on("registration", () => this.emit("registration", this.registration));
      ua.on("incoming", (call) => this.emit("incoming", call));
    }
  }

  // Usable when at least one account is registered; `degraded` flags
  // that some (not all) are.
  get registration() {
    const regs = this.trunks.map((ua) => ua.registration);
    const registered = regs.filter((r) => r.state === "registered");
    if (registered.length) {
      return {
        state: "registered",
        error: "",
        degraded: registered.length < regs.length,
        expiresAt: Math.min(...registered.map((r) => r.expiresAt || Infinity)),
      };
    }
    const first = regs.find((r) => r.error) || regs[0];
    return { state: first.state, error: first.error || "", degraded: false, expiresAt: 0 };
  }

  get isRegistered() {
    return this.trunks.some((ua) => ua.isRegistered);
  }

  // Every account's live calls, keyed by Call-ID (read-only view).
  get calls() {
    return new Map(this.trunks.flatMap((ua) => [...ua.calls]));
  }

  start() {
    for (const ua of this.trunks) ua.start();
  }

  async stop() {
    await Promise.all(this.trunks.map((ua) => ua.stop().catch(() => {})));
  }

  dial(number, opts = {}) {
    if (!this.isRegistered) {
      const { error } = this.registration;
      throw new Error(`No SIP trunk is registered${error ? ` (${error})` : ""} — can't place calls yet.`);
    }
    const n = this.trunks.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.next + i) % n;
      const ua = this.trunks[idx];
      if (!ua.isRegistered || ua.channels.available < 1) continue;
      this.next = (idx + 1) % n;
      return ua.dial(number, opts);
    }
    throw new ChannelsBusyError(
      `No registered SIP trunk has a free channel — all ${this.channels.max} lines are in use. Hang up a call first.`
    );
  }

  status() {
    return {
      registration: this.registration,
      channels: this.channels.snapshot(),
      callerId: this.config.callerId,
      callerIds: this.config.callerIds,
      server: `${this.config.server}:${this.config.port}/${this.config.transport}`,
      trunks: this.trunks.map((ua) => ({ id: ua.config.id || ua.config.username, ...ua.status() })),
    };
  }
}
