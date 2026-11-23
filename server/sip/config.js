// SIP trunk configuration for the voice gateway (server/voiceGateway.js).
// Everything is env-driven, so the same code runs against Crazytel (the
// defaults) or any other SIP-registration trunk.
import fs from "fs";
import { normalizeCallerId } from "./phone.js";

const DEFAULT_SERVER = "sip.crazytel.net.au";

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadSipConfig(env = process.env) {
  const server = env.SIP_SERVER || DEFAULT_SERVER;
  const username = env.SIP_USERNAME || "";
  // SIP_CALLER_IDS rotates outbound calls across several numbers on the
  // trunk (needs the trunk's Caller ID set to "Keep originator's caller
  // ID"); otherwise every call presents SIP_CALLER_ID.
  const callerIds = parseCallerIds(env.SIP_CALLER_IDS);
  const callerId = callerIds[0] || normalizeCallerId(env.SIP_CALLER_ID || "");
  const [rtpPortMin, rtpPortMax] = String(env.SIP_RTP_PORTS || "10000-10999")
    .split("-")
    .map((p) => Number(p));

  return {
    server,
    port: num(env.SIP_PORT, 5060),
    // "tcp" or "tls".
    transport: (env.SIP_TRANSPORT || "tcp").toLowerCase(),
    // The SIP domain/realm used in From/To/Request-URIs — usually the
    // same host as the registrar.
    domain: env.SIP_DOMAIN || server,
    username,
    authUsername: env.SIP_AUTH_USERNAME || username,
    password: env.SIP_PASSWORD || "",
    callerId,
    callerIds: callerIds.length ? callerIds : callerId ? [callerId] : [],
    // How caller IDs are written in From / P-Asserted-Identity — same
    // choices as SIP_DIAL_FORMAT. Only matters with SIP_CALLER_IDS.
    callerIdFormat: env.SIP_CALLER_ID_FORMAT || "e164",
    // With SIP_CALLER_IDS, the provider reads the presented number from
    // the From header, so each call's caller ID goes there.
    callerIdInFrom: callerIds.length > 0,
    // The user part of the From header. The provider identifies the
    // account by its SIP username and presents its configured Caller ID,
    // so the default is the username; the caller ID is still asserted
    // via the display name, P-Asserted-Identity and Remote-Party-ID.
    // Set SIP_FROM_USER=+61400000000 if your provider wants it in From.
    fromUser: env.SIP_FROM_USER || (callerIds.length ? "" : username),
    // How the destination is written into the INVITE's Request-URI:
    //   e164          +61412345678 (default)
    //   e164-no-plus  61412345678
    //   national      0412345678
    dialFormat: env.SIP_DIAL_FORMAT || "e164",
    // Simultaneous calls the account allows (1 per Crazytel SIP account;
    // more lines = more accounts, see SIP_TRUNKS_FILE / trunkPool.js).
    maxChannels: Math.floor(num(env.SIP_MAX_CHANNELS, 1)),
    ringTimeoutSeconds: num(env.SIP_RING_TIMEOUT, 60),
    registerExpires: num(env.SIP_REGISTER_EXPIRES, 300),
    // G.711 only: A-law first (the Australian network default), u-law as
    // a fallback. The trunk also supports Opus/G.722, but G.711 needs no
    // transcoding library and is universally accepted.
    codecs: String(env.SIP_CODECS || "PCMA,PCMU")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c === "PCMA" || c === "PCMU"),
    // Public IP to advertise in SDP/Contact. Leave unset to use what the
    // registrar reports back (Via received=) — works behind most NATs.
    publicIp: env.SIP_PUBLIC_IP || "",
    rtpPortMin: rtpPortMin || 10000,
    rtpPortMax: rtpPortMax || rtpPortMin + 999 || 10999,
    // Optional: also accept SIP over TCP on this local port, for
    // providers that open a fresh connection for inbound calls instead
    // of reusing the registration's connection.
    listenPort: Number(env.SIP_LISTEN_PORT) || 0,
    keepaliveSeconds: num(env.SIP_KEEPALIVE_SECONDS, 25),
    // A connected call whose far end has sent no audio for this long is
    // treated as dead (its hang-up never reached us) and ended, so it
    // can't hold a channel forever — see Call.startMediaWatchdog. A call
    // on hold is exempt. 0 turns it off.
    mediaTimeoutSeconds: num(env.SIP_MEDIA_TIMEOUT_SECONDS, 120),
    // Hard cap on any one connected call, as a backstop. 0 = no cap.
    maxCallSeconds: num(env.SIP_MAX_CALL_SECONDS, 4 * 60 * 60),
    userAgent: env.SIP_USER_AGENT || "ScalblCRM-VoiceGateway/1.0",
  };
}

