// Minimal RFC 3261 message model: parse from a TCP byte stream,
// serialize back out, and the header/URI helpers the UA needs. Just
// enough SIP for a registering trunk client — not a general-purpose
// stack.
import crypto from "crypto";

const COMPACT = {
  v: "via",
  f: "from",
  t: "to",
  i: "call-id",
  m: "contact",
  l: "content-length",
  c: "content-type",
  k: "supported",
  s: "subject",
  e: "content-encoding",
  o: "event",
  r: "refer-to",
  u: "allow-events",
};

// Headers whose comma-joined values are separate entries.
const MULTI = new Set(["via", "route", "record-route", "contact"]);

const CANONICAL = {
  "call-id": "Call-ID",
  cseq: "CSeq",
  "www-authenticate": "WWW-Authenticate",
  "p-asserted-identity": "P-Asserted-Identity",
  "remote-party-id": "Remote-Party-ID",
  "max-forwards": "Max-Forwards",
  "record-route": "Record-Route",
};

function canonicalName(name) {
  return CANONICAL[name] || name.replace(/(^|-)([a-z])/g, (_, dash, ch) => dash + ch.toUpperCase());
}

// Splits "a, b" on commas that aren't inside quotes or <>.
export function splitHeaderList(value) {
  const out = [];
  let depthAngle = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' && value[i - 1] !== "\\") inQuote = !inQuote;
    else if (!inQuote && ch === "<") depthAngle++;
    else if (!inQuote && ch === ">") depthAngle--;
    else if (!inQuote && depthAngle === 0 && ch === ",") {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

export class SipMessage {
  constructor() {
    this.isRequest = false;
    this.method = "";
    this.uri = "";
    this.status = 0;
    this.reason = "";
    this.headers = []; // [[lowercaseName, value], ...] in order
    this.body = "";
    this.flow = null; // set by the transport: where to send replies
  }

  get(name) {
    const key = name.toLowerCase();
    const found = this.headers.find(([n]) => n === key);
    return found ? found[1] : undefined;
  }

  getAll(name) {
    const key = name.toLowerCase();
    return this.headers.filter(([n]) => n === key).map(([, v]) => v);
  }

  set(name, value) {
    const key = name.toLowerCase();
    this.headers = this.headers.filter(([n]) => n !== key);
    if (value !== undefined && value !== null) this.headers.push([key, String(value)]);
    return this;
  }

  add(name, value) {
    this.headers.push([name.toLowerCase(), String(value)]);
    return this;
  }

  remove(name) {
    const key = name.toLowerCase();
    this.headers = this.headers.filter(([n]) => n !== key);
    return this;
  }

  get callId() {
    return this.get("call-id");
  }

  get cseq() {
    const [seq, method] = String(this.get("cseq") || "").trim().split(/\s+/);
    return { seq: Number(seq), method: (method || "").toUpperCase() };
  }

  get topVia() {
    return this.getAll("via")[0] || "";
  }

  get branch() {
    return parseParams(this.topVia).branch || "";
  }

  toString() {
    const startLine = this.isRequest
      ? `${this.method} ${this.uri} SIP/2.0`
      : `SIP/2.0 ${this.status} ${this.reason}`;
    const body = this.body || "";
    const lines = [startLine];
    for (const [name, value] of this.headers) {
      if (name === "content-length") continue;
      lines.push(`${canonicalName(name)}: ${value}`);
    }
    lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    return `${lines.join("\r\n")}\r\n\r\n${body}`;
  }
}

function parseHead(head) {
  const lines = head.split(/\r?\n/);
  // Unfold continuation lines (leading whitespace).
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else unfolded.push(line);
  }
  const msg = new SipMessage();
  const first = unfolded.shift() || "";
  if (first.startsWith("SIP/2.0")) {
    const m = first.match(/^SIP\/2\.0\s+(\d{3})\s*(.*)$/);
    if (!m) throw new Error(`Bad status line: ${first}`);
    msg.status = Number(m[1]);
    msg.reason = m[2];
  } else {
    const m = first.match(/^([A-Z]+)\s+(\S+)\s+SIP\/2\.0$/i);
    if (!m) throw new Error(`Bad request line: ${first}`);
    msg.isRequest = true;
    msg.method = m[1].toUpperCase();
    msg.uri = m[2];
  }
  for (const line of unfolded) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    let name = line.slice(0, idx).trim().toLowerCase();
    name = COMPACT[name] || name;
    const value = line.slice(idx + 1).trim();
    if (MULTI.has(name)) {
      for (const part of splitHeaderList(value)) msg.headers.push([name, part]);
    } else {
      msg.headers.push([name, value]);
    }
  }
  return msg;
}

