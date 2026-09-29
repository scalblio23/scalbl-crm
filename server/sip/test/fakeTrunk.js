// A tiny stand-in for the VoIPcloud registrar/proxy, for tests: accepts
// SIP over TCP, challenges REGISTER/INVITE with digest auth, and lets
// the test script drive call progress and send its own requests
// (inbound INVITE, BYE, CANCEL) down the registered connection.
import net from "net";
import dgram from "dgram";
import { EventEmitter } from "events";
import { SipStreamParser, createResponse, createRequest, parseNameAddr, newBranch, newTag } from "../message.js";
import { parseChallenge, buildDigestAuthorization } from "../digest.js";
import { parseSdp, buildSdp } from "../sdp.js";

export class FakeTrunk extends EventEmitter {
  constructor({ username, password, realm = "voipcloud", natReceived = null } = {}) {
    super();
    this.username = username;
    this.password = password;
    this.realm = realm;
    this.natReceived = natReceived;
    this.nonce = "n0nce";
    this.flows = [];
    this.registers = [];
    this.received = [];
  }

  listen() {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        const flow = { socket, send: (m) => socket.write(m.toString()) };
        this.flows.push(flow);
        const parser = new SipStreamParser((msg) => {
          msg.flow = flow;
          this.received.push(msg);
          this.onMessage(msg);
        });
        socket.on("data", (c) => parser.push(c));
        socket.on("error", () => {});
      });
      this.server.listen(0, "127.0.0.1", () => resolve(this.server.address().port));
    });
  }

  get flow() {
    return this.flows[this.flows.length - 1];
  }

  close() {
    for (const f of this.flows) f.socket.destroy();
    this.server?.close();
  }

  checkAuth(req, headerName) {
    const header = req.get(headerName);
    if (!header) return false;
    const c = parseChallenge(header);
    const expected = buildDigestAuthorization({
      challenge: { realm: c.realm, nonce: c.nonce, qop: c.qop ? "auth" : undefined, algorithm: c.algorithm },
      method: req.method,
      uri: c.uri,
      username: this.username,
      password: this.password,
      nc: parseInt(c.nc || "1", 16),
      cnonce: c.cnonce,
    });
    return parseChallenge(expected).response === c.response && c.username === this.username;
  }

  reply(req, status, reason, { headers = {}, body, toTag } = {}) {
    const res = createResponse(req, status, reason, { toTag });
    if (status >= 200 && req.method === "REGISTER") {
      const via = req.getAll("via");
      const received = this.natReceived || { host: "127.0.0.1", port: req.flow.socket.remotePort };
      res.remove("via");
      res.add("via", `${via[0].replace(/;rport(?=;|$)/, "")};received=${received.host};rport=${received.port}`);
      via.slice(1).forEach((v) => res.add("via", v));
    }
    for (const [k, v] of Object.entries(headers)) res.set(k, v);
    if (body) {
      res.set("content-type", "application/sdp");
      res.body = body;
    }
    req.flow.send(res);
    return res;
  }

  onMessage(msg) {
    if (!msg.isRequest) return this.emit("response", msg);
    if (msg.method === "REGISTER") {
      if (!this.checkAuth(msg, "authorization")) {
        return this.reply(msg, 401, "Unauthorized", {
          headers: { "www-authenticate": `Digest realm="${this.realm}", nonce="${this.nonce}", qop="auth", algorithm=MD5` },
        });
      }
      this.registers.push(msg);
      const contact = parseNameAddr(msg.get("contact")).uri;
      this.reply(msg, 200, "OK", { headers: { contact: `<${contact}>;expires=${msg.get("expires")}` } });
      return this.emit("registered", msg);
    }
    if (msg.method === "INVITE" && !parseNameAddr(msg.get("to")).params.tag) {
      if (!this.checkAuth(msg, "proxy-authorization")) {
        return this.reply(msg, 407, "Proxy Authentication Required", {
          toTag: newTag(),
          headers: { "proxy-authenticate": `Digest realm="${this.realm}", nonce="${this.nonce}2", qop="auth"` },
        });
      }
    }
    this.emit(msg.method.toLowerCase(), msg);
  }

  // Sends a new request (e.g. an inbound call) down the UA's connection.
  sendRequest(method, uri, { from, to, callId, cseq = 1, headers = {}, body, branch = newBranch() }) {
    const req = createRequest(method, uri);
    req.add("via", `SIP/2.0/TCP 127.0.0.1:${this.server.address().port};branch=${branch}`);
    req.set("max-forwards", 70);
    req.set("from", from);
    req.set("to", to);
    req.set("call-id", callId);
    req.set("cseq", `${cseq} ${method}`);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    if (body) {
      req.set("content-type", "application/sdp");
      req.body = body;
    }
    this.flow.send(req);
    return req;
  }

  next(event, predicate = () => true, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`timed out waiting for ${event}`));
      }, timeoutMs);
      const handler = (m) => {
        if (!predicate(m)) return;
        clearTimeout(t);
        this.off(event, handler);
        resolve(m);
      };
      this.on(event, handler);
    });
  }
}

// A far-end RTP endpoint (the provider's media server / the callee).
export class FakeMedia extends EventEmitter {
  async open() {
    this.socket = dgram.createSocket("udp4");
    this.packets = [];
    this.socket.on("message", (buf, rinfo) => {
      this.from = rinfo;
      const pt = buf[1] & 0x7f;
      const pkt = { pt, marker: !!(buf[1] & 0x80), ts: buf.readUInt32BE(4), payload: buf.subarray(12) };
      this.packets.push(pkt);
      this.emit("packet", pkt);
    });
    await new Promise((r) => this.socket.bind(0, "127.0.0.1", r));
    this.port = this.socket.address().port;
    return this;
  }

  sdp(codecs = ["PCMA", "PCMU"]) {
    return buildSdp({ ip: "127.0.0.1", port: this.port, sessionId: 42, codecs, dtmfPt: 101 });
  }

  sendTo(sdpText, pt, payload, { marker = false, ts = 1000, seq = 1 } = {}) {
    const { port } = parseSdp(sdpText);
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = (marker ? 0x80 : 0) | pt;
    header.writeUInt16BE(seq, 2);
    header.writeUInt32BE(ts, 4);
    header.writeUInt32BE(1234, 8);
    this.socket.send(Buffer.concat([header, payload]), port, "127.0.0.1");
  }

  close() {
    this.socket?.close();
  }
}

export { newTag };
