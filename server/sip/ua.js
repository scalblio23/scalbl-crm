// The SIP user agent for the trunk: keeps the registration alive
// (REGISTER with digest auth, refreshed before it expires, redone on
// every reconnect), runs client transactions, and routes incoming
// requests to the right call. Calls themselves live in call.js.
//
// Events:
//   "registration" ({ state, error, expiresAt })
//   "incoming"     (call)  — a new inbound call, already ringing
import { EventEmitter } from "events";
import {
  createRequest,
  createResponse,
  newBranch,
  newCallId,
  newTag,
  parseNameAddr,
  parseParams,
} from "./message.js";
import { parseChallenge, buildDigestAuthorization } from "./digest.js";
import { SipTransport } from "./transport.js";
import { ChannelPool } from "./channels.js";
import { Call } from "./call.js";

const TIMER_B_MS = 32000;
export const ALLOW = "INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, UPDATE, NOTIFY";

export class ChannelsBusyError extends Error {}

export class SipUserAgent extends EventEmitter {
  constructor(config, { log = console, transport } = {}) {
    super();
    this.config = config;
    this.log = log;
    this.transport = transport || new SipTransport(config, { log });
    this.channels = new ChannelPool(config.maxChannels);
    this.transactions = new Map(); // `${branch}:${method}` → pending client transaction
    this.calls = new Map(); // Call-ID → Call
    this.registration = { state: "idle", error: "", expiresAt: 0 };
    this.regCallId = newCallId(config.domain);
    this.regFromTag = newTag();
    this.regCseq = Math.floor(Math.random() * 1000) + 1;
    this.regTimer = null;
    this.regFailures = 0;
    this.registering = false;
    this.natContact = null; // { host, port } learned from the registrar's Via received/rport

    this.transport.on("message", (msg) => this.onMessage(msg));
    this.transport.on("connected", () => this.register());
    this.transport.on("connect-failed", (err) =>
      this.setRegistration("failed", `Can't connect to ${config.server}:${config.port} over ${config.transport.toUpperCase()}: ${err.message}`)
    );
    this.transport.on("disconnected", () => {
      clearTimeout(this.regTimer);
      this.setRegistration("unregistered", "Connection to the SIP server dropped — reconnecting");
      for (const [key, tx] of this.transactions) {
        this.transactions.delete(key);
        clearTimeout(tx.timer);
        tx.reject(new Error("Connection to the SIP server was lost"));
      }
    });
  }

  start() {
    this.setRegistration("connecting");
    this.transport.start();
  }

  async stop() {
    clearTimeout(this.regTimer);
    for (const call of this.calls.values()) call.hangup();
    if (this.registration.state === "registered") {
      await this.register({ expires: 0 }).catch(() => {});
    }
    this.transport.stop();
  }

  get isRegistered() {
    return this.registration.state === "registered";
  }

  setRegistration(state, error = "") {
    this.registration = { ...this.registration, state, error };
    this.emit("registration", this.registration);
  }

  // ---------- addressing ----------

  contactHostPort() {
    const { publicIp, listenPort } = this.config;
    if (publicIp) return { host: publicIp, port: listenPort || this.transport.localPort };
    if (this.natContact) return this.natContact;
    return { host: this.transport.localAddress, port: this.transport.localPort };
  }

  contactUri() {
    const { host, port } = this.contactHostPort();
    return `sip:${this.config.username}@${host}:${port};transport=${this.config.transport}`;
  }

  // The address to put in SDP for RTP: an explicit public IP, else the
  // public address the registrar saw us from, else the local one.
  mediaIp() {
    return this.config.publicIp || this.natContact?.host || this.transport.localAddress || "0.0.0.0";
  }

  via(branch = newBranch()) {
    return `SIP/2.0/${this.transport.protocol} ${this.transport.localAddress}:${this.transport.localPort};branch=${branch};rport`;
  }

  // A new request with the standard headers filled in.
  buildRequest(method, uri, { callId, from, to, cseq, branch, routes = [] }) {
    const req = createRequest(method, uri);
    req.add("via", this.via(branch));
    req.set("max-forwards", 70);
    for (const r of routes) req.add("route", r);
    req.set("from", from);
    req.set("to", to);
    req.set("call-id", callId);
    req.set("cseq", `${cseq} ${method}`);
    req.set("user-agent", this.config.userAgent);
    return req;
  }

  // ---------- transactions ----------