// Incremental parser for a stream transport — feed it chunks, it calls
// onMessage for every complete message. Stray CRLFs (RFC 5626
// keepalive pings/pongs) between messages are skipped.
export class SipStreamParser {
  constructor(onMessage, onError = () => {}) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
    this.onError = onError;
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      // Skip keepalive CRLFs.
      let skip = 0;
      while (skip < this.buffer.length && (this.buffer[skip] === 0x0d || this.buffer[skip] === 0x0a)) skip++;
      if (skip) this.buffer = this.buffer.subarray(skip);
      if (!this.buffer.length) return;

      const headEnd = this.buffer.indexOf("\r\n\r\n");
      if (headEnd === -1) {
        if (this.buffer.length > 64 * 1024) {
          this.onError(new Error("SIP header section too large"));
          this.buffer = Buffer.alloc(0);
        }
        return;
      }
      const head = this.buffer.subarray(0, headEnd).toString("utf8");
      let msg;
      try {
        msg = parseHead(head);
      } catch (err) {
        this.onError(err);
        this.buffer = this.buffer.subarray(headEnd + 4);
        continue;
      }
      const length = Number(msg.get("content-length") || 0);
      const total = headEnd + 4 + length;
      if (this.buffer.length < total) return; // wait for the rest of the body
      msg.body = this.buffer.subarray(headEnd + 4, total).toString("utf8");
      this.buffer = this.buffer.subarray(total);
      this.onMessage(msg);
    }
  }
}

export function parseMessage(text) {
  let result = null;
  new SipStreamParser((m) => {
    result = result || m;
  }).push(Buffer.from(text));
  return result;
}

// ";a=1;b;c=x" (anything after the first ';') → { a: "1", b: "", c: "x" }
export function parseParams(value) {
  const params = {};
  const str = String(value || "");
  // Only look at params outside <...> for name-addr forms.
  const close = str.lastIndexOf(">");
  const tail = close >= 0 ? str.slice(close + 1) : str.slice(str.indexOf(";") >= 0 ? str.indexOf(";") : str.length);
  for (const part of tail.split(";").slice(1)) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq === -1) params[p.toLowerCase()] = "";
    else params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return params;
}

// '"Name" <sip:u@h;transport=tcp>;tag=x' → { display, uri, params }
export function parseNameAddr(value) {
  const str = String(value || "").trim();
  const lt = str.indexOf("<");
  if (lt >= 0) {
    const gt = str.indexOf(">", lt);
    const display = str.slice(0, lt).trim().replace(/^"|"$/g, "");
    return { display, uri: str.slice(lt + 1, gt), params: parseParams(str.slice(gt)) };
  }
  // addr-spec form: params after the URI belong to the header.
  const semi = str.indexOf(";");
  return {
    display: "",
    uri: semi >= 0 ? str.slice(0, semi) : str,
    params: semi >= 0 ? parseParams(str.slice(semi)) : {},
  };
}

// "sip:user@host:port;transport=tcp" → { scheme, user, host, port, params }
export function parseUri(uri) {
  const m = String(uri || "").match(/^(sips?):(?:([^@;]*)@)?([^;:?]+|\[[^\]]+\])(?::(\d+))?([^?]*)/i);
  if (!m) return null;
  const params = {};
  for (const part of (m[5] || "").split(";")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=");
    params[k.toLowerCase()] = v;
  }
  return { scheme: m[1].toLowerCase(), user: decodeURIComponent(m[2] || ""), host: m[3], port: m[4] ? Number(m[4]) : 0, params };
}

export function randomToken(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function newBranch() {
  return `z9hG4bK${randomToken(10)}`;
}

export function newTag() {
  return randomToken(6);
}

export function newCallId(host) {
  return `${randomToken(12)}@${host || "scalbl"}`;
}

export function createRequest(method, uri) {
  const msg = new SipMessage();
  msg.isRequest = true;
  msg.method = method;
  msg.uri = uri;
  return msg;
}

// Builds a response to `req`, copying the headers RFC 3261 §8.2.6
// requires. `toTag` is added to To if it doesn't already carry one.
export function createResponse(req, status, reason, { toTag } = {}) {
  const res = new SipMessage();
  res.status = status;
  res.reason = reason;
  for (const via of req.getAll("via")) res.add("via", via);
  res.set("from", req.get("from"));
  let to = req.get("to") || "";
  if (toTag && !parseNameAddr(to).params.tag && status !== 100) to = `${to};tag=${toTag}`;
  res.set("to", to);
  res.set("call-id", req.get("call-id"));
  res.set("cseq", req.get("cseq"));
  res.flow = req.flow;
  return res;
}
