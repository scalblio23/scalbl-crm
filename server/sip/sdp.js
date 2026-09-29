// SDP offer/answer for a single G.711 audio stream plus RFC 4733
// telephone-event (DTMF).

export const STATIC_PAYLOADS = { 0: "PCMU", 8: "PCMA" };
const PT_FOR = { PCMU: 0, PCMA: 8 };
export const DEFAULT_DTMF_PT = 101;

export function buildSdp({ ip, port, sessionId, version = 1, codecs, dtmfPt = DEFAULT_DTMF_PT, direction = "sendrecv" }) {
  const pts = codecs.map((c) => PT_FOR[c]).filter((pt) => pt !== undefined);
  const lines = [
    "v=0",
    `o=- ${sessionId} ${version} IN IP4 ${ip}`,
    "s=ScalblCRM",
    `c=IN IP4 ${ip}`,
    "t=0 0",
    `m=audio ${port} RTP/AVP ${[...pts, ...(dtmfPt ? [dtmfPt] : [])].join(" ")}`,
    ...pts.map((pt) => `a=rtpmap:${pt} ${STATIC_PAYLOADS[pt]}/8000`),
    ...(dtmfPt ? [`a=rtpmap:${dtmfPt} telephone-event/8000`, `a=fmtp:${dtmfPt} 0-16`] : []),
    "a=ptime:20",
    `a=${direction}`,
  ];
  return `${lines.join("\r\n")}\r\n`;
}

// Pulls out what we need from the first audio m-line: where to send
// RTP, which payload types are on offer (in preference order), and the
// telephone-event payload type if any.
export function parseSdp(text) {
  const lines = String(text || "").split(/\r?\n/);
  let sessionIp = "";
  let media = null;
  let sessionDirection = "sendrecv";
  for (const line of lines) {
    const [type, value = ""] = [line.slice(0, 1), line.slice(2)];
    if (type === "m") {
      if (media) break; // only the first media section matters
      const [kind, port, , ...fmts] = value.trim().split(/\s+/);
      if (kind !== "audio") continue;
      media = { port: Number(port), payloads: fmts.map(Number), ip: "", rtpmap: {}, dtmfPt: null, direction: null };
    } else if (type === "c") {
      const ip = value.trim().split(/\s+/)[2] || "";
      if (media) media.ip = ip;
      else sessionIp = ip;
    } else if (type === "a") {
      const dir = value.trim();
      if (["sendrecv", "sendonly", "recvonly", "inactive"].includes(dir)) {
        if (media) media.direction = dir;
        else sessionDirection = dir;
      }
      const m = value.match(/^rtpmap:(\d+)\s+([^/\s]+)\/(\d+)/i);
      if (m && media) {
        const pt = Number(m[1]);
        media.rtpmap[pt] = { name: m[2].toUpperCase(), rate: Number(m[3]) };
        if (m[2].toLowerCase() === "telephone-event" && Number(m[3]) === 8000) media.dtmfPt = pt;
      }
    }
  }
  if (!media) return null;
  return {
    ip: media.ip || sessionIp,
    port: media.port,
    payloads: media.payloads,
    rtpmap: media.rtpmap,
    dtmfPt: media.dtmfPt,
    direction: media.direction || sessionDirection,
  };
}

function nameFor(remote, pt) {
  return remote.rtpmap[pt]?.name || STATIC_PAYLOADS[pt];
}

// Picks the codec to use: the first of the remote side's payloads (in
// their order — they're the answerer/offerer whose preference RFC 3264
// says to honour) that we also support. Returns { pt, name } or null.
export function negotiateCodec(remote, ourCodecs) {
  if (!remote) return null;
  for (const pt of remote.payloads) {
    const name = nameFor(remote, pt);
    if (ourCodecs.includes(name) && (remote.rtpmap[pt]?.rate ?? 8000) === 8000) return { pt, name };
  }
  return null;
}

// Whether the remote side has put us on hold (no media to send).
export function isHold(remote) {
  return !remote || remote.ip === "0.0.0.0" || remote.direction === "sendonly" || remote.direction === "inactive";
}
