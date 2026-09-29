// SIP digest authentication (RFC 2617 / RFC 8760) — answers a 401
// WWW-Authenticate or 407 Proxy-Authenticate challenge.
import crypto from "crypto";

export function parseChallenge(headerValue) {
  const str = String(headerValue || "").replace(/^\s*Digest\s+/i, "");
  const out = {};
  const re = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/gi;
  let m;
  while ((m = re.exec(str))) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

function hashFn(algorithm) {
  const algo = String(algorithm || "MD5").toUpperCase().replace(/-SESS$/, "");
  const name = algo === "SHA-256" ? "sha256" : algo === "SHA-512-256" ? "sha512-256" : "md5";
  return (s) => crypto.createHash(name).update(s).digest("hex");
}

// Returns the full header value for Authorization / Proxy-Authorization.
export function buildDigestAuthorization({ challenge, method, uri, username, password, nc = 1, cnonce, body = "" }) {
  const { realm = "", nonce = "", opaque, algorithm } = challenge;
  const H = hashFn(algorithm);
  const qops = String(challenge.qop || "")
    .split(",")
    .map((q) => q.trim().toLowerCase())
    .filter(Boolean);
  const qop = qops.includes("auth") ? "auth" : qops.includes("auth-int") ? "auth-int" : "";
  const ncHex = nc.toString(16).padStart(8, "0");
  const cn = cnonce || crypto.randomBytes(8).toString("hex");

  let ha1 = H(`${username}:${realm}:${password}`);
  if (/-sess$/i.test(algorithm || "")) ha1 = H(`${ha1}:${nonce}:${cn}`);
  const ha2 = qop === "auth-int" ? H(`${method}:${uri}:${H(body)}`) : H(`${method}:${uri}`);
  const response = qop ? H(`${ha1}:${nonce}:${ncHex}:${cn}:${qop}:${ha2}`) : H(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (algorithm) parts.push(`algorithm=${algorithm}`);
  if (opaque !== undefined) parts.push(`opaque="${opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${ncHex}`, `cnonce="${cn}"`);
  return `Digest ${parts.join(", ")}`;
}
