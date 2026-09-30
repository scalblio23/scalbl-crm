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
//   { type: "transfer-start", to }   { type: "transfer-cancel" }
//   { type: "transfer-complete" }
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
//   { type: "transfer-state", status, to, message }
//       placing | ringing | connected | no-answer | busy | failed |
//       left | cancelled | completed | error (a request that
//       couldn't be carried out; the transfer itself is unchanged)
//
// Live transfer: the rep's call stays up while the gateway rings a
// third party on another channel. Once they answer, all three hear
// each other (the gateway mixes the audio — each person hears the
// other two). "Complete" hands the lead over: the two outside calls
// are bridged directly and the rep drops off; when either of them
// hangs up, the other is hung up too.
import { WebSocketServer } from "ws";
import { ChannelsBusyError } from "./ua.js";
import { TimedMixer } from "./mixer.js";

const MAX_WS_BUFFER = 64 * 1024; // drop outbound audio rather than build latency

const END_MESSAGES = {
  busy: "Line busy.",
  declined: "The call was declined.",
  "no-answer": "No answer.",
  cancelled: "",
  "hangup-local": "",
  "hangup-remote": "",
};

// What common Q.850 cause codes mean for a rep.
const CAUSE_MESSAGES = {
  1: "That number doesn't exist — it's disconnected or mistyped",
  3: "The network has no route to that number",
  22: "That number has changed",
  27: "That phone is out of service",
  28: "That number isn't in a valid format",
  29: "The network refused this call (facility rejected)",
  31: "The network couldn't connect the call",
  34: "No line was free on the network — try again",
  38: "The network is out of order — try again",
  41: "A temporary network failure — try again",
  42: "The network is congested — try again",
  44: "No line was free on the network — try again",
  47: "No line was free on the network — try again",
  50: "This trunk isn't subscribed to that kind of call",
  55: "Calls like this are barred on this trunk",
  57: "This trunk isn't allowed to make that call",
  58: "That service isn't available right now",
  63: "That service isn't available on this trunk",
  65: "That service isn't supported",
  88: "The destination can't take this kind of call",
  102: "The network timed out — try again",
  111: "The carrier rejected the call (protocol error)",
  127: "The carrier couldn't connect the call (interworking)",
};

