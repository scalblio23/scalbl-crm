// Persistent SIP-over-TCP (or TLS) connection to the trunk's
// registrar/proxy. Reconnects with backoff when it drops and sends
// RFC 5626 CRLF keepalives so NAT/firewall state for the connection
// doesn't expire between calls — the provider delivers inbound calls
// down this same connection, so it has to stay up.
//
// Optionally also listens for inbound SIP-over-TCP connections (for
// providers that open a fresh connection to the registered Contact
// instead of reusing the registration's).
import net from "net";
import tls from "tls";
import { EventEmitter } from "events";
import { SipStreamParser } from "./message.js";

const MAX_BACKOFF_MS = 30000;

function makeFlow(socket, label) {
  return {
    label,
    socket,
    send(data) {
      if (socket.destroyed || !socket.writable) throw new Error("SIP connection is not open");
      socket.write(typeof data === "string" ? data : data.toString());
    },
  };
}

export class SipTransport extends EventEmitter {
  constructor(config, { log = console } = {}) {
    super();
    this.config = config;
    this.log = log;
    this.socket = null;
    this.flow = null;
    this.connected = false;
    this.stopped = false;
    this.backoffMs = 1000;
    this.reconnectTimer = null;
    this.keepaliveTimer = null;
    this.server = null;
  }

  get localAddress() {
    return this.socket?.localAddress?.replace(/^::ffff:/, "") || "";
  }

  get localPort() {
    return this.socket?.localPort || 0;
  }

  get protocol() {
    return this.config.transport === "tls" ? "TLS" : "TCP";
  }

  start() {
    this.stopped = false;
    this.connect();
    if (this.config.listenPort) this.listen(this.config.listenPort);
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    const { server, port, transport } = this.config;
    const opts = { host: server, port };
    const socket = transport === "tls" ? tls.connect({ ...opts, servername: server }) : net.connect(opts);
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);
    const flow = makeFlow(socket, `${server}:${port}`);
    const parser = new SipStreamParser(
      (msg) => {
        msg.flow = flow;
        this.emit("message", msg);
      },
      (err) => this.log.warn("[sip] parse error:", err.message)
    );

    socket.once(transport === "tls" ? "secureConnect" : "connect", () => {
      this.connected = true;
      this.flow = flow;
      this.backoffMs = 1000;
      this.log.log(`[sip] ${this.protocol} connected to ${server}:${port} from ${this.localAddress}:${this.localPort}`);
      this.startKeepalive();
      this.emit("connected");
    });
    socket.on("data", (chunk) => parser.push(chunk));
    let lastError = null;
    socket.on("error", (err) => {
      lastError = err;
      this.log.warn(`[sip] connection error: ${err.message}`);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.flow = null;
      clearInterval(this.keepaliveTimer);
      if (wasConnected) this.emit("disconnected");
      else this.emit("connect-failed", lastError || new Error("connection closed"));
      if (this.stopped) return;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.log.warn(`[sip] connection closed — reconnecting in ${Math.round(delay / 1000)}s`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  startKeepalive() {
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => {
      if (this.connected) this.socket.write("\r\n\r\n");
    }, this.config.keepaliveSeconds * 1000);
  }

  listen(port) {
    this.server = net.createServer((socket) => {
      const flow = makeFlow(socket, `${socket.remoteAddress}:${socket.remotePort}`);
      const parser = new SipStreamParser(
        (msg) => {
          msg.flow = flow;
          this.emit("message", msg);
        },
        (err) => this.log.warn("[sip] parse error (inbound connection):", err.message)
      );
      socket.on("data", (chunk) => parser.push(chunk));
      socket.on("error", () => {});
    });
    this.server.on("error", (err) => this.log.warn(`[sip] listener error: ${err.message}`));
    this.server.listen(port, () => this.log.log(`[sip] also accepting SIP/TCP on :${port}`));
  }

  // Sends over the trunk connection. Throws if it's currently down —
  // callers turn that into a clean "not connected" failure.
  send(msg) {
    if (!this.connected || !this.flow) throw new Error("Not connected to the SIP server");
    this.flow.send(msg);
  }

  // Forces a reconnect (used when registration keeps failing in a way
  // that suggests a half-dead connection).
  reset() {
    this.socket?.destroy();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepaliveTimer);
    this.socket?.destroy();
    this.server?.close();
  }
}