  // Sends a request and resolves with its final response. Provisional
  // responses go to onProvisional. Over TCP there are no
  // retransmissions to manage — only the Timer B/F timeout, which for
  // an INVITE stops once it's had any provisional response (from then
  // on the call's own ring timeout is in charge).
  sendRequest(req, { onProvisional } = {}) {
    return new Promise((resolve, reject) => {
      const key = `${req.branch}:${req.method}`;
      const tx = { resolve, reject, onProvisional, method: req.method, timer: null };
      tx.timer = setTimeout(() => {
        this.transactions.delete(key);
        reject(new Error(`${req.method} timed out — no response from the SIP server`));
      }, TIMER_B_MS);
      this.transactions.set(key, tx);
      try {
        this.transport.send(req);
      } catch (err) {
        clearTimeout(tx.timer);
        this.transactions.delete(key);
        reject(err);
      }
    });
  }

  // Fire-and-forget (ACK, responses to requests we received).
  send(msg) {
    try {
      if (msg.flow && !msg.isRequest) msg.flow.send(msg);
      else this.transport.send(msg);
      return true;
    } catch (err) {
      this.log.warn(`[sip] could not send ${msg.isRequest ? msg.method : msg.status}: ${err.message}`);
      return false;
    }
  }

  respond(req, status, reason, { toTag, headers = {}, body = "", contentType } = {}) {
    const res = createResponse(req, status, reason, { toTag });
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) value.forEach((v) => res.add(name, v));
      else if (value !== undefined) res.set(name, value);
    }
    res.set("user-agent", this.config.userAgent);
    if (body) {
      res.set("content-type", contentType || "application/sdp");
      res.body = body;
    }
    this.send(res);
    return res;
  }

  // ---------- registration ----------

  async register({ expires = this.config.registerExpires } = {}) {
    if (this.registering && expires !== 0) return;
    this.registering = true;
    clearTimeout(this.regTimer);
    if (expires !== 0) this.setRegistration("registering");
    try {
      let res;
      let authHeader = null;
      let requested = expires;
      for (let attempt = 0; attempt < 4; attempt++) {
        const req = this.buildRegister(requested, authHeader);
        res = await this.sendRequest(req);
        if ((res.status === 401 || res.status === 407) && attempt < 3) {
          const challenge = parseChallenge(res.get(res.status === 401 ? "www-authenticate" : "proxy-authenticate"));
          // A second challenge that isn't flagged stale means the
          // credentials themselves were rejected.
          if (authHeader && challenge.stale !== "true") break;
          authHeader = {
            name: res.status === 401 ? "authorization" : "proxy-authorization",
            value: buildDigestAuthorization({
              challenge,
              method: "REGISTER",
              uri: req.uri,
              username: this.config.authUsername,
              password: this.config.password,
            }),
          };
          continue;
        }
        if (res.status === 423 && attempt < 3) {
          requested = Number(res.get("min-expires")) || requested * 2;
          continue;
        }
        break;
      }

      if (expires === 0) {
        this.setRegistration("unregistered");
        return;
      }

      if (res.status >= 200 && res.status < 300) {
        // NAT discovery: if the registrar saw us from a different
        // address than we think we have, register that address instead
        // so inbound calls and media are pointed somewhere reachable.
        const via = parseParams(res.topVia);
        if (!this.config.publicIp && via.received) {
          const learned = { host: via.received, port: Number(via.rport) || this.transport.localPort };
          const current = this.contactHostPort();
          if (learned.host !== current.host || learned.port !== current.port) {
            this.natContact = learned;
            this.log.log(`[sip] behind NAT — public address is ${learned.host}:${learned.port}; re-registering with it`);
            this.registering = false;
            return await this.register();
          }
        }
        const granted = this.grantedExpires(res, requested);
        this.regFailures = 0;
        this.registration.expiresAt = Date.now() + granted * 1000;
        this.setRegistration("registered");
        this.log.log(`[sip] registered as ${this.config.username}@${this.config.domain} (expires in ${granted}s)`);
        // Refresh comfortably before expiry.
        const refreshIn = Math.max(15, Math.min(granted * 0.8, granted - 30));
        this.regTimer = setTimeout(() => this.register(), refreshIn * 1000);
        return;
      }

      const message =
        res.status === 401 || res.status === 403 || res.status === 407
          ? `Registration rejected (${res.status} ${res.reason}) — check SIP_USERNAME / SIP_PASSWORD`
          : `Registration failed (${res.status} ${res.reason})`;
      this.onRegisterFailure(message);
    } catch (err) {
      if (expires !== 0) this.onRegisterFailure(err.message);
    } finally {
      this.registering = false;
    }
  }

  onRegisterFailure(message) {
    this.regFailures++;
    const delay = Math.min(300, 15 * 2 ** Math.min(this.regFailures - 1, 4));
    this.setRegistration("failed", message);
    this.log.warn(`[sip] ${message} — retrying in ${delay}s`);
    this.regTimer = setTimeout(() => {
      // Repeated timeouts usually mean a half-open connection; start fresh.
      if (this.regFailures >= 2 && /timed out/.test(message)) this.transport.reset();
      else this.register();
    }, delay * 1000);
  }

  grantedExpires(res, requested) {
    const ourContact = this.contactUri();
    for (const c of res.getAll("contact")) {
      const { uri, params } = parseNameAddr(c);
      if (params.expires && uri.split(";")[0] === ourContact.split(";")[0]) return Number(params.expires);
    }
    return Number(res.get("expires")) || requested;
  }

  buildRegister(expires, authHeader) {
    const { domain, username } = this.config;
    const aor = `<sip:${username}@${domain}>`;
    const req = this.buildRequest("REGISTER", `sip:${domain}`, {
      callId: this.regCallId,
      from: `${aor};tag=${this.regFromTag}`,
      to: aor,
      cseq: this.regCseq++,
    });
    req.set("contact", `<${this.contactUri()}>`);
    req.set("expires", expires);
    req.set("allow", ALLOW);
    if (authHeader) req.set(authHeader.name, authHeader.value);
    return req;
  }

  // ---------- calls ----------

  // Places an outbound call. Throws right away if the trunk isn't
  // registered or every channel is busy; otherwise returns the Call,
  // whose events report ringing/answered/ended from there on.
  dial(number, { ringTimeoutSeconds, label } = {}) {
    if (!this.isRegistered) {
      throw new Error(
        `The SIP trunk isn't registered${this.registration.error ? ` (${this.registration.error})` : ""} — can't place calls yet.`
      );
    }
    const lease = this.channels.tryAcquire(label || `outbound ${number}`);
    if (!lease) {
      throw new ChannelsBusyError(
        `All ${this.channels.max} SIP channel${this.channels.max === 1 ? " is" : "s are"} in use — hang up the current call first.`
      );
    }
    const call = new Call(this, { direction: "outbound", lease, ringTimeoutSeconds });
    call.dial(number).catch((err) => call.fail(err.message));
    return call;
  }

  async onNewInvite(req) {
    const lease = this.channels.tryAcquire(`inbound ${req.callId}`);
    if (!lease) {
      // No free channel: tell the caller the line's busy.
      this.respond(req, 486, "Busy Here", { toTag: newTag() });
      return;
    }
    const call = new Call(this, { direction: "inbound", lease });
    try {
      const ok = await call.receiveInvite(req);
      if (!ok) return;
    } catch (err) {
      this.log.warn(`[sip] inbound call setup failed: ${err.message}`);
      call.reject(500, "Server Internal Error", "failed");
      return;
    }
    if (this.listenerCount("incoming") === 0) {
      call.reject(480, "Temporarily Unavailable", "no-answer");
      return;
    }
    this.emit("incoming", call);
  }

  // ---------- incoming messages ----------

  onMessage(msg) {
    if (!msg.isRequest) return this.onResponse(msg);
    const callId = msg.callId;
    const call = this.calls.get(callId);
    switch (msg.method) {
      case "INVITE": {
        const toTag = parseNameAddr(msg.get("to")).params.tag;
        if (toTag) {
          if (call) return call.onReinvite(msg);
          return this.respond(msg, 481, "Call/Transaction Does Not Exist");
        }
        if (call) return; // retransmission of an INVITE we're already handling
        return this.onNewInvite(msg);
      }
      case "ACK":
        return call?.onAck(msg);
      case "CANCEL":
        if (call) return call.onCancel(msg);
        return this.respond(msg, 481, "Call/Transaction Does Not Exist");
      case "OPTIONS":
        if (call) return call.onRequest(msg);
        return this.respond(msg, 200, "OK", {
          headers: { allow: ALLOW, accept: "application/sdp", contact: `<${this.contactUri()}>` },
        });
      case "NOTIFY":
        // Out-of-dialog NOTIFYs (e.g. voicemail message-summary) — just acknowledge.
        if (call) return call.onRequest(msg);
        return this.respond(msg, 200, "OK");
      default:
        if (call) return call.onRequest(msg);
        return this.respond(msg, 481, "Call/Transaction Does Not Exist");
    }
  }

  onResponse(res) {
    const { method } = res.cseq;
    const key = `${res.branch}:${method}`;
    const tx = this.transactions.get(key);
    if (!tx) {
      // A retransmitted 200 OK for an INVITE whose transaction already
      // finished: the ACK got lost somewhere, so send it again.
      if (method === "INVITE" && res.status >= 200 && res.status < 300) this.calls.get(res.callId)?.onStray2xx(res);
      return;
    }
    if (res.status < 200) {
      if (tx.method === "INVITE") clearTimeout(tx.timer);
      tx.onProvisional?.(res);
      return;
    }
    clearTimeout(tx.timer);
    this.transactions.delete(key);
    tx.resolve(res);
  }

  status() {
    return {
      registration: this.registration,
      channels: this.channels.snapshot(),
      server: `${this.config.server}:${this.config.port}/${this.config.transport}`,
      callerId: this.config.callerId,
      contact: this.transport.connected ? this.contactUri() : null,
    };
  }
}