// Most SIP accounts that SIP_TRUNKS_FILE may list. Each account carries
// one call at a time, so this is also the gateway's line count.
export const MAX_TRUNKS = 10;

// Several SIP accounts on the same provider, pooled into more lines
// (see server/sip/trunkPool.js). SIP_TRUNKS_FILE is an absolute path to a
// JSON array, in outbound selection order:
//   [{"username":"ct393909","authUsername":"ct393909",
//     "passwordFile":"/opt/scalbl-voice-secrets/ct393909.password",
//     "callerId":"+61485998180"}, ...]
// Each password file holds the raw password (no trailing newline). Every
// other setting (server, port, transport, codecs, public IP, …) comes
// from the usual SIP_* env vars and is shared by all accounts. Without
// SIP_TRUNKS_FILE this returns the single SIP_USERNAME/SIP_PASSWORD
// trunk, exactly as before.
export function loadSipConfigs(env = process.env) {
  if (!env.SIP_TRUNKS_FILE) return [loadSipConfig(env)];
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(env.SIP_TRUNKS_FILE, "utf8"));
  } catch (err) {
    throw new Error(`Can't read SIP_TRUNKS_FILE (${err.code || "invalid JSON"})`);
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_TRUNKS) {
    throw new Error(`SIP_TRUNKS_FILE must list 1 to ${MAX_TRUNKS} accounts`);
  }
  const base = loadSipConfig(env);
  // Each account gets its own even-aligned slice of the RTP port range.
  const width = Math.floor((base.rtpPortMax - base.rtpPortMin + 1) / rows.length / 2) * 2;
  if (width < 2) throw new Error("SIP_RTP_PORTS is too small to share between the SIP_TRUNKS_FILE accounts");
  const seen = new Set();
  return rows.map((row, i) => {
    const username = String(row?.username || "").trim();
    const callerId = normalizeCallerId(String(row?.callerId || ""));
    if (!username || !callerId || !row.passwordFile) {
      throw new Error(`SIP_TRUNKS_FILE entry ${i + 1} needs username, passwordFile and callerId`);
    }
    if (seen.has(username)) throw new Error(`SIP_TRUNKS_FILE lists ${username} twice`);
    seen.add(username);
    let password;
    try {
      password = fs.readFileSync(String(row.passwordFile), "utf8");
    } catch (err) {
      throw new Error(`Can't read the password file for ${username} (${err.code || "error"})`);
    }
    if (!password.length) throw new Error(`The password file for ${username} is empty`);
    const config = {
      ...base,
      id: username,
      username,
      authUsername: String(row.authUsername || username).trim(),
      callerId,
      callerIds: [callerId],
      // The provider identifies the account by the From user; the
      // account's own number goes in the display name,
      // P-Asserted-Identity and Remote-Party-ID.
      callerIdInFrom: true,
      fromUser: username,
      maxChannels: 1,
      rtpPortMin: base.rtpPortMin + i * width,
      rtpPortMax: i === rows.length - 1 ? base.rtpPortMax : base.rtpPortMin + (i + 1) * width - 1,
      // Only the first account owns the optional extra SIP listener.
      listenPort: i === 0 ? base.listenPort : 0,
    };
    delete config.password;
    // Not enumerable, so it never ends up in JSON or a logged object.
    Object.defineProperty(config, "password", { value: password, enumerable: false });
    return config;
  });
}

export function missingSipEnv(env = process.env) {
  if (env.SIP_TRUNKS_FILE) return [];
  const missing = [];
  if (!env.SIP_USERNAME) missing.push("SIP_USERNAME");
  if (!env.SIP_PASSWORD) missing.push("SIP_PASSWORD");
  if (!env.SIP_CALLER_ID && !parseCallerIds(env.SIP_CALLER_IDS).length) missing.push("SIP_CALLER_ID");
  return missing;
}

// "+61400000000, 0485 998 251" → ["+61400000000", "+61485998251"]
export function parseCallerIds(raw) {
  return String(raw || "")
    .split(",")
    .map((n) => normalizeCallerId(n))
    .filter(Boolean);
}