export function endedMessage({ reason, status, sipReason, cause }) {
  if (reason in END_MESSAGES) return END_MESSAGES[reason];
  if (cause && CAUSE_MESSAGES[cause]) return `${CAUSE_MESSAGES[cause]} (${status} ${sipReason}, cause ${cause}).`;
  if (cause) return `The call failed (${status} ${sipReason}, cause ${cause}).`;
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
      if (rep.call !== call) return;
      if (rep.earMixer) rep.earMixer.push(pcm, "lead");
      else sendAudio(rep, pcm);
    });
    call.on("dtmf", (digit) => send(rep, { type: "dtmf", callId: call.id, digit }));
    call.once("ended", (info) => {
      if (call.handedOver) return; // the rep already left it (live transfer)
      if (rep.call === call) rep.call = null;
      endTransfer(rep, "hangup");
      send(rep, { type: "call-ended", callId: call.id, ...info, message: endedMessage(info) });
    });
  }

  function sendAudio(rep, pcm) {
    const { ws } = rep;
    if (ws.readyState !== ws.OPEN || ws.bufferedAmount > MAX_WS_BUFFER) return;
    ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), { binary: true });
  }

  // ---------- live transfer ----------

  function sendTransfer(rep, status, message = "") {
    send(rep, { type: "transfer-state", status, to: rep.transfer?.to || "", message });
  }

  function handleTransferStart(rep, msg) {
    const lead = rep.call;
    if (!lead || lead.state !== "answered") {
      return send(rep, { type: "transfer-state", status: "failed", to: msg.to || "", message: "The call isn't connected yet." });
    }
    if (rep.transfer) return; // one at a time
    let target;
    try {
      target = ua.dial(msg.to, { label: `${rep.name} transfer → ${msg.to}` });
    } catch (err) {
      const message =
        err instanceof ChannelsBusyError ? "No free line to ring them on — every SIP channel is in use." : err.message;
      return send(rep, { type: "transfer-state", status: "failed", to: msg.to || "", message });
    }
    const transfer = { call: target, lead, to: target.remoteNumber || msg.to, status: "placing", unwire: [] };
    rep.transfer = transfer;
    sendTransfer(rep, "placing");
    target.on("state", (state) => {
      if (rep.transfer !== transfer) return;
      if (state === "ringing" && transfer.status === "placing") {
        transfer.status = "ringing";
        sendTransfer(rep, "ringing");
      } else if (state === "answered") {
        transfer.status = "connected";
        startThreeWay(rep, transfer);
        sendTransfer(rep, "connected");
      }
    });
    target.once("ended", (info) => {
      if (rep.transfer !== transfer) return; // handed over, or already torn down
      const status = transfer.cancelled
        ? "cancelled"
        : transfer.status === "connected"
        ? "left"
        : info.reason === "busy" || info.reason === "declined"
        ? "busy"
        : info.reason === "no-answer" || info.reason === "cancelled"
        ? "no-answer"
        : "failed";
      stopThreeWay(rep, transfer);
      rep.transfer = null;
      send(rep, {
        type: "transfer-state",
        status,
        to: transfer.to,
        message: status === "failed" ? endedMessage(info) : "",
      });
    });
  }

  // Everyone hears the other two: the lead gets the rep + third party,
  // the third party gets the rep + lead, the rep gets lead + third party.
  function startThreeWay(rep, transfer) {
    const { lead, call: target } = transfer;
    const leadAudio = (pcm) => target.pushAudio(pcm, "bridge");
    const targetAudio = (pcm) => {
      lead.pushAudio(pcm, "bridge");
      if (rep.earMixer && rep.transfer === transfer) rep.earMixer.push(pcm, "transfer");
    };
    lead.on("audio", leadAudio);
    target.on("audio", targetAudio);
    transfer.unwire.push(() => lead.off("audio", leadAudio), () => target.off("audio", targetAudio));
    rep.earMixer = new TimedMixer((frame) => sendAudio(rep, frame));
  }

  function stopThreeWay(rep, transfer) {
    for (const fn of transfer.unwire) fn();
    transfer.unwire = [];
    transfer.lead.dropAudioSource("bridge");
    transfer.call.dropAudioSource("bridge");
    rep.earMixer?.stop();
    rep.earMixer = null;
  }

  // Ends a transfer in flight along with the rep's call (the call ended,
  // or the rep hung up / disconnected) — the third party's leg goes too.
  function endTransfer(rep) {
    const transfer = rep.transfer;
    if (!transfer) return;
    stopThreeWay(rep, transfer);
    rep.transfer = null;
    transfer.call.hangup();
  }

  function handleTransferCancel(rep) {
    const transfer = rep.transfer;
    if (!transfer) return;
    transfer.cancelled = true;
    transfer.call.hangup(); // its "ended" reports "cancelled"
  }

  // Hands the lead over to the third party and takes the rep out.
  function handleTransferComplete(rep) {
    const transfer = rep.transfer;
    if (!transfer || transfer.status !== "connected" || rep.call !== transfer.lead) {
      return send(rep, { type: "transfer-state", status: "error", to: transfer?.to || "", message: "They aren't on the line yet." });
    }
    const { lead, call: target } = transfer;
    // Keep the lead ↔ third party audio; drop the rep's ear and mic.
    rep.earMixer?.stop();
    rep.earMixer = null;
    lead.dropAudioSource("main");
    target.dropAudioSource("main");
    lead.recordingStopped = true; // the recording covers up to the handover
    lead.handedOver = true;
    rep.transfer = null;
    rep.call = null;
    // From here the two calls live on their own: when one hangs up, so
    // does the other (and both channels are released).
    lead.once("ended", () => target.hangup());
    target.once("ended", () => {
      for (const fn of transfer.unwire) fn();
      lead.hangup();
    });
    log.log(`[gateway] ${rep.name} handed ${lead.remoteNumber} over to ${transfer.to}`);
    send(rep, { type: "transfer-state", status: "completed", to: transfer.to, message: "" });
    send(rep, { type: "call-ended", callId: lead.id, reason: "transferred", status: 0, sipReason: "", message: "", durationMs: 0 });
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
    endTransfer(rep);
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
        if (rep.transfer?.status === "connected") rep.transfer.call.pushAudio(copy);
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
        case "transfer-start":
          return handleTransferStart(rep, msg);
        case "transfer-cancel":
          return handleTransferCancel(rep);
        case "transfer-complete":
          return handleTransferComplete(rep);
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
