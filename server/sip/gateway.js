// Bridges browsers (reps) to the SIP trunk. Each logged-in browser tab
// holds one WebSocket to the gateway:
//
//   browser mic ──PCM16/8kHz──▶ WebSocket ──▶ G.711 RTP ──▶ VoIPcloud
//   browser spk ◀──PCM16/8kHz── WebSocket ◀── G.711 RTP ◀── VoIPcloud
//
// Control messages are JSON text frames; audio is binary frames of
// little-endian 16-bit mono samples at 8 kHz (the browser does the
// resampling, the gateway does the G.711 companding).
//
// Browser → gateway:
//   { type: "dial", ref, to, ringSeconds? }
//   { type: "dial-multi", ref, legs: [{ ref, to }], ringSeconds? }
//   { type: "hangup" }
//   { type: "answer", callId }   { type: "reject", callId }
//   { type: "dtmf", digits }
// Gateway → browser:
//   { type: "hello", registration, channels, callerId }
//   { type: "registration", ... }
//   { type: "call-started", ref, callId, direction, to/from, callerId }
//   { type: "call-state", callId, state }      ringing | answered
//   { type: "call-ended", callId, reason, status, sipReason, message, durationMs }
//   { type: "dial-error", ref, message }
//   { type: "incoming", callId, from, name }   { type: "incoming-gone", callId, reason }
//   { type: "multi-legs", ref, legs: [{ ref, status, error }] }
//   { type: "multi-answered", ref, legRef, callId }
//   { type: "multi-ended", ref }
//   { type: "dtmf", callId, digit }
import { WebSocketServer } from "ws";
import { ChannelsBusyError } from "./ua.js";

const MAX_WS_BUFFER = 64 * 1024; // drop outbound audio rather than build latency

const END_MESSAGES = {
  busy: "Line busy.",
  declined: "The call was declined.",
  "no-answer": "No answer.",
  cancelled: "",
  "hangup-local": "",
  "hangup-remote": "",
};

export function endedMessage({ reason, status, sipReason }) {
  if (reason in END_MESSAGES) return END_MESSAGES[reason];
  if (status === 404 || status === 484 || status === 604) return `That number couldn't be reached (${status} ${sipReason}).`;
  if (status === 403) return `The SIP trunk refused the call (403 ${sipReason}) — check the trunk's caller ID and outbound permissions.`;
  if (status === 503) return `The SIP trunk is unavailable or out of channels (503 ${sipReason}).`;
  if (status) return `The call failed (${status} ${sipReason}).`;
  return sipReason ? `The call failed: ${sipReason}` : "The call failed.";
}

// Twilio-style leg statuses, so the Multi Line tab's existing status
// labels work unchanged.
function legStatusForEnd(reason) {
  if (reason === "busy" || reason === "declined") return "busy";
  if (reason === "no-answer") return "no-answer";
  if (reason === "cancelled") return "canceled";
  if (reason === "failed") return "failed";
  return "completed";
}

// `record`: optional (call) => CallRecorder — when given, every call a
// rep is on is recorded from the moment it's answered, and
// onRecording({ id, file, seconds, call, rep }) runs once it's saved.
export function createVoiceGateway({
  ua,
  server,
  path = "/voice",
  verifyToken,
  onMissedCall = () => {},
  record = null,
  onRecording = () => {},
  log = console,
}) {
  const wss = new WebSocketServer({ server, path });
  const reps = new Set();
  const pendingIncoming = new Map(); // call.id → { call, offeredTo: Set<rep>, taken: rep|null }

  function send(rep, obj) {
    if (rep.ws.readyState === rep.ws.OPEN) rep.ws.send(JSON.stringify(obj));
  }

  function broadcast(obj) {
    for (const rep of reps) send(rep, obj);
  }

  ua.on("registration", (registration) => broadcast({ type: "registration", ...registration }));

  function startRecording(rep, call) {
    if (!record || call.recorder) return;
    try {
      call.recorder = record(call);
    } catch (err) {
      log.warn(`[recording] couldn't start for ${call.remoteNumber}: ${err.message}`);
      return;
    }
    call.once("ended", () => {
      call.recorder
        .finish()
        .then((saved) => saved && onRecording({ ...saved, call, rep }))
        .catch((err) => log.warn(`[recording] couldn't save ${call.recorder.id}: ${err.message}`));
    });
  }

  // Wires a live call's audio/DTMF/state to one rep's socket.
  function attachCall(rep, call) {
    rep.call = call;
    if (call.state === "answered") startRecording(rep, call);
    call.on("state", (state) => {
      if (state === "answered") startRecording(rep, call);
      send(rep, { type: "call-state", callId: call.id, state });
    });
    call.on("audio", (pcm) => {
      const { ws } = rep;
      if (rep.call !== call || ws.readyState !== ws.OPEN || ws.bufferedAmount > MAX_WS_BUFFER) return;
      ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), { binary: true });
    });
    call.on("dtmf", (digit) => send(rep, { type: "dtmf", callId: call.id, digit }));
    call.once("ended", (info) => {
      if (rep.call === call) rep.call = null;
      send(rep, { type: "call-ended", callId: call.id, ...info, message: endedMessage(info) });
    });
  }

  function handleDial(rep, msg) {
    if (rep.call || rep.multi) return send(rep, { type: "dial-error", ref: msg.ref, message: "You're already on a call." });
    let call;
    try {
      call = ua.dial(msg.to, { ringTimeoutSeconds: Number(msg.ringSeconds) || undefined, label: `${rep.name} → ${msg.to}` });
      // The CRM lead this call is for — labels its recording.
      call.leadId = Number(msg.leadId) || null;
    } catch (err) {
      return send(rep, { type: "dial-error", ref: msg.ref, message: err.message, busy: err instanceof ChannelsBusyError });
    }
    attachCall(rep, call);
    send(rep, {
      type: "call-started",
      ref: msg.ref,
      callId: call.id,
      direction: "outbound",
      to: call.remoteNumber,
      callerId: call.callerId,
    });
  }

  // Multi-line: ring several leads at once on separate channels; the
  // first to answer is bridged to the rep, the rest are cancelled.
  function handleDialMulti(rep, msg) {
    if (rep.call || rep.multi) return send(rep, { type: "dial-error", ref: msg.ref, message: "You're already on a call." });
    const legsIn = Array.isArray(msg.legs) ? msg.legs : [];
    const free = ua.channels.available;
    if (free < 2) {
      return send(rep, {
        type: "dial-error",
        ref: msg.ref,
        message: `Multi-line dialling needs at least 2 free SIP channels — this trunk has ${ua.channels.max} (${free} free). Add channels with your provider and raise SIP_MAX_CHANNELS, or use the Powerdialler tab.`,
      });
    }
    const multi = { ref: msg.ref, legs: [], winner: null };
    rep.multi = multi;
    const report = () =>
      send(rep, {
        type: "multi-legs",
        ref: multi.ref,
        legs: multi.legs.map((l) => ({ ref: l.ref, status: l.status, error: l.error || "" })),
      });
    const finishIfDone = () => {
      if (multi.winner || rep.multi !== multi) return;
      if (multi.legs.every((l) => !l.call || l.call.isEnded)) {
        rep.multi = null;
        send(rep, { type: "multi-ended", ref: multi.ref });
      }
    };

    legsIn.forEach((legIn, i) => {
      const leg = { ref: legIn.ref, status: "placed", call: null, error: "" };
      multi.legs.push(leg);
      if (i >= free) {
        leg.status = "failed";
        leg.error = "No free SIP channel";
        return;
      }
      try {
        leg.call = ua.dial(legIn.to, {
          ringTimeoutSeconds: Number(msg.ringSeconds) || undefined,
          label: `${rep.name} → ${legIn.to} (multi)`,
        });
      } catch (err) {
        leg.status = "failed";
        leg.error = err.message;
        return;
      }
      const call = leg.call;
      call.leadId = Number(legIn.ref) || null; // Multi Line legs are keyed by lead id
      call.on("state", (state) => {
        if (state === "calling") leg.status = "initiated";
        else if (state === "ringing") leg.status = "ringing";
        else if (state === "answered") {
          leg.status = "in-progress";
          if (!multi.winner && rep.multi === multi) {
            multi.winner = leg;
            rep.multi = null;
            for (const other of multi.legs) if (other !== leg) other.call?.hangup();
            attachCall(rep, call);
            send(rep, {
              type: "multi-answered",
              ref: multi.ref,
              legRef: leg.ref,
              callId: call.id,
              to: call.remoteNumber,
              callerId: call.callerId,
            });
          } else {
            call.hangup(); // lost the race
          }
        }
        report();
      });
      call.once("ended", (info) => {
        if (leg !== multi.winner) {
          leg.status = legStatusForEnd(info.reason);
          if (info.reason === "failed") leg.error = endedMessage(info);
        }
        report();
        finishIfDone();
      });
    });
    report();
    finishIfDone();
  }

  function hangupAll(rep) {
    rep.call?.hangup();
    if (rep.multi) {
      const multi = rep.multi;
      for (const leg of multi.legs) leg.call?.hangup();
    }
  }

  function handleAnswer(rep, callId) {
    const entry = pendingIncoming.get(callId);
    if (!entry || entry.taken || entry.call.state !== "ringing") {
      return send(rep, { type: "incoming-gone", callId, reason: entry?.taken ? "answered-elsewhere" : "ended" });
    }
    if (rep.call || rep.multi) return send(rep, { type: "dial-error", message: "Finish your current call first." });
    entry.taken = rep;
    pendingIncoming.delete(callId);
    send(rep, {
      type: "call-started",
      callId: entry.call.id,
      direction: "inbound",
      from: entry.call.remoteNumber,
      name: entry.call.remoteName,
      callerId: ua.config.callerId,
    });
    // Attached first so the "answered" state reaches the browser.
    attachCall(rep, entry.call);
    try {
      entry.call.answer();
    } catch (err) {
      rep.call = null;
      return send(rep, { type: "dial-error", message: err.message });
    }
    for (const other of entry.offeredTo) {
      if (other !== rep) send(other, { type: "incoming-gone", callId, reason: "answered-elsewhere" });
    }
  }

  function withdrawOffer(rep, callId) {
    const entry = pendingIncoming.get(callId);
    if (!entry || entry.taken) return;
    entry.offeredTo.delete(rep);
    // Nobody left who could take it — let the caller know now rather
    // than ringing out the full timeout.
    if (!entry.offeredTo.size) entry.call.reject(486, "Busy Here", "declined");
  }

  ua.on("incoming", (call) => {
    const eligible = [...reps].filter((r) => !r.call && !r.multi);
    if (!eligible.length) {
      call.reject(480, "Temporarily Unavailable", "no-answer");
      onMissedCall(call);
      return;
    }
    const entry = { call, offeredTo: new Set(eligible), taken: null };
    pendingIncoming.set(call.id, entry);
    for (const rep of eligible) {
      send(rep, { type: "incoming", callId: call.id, from: call.remoteNumber, name: call.remoteName });
    }
    call.once("ended", (info) => {
      if (entry.taken) return;
      pendingIncoming.delete(call.id);
      for (const rep of entry.offeredTo) send(rep, { type: "incoming-gone", callId: call.id, reason: info.reason });
      if (info.reason === "cancelled" || info.reason === "no-answer") onMissedCall(call);
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://gateway");
    const claims = verifyToken(url.searchParams.get("token"));
    if (!claims) {
      ws.close(4001, "Invalid or expired voice token");
      return;
    }
    const rep = { ws, id: claims.sub, name: claims.name || "Rep", call: null, multi: null, alive: true };
    reps.add(rep);
    log.log(`[gateway] ${rep.name} connected (${reps.size} online)`);
    send(rep, {
      type: "hello",
      registration: ua.registration,
      channels: ua.channels.snapshot(),
      callerId: ua.config.callerId,
    });

    ws.on("pong", () => {
      rep.alive = true;
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!rep.call || data.length < 2) return;
        const copy = new Int16Array(data.length >> 1);
        Buffer.from(copy.buffer).set(data.subarray(0, copy.length * 2));
        rep.call.pushAudio(copy);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "dial":
          return handleDial(rep, msg);
        case "dial-multi":
          return handleDialMulti(rep, msg);
        case "hangup":
          return hangupAll(rep);
        case "answer":
          return handleAnswer(rep, msg.callId);
        case "reject":
          return withdrawOffer(rep, msg.callId);
        case "dtmf":
          return rep.call?.sendDtmf(msg.digits);
        case "ping":
          return send(rep, { type: "pong" });
        default:
      }
    });

    ws.on("close", () => {
      reps.delete(rep);
      hangupAll(rep);
      for (const [callId, entry] of pendingIncoming) if (entry.offeredTo.has(rep)) withdrawOffer(rep, callId);
      log.log(`[gateway] ${rep.name} disconnected (${reps.size} online)`);
    });
  });

  // Drop sockets that stopped answering pings (laptop lid closed, …)
  // so they don't keep being offered inbound calls.
  const heartbeat = setInterval(() => {
    for (const rep of reps) {
      if (!rep.alive) {
        rep.ws.terminate();
        continue;
      }
      rep.alive = false;
      rep.ws.ping();
    }
  }, 30000);
  wss.on("close", () => clearInterval(heartbeat));

  return { wss, reps, pendingIncoming };
}
