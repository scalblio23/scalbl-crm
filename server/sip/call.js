// One SIP call (dialog) over the trunk — outbound (we sent the INVITE)
// or inbound (the provider sent it) — plus its RTP media session.
//
// States: "new" → "calling" (INVITE sent) → "ringing" (180/183, or an
// inbound call waiting to be answered) → "answered" → "ended".
//
// Events:
//   "state" (state)
//   "audio" (Int16Array, 8 kHz)  — far end's audio, incl. early media
//   "dtmf"  (digit)              — digits the far end pressed
//   "ended" ({ reason, status, sipReason, durationMs })
//
// End reasons: hangup-local, hangup-remote, busy, declined, no-answer,
// cancelled (caller gave up before it was answered), failed.
import { EventEmitter } from "events";
import { createResponse, newBranch, newCallId, newTag, parseNameAddr, parseUri, randomToken } from "./message.js";
import { parseChallenge, buildDigestAuthorization } from "./digest.js";
import { buildSdp, parseSdp, negotiateCodec, isHold } from "./sdp.js";
import { RtpSession } from "./rtp.js";
import { toE164, formatForDial, isDialable, callerNumberFromUser } from "./phone.js";

const ALLOW = "INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, UPDATE, NOTIFY";

// The ISDN cause code a carrier puts in a failure's Reason header
// ("Q.850;cause=21;text=…") — far more specific than a generic 500.
export function parseQ850(header) {
  const m = /Q\.850\s*;[^,]*?cause\s*=\s*(\d+)/i.exec(String(header || ""));
  return m ? Number(m[1]) : 0;
}

function outcomeForStatus(status, cause = 0) {
  if (cause === 17) return "busy";
  if (cause === 18 || cause === 19) return "no-answer";
  if (cause === 21) return "declined";
  if (status === 486 || status === 600) return "busy";
  if (status === 603) return "declined";
  if (status === 408 || status === 480) return "no-answer";
  if (status === 487) return "cancelled";
  return "failed";
}

export class Call extends EventEmitter {
  constructor(ua, { direction, lease, ringTimeoutSeconds, callerId }) {
    super();
    this.ua = ua;
    this.config = ua.config;
    this.log = ua.log;
    this.id = randomToken(8);
    this.direction = direction;
    this.lease = lease;
    this.ringTimeoutSeconds = ringTimeoutSeconds || this.config.ringTimeoutSeconds;
    // The number this call presents (outbound) — see ua.nextCallerId().
    this.callerId = callerId || this.config.callerId;
    this.state = "new";
    this.rtp = new RtpSession({ portMin: this.config.rtpPortMin, portMax: this.config.rtpPortMax });
    this.rtp.on("audio", (pcm) => {
      if (this.isRecording()) this.recorder.write("remote", pcm);
      this.emit("audio", pcm);
    });
    // What we send — the rep's mic, plus the third party during a live
    // transfer — is the recording's other side.
    this.rtp.on("sent", (pcm) => {
      if (this.isRecording()) this.recorder.write("local", pcm);
    });
    // Set by the gateway once the call is answered and belongs to a rep
    // (see sip/recorder.js). recordingStopped ends it early — when the
    // rep hands the call over in a live transfer and drops off.
    this.recorder = null;
    this.recordingStopped = false;
    this.rtp.on("dtmf", (digit) => this.emit("dtmf", digit));
    this.rtp.on("error", (err) => this.log.warn(`[rtp] ${err.message}`));
    this.sessionId = Math.floor(Math.random() * 1e9);
    this.sdpVersion = 1;
    this.localTag = newTag();
    this.remoteTag = "";
    this.callId = "";
    this.localCseq = Math.floor(Math.random() * 1000) + 1;
    this.remoteCseq = 0;
    this.localHeader = ""; // our From (outbound) / To (inbound), with our tag
    this.remoteHeader = ""; // their To (outbound) / From (inbound), with their tag
    this.remoteTarget = "";
    this.routeSet = [];
    this.codec = null;
    this.remoteNumber = "";
    this.remoteName = "";
    this.answeredAt = 0;
    this.timers = new Set();
    this.endReason = "";
  }

  get isEnded() {
    return this.state === "ended";
  }

  setState(state) {
    if (this.state === state || this.isEnded) return;
    this.state = state;
    this.emit("state", state);
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  cancelTimer(t) {
    if (!t) return;
    clearTimeout(t);
    this.timers.delete(t);
  }

  localSdp() {
    const codecs = this.codec ? [this.codec.name] : this.config.codecs;
    return buildSdp({
      ip: this.ua.mediaIp(),
      port: this.rtp.localPort,
      sessionId: this.sessionId,
      version: this.sdpVersion,
      codecs,
      // Once the far end's SDP is known, only echo back the
      // telephone-event type they offered (none if they didn't).
      dtmfPt: this.remoteSdpSeen ? this.rtp.dtmfPt : 101,
    });
  }

  applyRemoteSdp(body) {
    const remote = parseSdp(body);
    if (!remote) return false;
    if (!this.codec) {
      this.codec = negotiateCodec(remote, this.config.codecs);
      if (!this.codec) return false;
    }
    this.rtp.setCodec(this.codec, remote.dtmfPt);
    this.remoteSdpSeen = true;
    this.rtp.paused = isHold(remote) && (remote.ip === "0.0.0.0" || remote.direction === "inactive");
    if (remote.ip !== "0.0.0.0") this.rtp.setRemote(remote.ip, remote.port);
    return true;
  }

  // Builds a request inside this dialog (BYE, INFO, 2xx ACK, …).
  inDialogRequest(method, { cseq } = {}) {
    const req = this.ua.buildRequest(method, this.remoteTarget, {
      callId: this.callId,
      from: this.localHeader,
      to: this.remoteHeader,
      cseq: cseq ?? ++this.localCseq,
      routes: this.routeSet,
    });
    return req;
  }

  // ---------- outbound ----------

  async dial(number) {
    const { domain, dialFormat } = this.config;
    const callerId = this.presentedCallerId();
    const fromUser = this.config.fromUser || callerId;
    if (!isDialable(number)) throw new Error(`"${number}" isn't a dialable phone number.`);
    this.remoteNumber = toE164(number);
    this.requestUri = `sip:${formatForDial(number, dialFormat)}@${domain}`;
    this.callId = newCallId(domain);
    this.localHeader = `"${callerId}" <sip:${fromUser}@${domain}>;tag=${this.localTag}`;
    this.remoteHeader = `<${this.requestUri}>`;
    this.remoteTarget = this.requestUri;
    this.ua.calls.set(this.callId, this);

    await this.rtp.open();
    if (this.isEnded) return; // hung up while the port was being opened
    this.setState("calling");
    this.ringTimer = this.later(() => this.cancel("no-answer"), this.ringTimeoutSeconds * 1000);
    this.sendInvite(null);
  }

  // This call's caller ID as the trunk wants it written.
  presentedCallerId() {
    const { callerIdInFrom, callerIdFormat } = this.config;
    return callerIdInFrom ? formatForDial(this.callerId, callerIdFormat) : this.callerId;
  }

  sendInvite(auth) {
    const { domain } = this.config;
    const callerId = this.presentedCallerId();
    const req = this.ua.buildRequest("INVITE", this.requestUri, {
      callId: this.callId,
      from: this.localHeader,
      to: `<${this.requestUri}>`,
      cseq: this.localCseq,
    });
    req.set("contact", `<${this.ua.contactUri()}>`);
    req.set("allow", ALLOW);
    // Assert the call's caller ID. Unless the trunk's Caller ID is set
    // to "Keep originator's caller ID", VoIPcloud presents its own
    // configured number instead.
    req.set("p-asserted-identity", `"${callerId}" <sip:${callerId}@${domain}>`);
    req.set("remote-party-id", `"${callerId}" <sip:${callerId}@${domain}>;party=calling;screen=yes;privacy=off`);
    if (auth) req.set(auth.name, auth.value);
    req.set("content-type", "application/sdp");
    req.body = this.localSdp();
    this.invite = req;
    this.gotProvisional = false;
    this.ua
      .sendRequest(req, { onProvisional: (res) => this.onInviteProvisional(res) })
      .then((res) => this.onInviteFinal(res))
      .catch((err) => this.fail(err.message));
  }

  onInviteProvisional(res) {
    if (res.cseq.seq !== this.invite.cseq.seq) return;
    this.gotProvisional = true;
    if (this.pendingCancel) {
      this.sendCancel();
      return;
    }
    if (this.isEnded) return;
    if (res.status === 180 || res.status === 183) this.setState("ringing");
    // Early media (183 Session Progress with SDP): the network's own
    // ringback tone or announcements ("the number you have called…").
    // Play it to the rep rather than leaving them in silence.
    if (res.body && (res.status === 180 || res.status === 183) && !this.earlyMedia) {
      if (this.applyRemoteSdp(res.body)) {
        this.earlyMedia = true;
        this.rtp.start();
      }
    }
  }

  onInviteFinal(res) {
    if (res.status >= 200 && res.status < 300) {
      this.remoteTag = parseNameAddr(res.get("to")).params.tag || "";
      this.remoteHeader = res.get("to");
      const contact = res.get("contact");
      if (contact) this.remoteTarget = parseNameAddr(contact).uri;
      this.routeSet = res.getAll("record-route").reverse();
      this.sendAck2xx(res);
      if (this.isEnded || this.pendingCancel || this.cancelReason) {
        // Answered at the same moment we gave up on it — hang straight up.
        this.sendBye();
        this.end(this.cancelReason || "cancelled");
        return;
      }
      if (!res.body || !this.applyRemoteSdp(res.body)) {
        this.sendBye();
        this.end("failed", { status: 488, sipReason: "No common codec (need G.711 A-law or u-law)" });
        return;
      }
      this.cancelTimer(this.ringTimer);
      this.rtp.start();
      this.answeredAt = Date.now();
      this.setState("answered");
      return;
    }

    this.sendAckNon2xx(res);
    if ((res.status === 401 || res.status === 407) && !this.authAttempted && !this.cancelReason) {
      this.authAttempted = true;
      const name = res.status === 401 ? "authorization" : "proxy-authorization";
      const challenge = parseChallenge(res.get(res.status === 401 ? "www-authenticate" : "proxy-authenticate"));
      this.localCseq++;
      this.sendInvite({
        name,
        value: buildDigestAuthorization({
          challenge,
          method: "INVITE",
          uri: this.requestUri,
          username: this.config.authUsername,
          password: this.config.password,
        }),
      });
      return;
    }
    if (this.cancelReason) {
      this.end(this.cancelReason, { status: res.status, sipReason: res.reason });
      return;
    }
    const cause = parseQ850(res.get("reason"));
    this.end(outcomeForStatus(res.status, cause), {
      status: res.status,
      sipReason: res.reason,
      cause,
      detail: [res.get("reason"), res.get("warning")].filter(Boolean).join(" | "),
    });
  }

  sendAck2xx(res) {
    const ack = this.inDialogRequest("ACK", { cseq: res.cseq.seq });
    this.lastAck = ack;
    this.ua.send(ack);
  }

  onStray2xx(res) {
    // Our ACK went missing — resend it (same CSeq, new branch is fine for 2xx ACK).
    if (this.lastAck) this.ua.send(this.lastAck);
    else if (res) this.sendAck2xx(res);
  }

  // ACK for a non-2xx final response belongs to the INVITE transaction
  // itself: same branch, same Request-URI, To tag from the response.
  sendAckNon2xx(res) {
    const inv = this.invite;
    const ack = this.ua.buildRequest("ACK", inv.uri, {
      callId: this.callId,
      from: inv.get("from"),
      to: res.get("to"),
      cseq: inv.cseq.seq,
      branch: inv.branch,
    });
    this.ua.send(ack);
  }

  sendCancel() {
    if (this.cancelSent) return;
    this.cancelSent = true;
    const inv = this.invite;
    const cancel = this.ua.buildRequest("CANCEL", inv.uri, {
      callId: this.callId,
      from: inv.get("from"),
      to: inv.get("to"),
      cseq: inv.cseq.seq,
      branch: inv.branch,
    });
    this.ua.sendRequest(cancel).catch(() => {});
    // If the provider never sends the 487 for the INVITE, don't hang
    // around waiting for it forever.
    this.later(() => this.end(this.cancelReason || "cancelled"), 8000);
  }

  // Gives up on an outbound call that hasn't been answered yet.
  cancel(reason = "cancelled") {
    if (this.isEnded || this.state === "answered") return;
    this.cancelReason = reason;
    if (!this.invite) {
      this.end(reason);
      return;
    }
    // CANCEL is only allowed once the far end has sent a provisional
    // response; until then, remember to send it as soon as one arrives.
    if (this.gotProvisional) this.sendCancel();
    else {
      this.pendingCancel = true;
      this.later(() => this.end(reason), 8000);
    }
  }

  // ---------- inbound ----------

  // Returns false (having already responded) if the call can't proceed.
  async receiveInvite(req) {
    this.invite = req;
    this.callId = req.callId;
    this.remoteHeader = req.get("from");
    this.remoteTag = parseNameAddr(this.remoteHeader).params.tag || "";
    this.localHeader = `${req.get("to")};tag=${this.localTag}`;
    const contact = req.get("contact");
    this.remoteTarget = contact ? parseNameAddr(contact).uri : parseNameAddr(this.remoteHeader).uri;
    this.routeSet = req.getAll("record-route");
    this.remoteCseq = req.cseq.seq;

    // Caller: P-Asserted-Identity when the provider sends it (the real
    // network CLI), otherwise the From header.
    const identity = parseNameAddr(req.get("p-asserted-identity") || this.remoteHeader);
    const fromAddr = parseNameAddr(this.remoteHeader);
    this.remoteNumber =
      callerNumberFromUser(parseUri(identity.uri)?.user) || callerNumberFromUser(parseUri(fromAddr.uri)?.user);
    this.remoteName = identity.display || fromAddr.display || "";
    this.ua.calls.set(this.callId, this);

    this.ua.respond(req, 100, "Trying");
    if (req.body) {
      this.remoteOffer = parseSdp(req.body);
      this.codec = negotiateCodec(this.remoteOffer, this.config.codecs);
      if (!this.codec) {
        this.reject(488, "Not Acceptable Here", "failed");
        return false;
      }
    }
    await this.rtp.open();
    if (this.isEnded) return false; // caller cancelled already
    this.ua.respond(req, 180, "Ringing", {
      toTag: this.localTag,
      headers: { contact: `<${this.ua.contactUri()}>` },
    });
    this.setState("ringing");
    this.ringTimer = this.later(
      () => this.reject(480, "Temporarily Unavailable", "no-answer"),
      this.ringTimeoutSeconds * 1000
    );
    return true;
  }

  answer() {
    if (this.direction !== "inbound" || this.state !== "ringing") {
      throw new Error("This call can't be answered (it isn't ringing).");
    }
    this.cancelTimer(this.ringTimer);
    if (this.remoteOffer) this.applyRemoteSdp(this.invite.body);
    const res = createResponse(this.invite, 200, "OK", { toTag: this.localTag });
    for (const rr of this.invite.getAll("record-route")) res.add("record-route", rr);
    res.set("contact", `<${this.ua.contactUri()}>`);
    res.set("allow", ALLOW);
    res.set("user-agent", this.config.userAgent);
    res.set("content-type", "application/sdp");
    res.body = this.localSdp();
    this.final2xx = res;

    // The UAS keeps re-sending its 2xx until the ACK arrives (RFC 3261
    // §13.3.1.4); give up and hang up if it never does.
    let interval = 500;
    const resend = () => {
      if (!this.final2xx || this.isEnded) return;
      this.ua.send(this.final2xx);
      interval = Math.min(interval * 2, 4000);
      this.retransmitTimer = this.later(resend, interval);
    };
    this.ua.send(res);
    this.retransmitTimer = this.later(resend, interval);
    this.ackTimeout = this.later(() => {
      if (!this.final2xx) return;
      this.final2xx = null;
      this.sendBye();
      this.end("failed", { sipReason: "Never received ACK for the answered call" });
    }, 32000);

    this.rtp.start();
    this.answeredAt = Date.now();
    this.setState("answered");
  }

  // Declines an inbound call that hasn't been answered.
  reject(status = 486, reason = "Busy Here", endReason = "declined") {
    if (this.isEnded) return;
    if (this.direction === "inbound" && this.state !== "answered" && this.invite) {
      this.ua.respond(this.invite, status, reason, { toTag: this.localTag });
    }
    this.end(endReason, { status, sipReason: reason });
  }

  onAck(req) {
    if (this.final2xx) {
      this.final2xx = null;
      this.cancelTimer(this.retransmitTimer);
      this.cancelTimer(this.ackTimeout);
      // Offerless INVITE: their answer arrives in the ACK.
      if (req.body && !this.remoteOffer) this.applyRemoteSdp(req.body);
    }
  }

  onCancel(req) {
    this.ua.respond(req, 200, "OK");
    if (this.direction === "inbound" && this.state !== "answered" && !this.isEnded) {
      this.ua.respond(this.invite, 487, "Request Terminated", { toTag: this.localTag });
      this.end("cancelled");
    }
  }

  // ---------- in-dialog requests from the far end ----------

  onReinvite(req) {
    if (this.isEnded) return this.ua.respond(req, 481, "Call/Transaction Does Not Exist");
    this.remoteCseq = req.cseq.seq;
    if (req.body) this.applyRemoteSdp(req.body);
    this.sdpVersion++;
    const res = createResponse(req, 200, "OK");
    res.set("contact", `<${this.ua.contactUri()}>`);
    res.set("allow", ALLOW);
    res.set("content-type", "application/sdp");
    res.body = this.localSdp();
    this.ua.send(res);
  }

  onRequest(req) {
    switch (req.method) {
      case "BYE":
        this.ua.respond(req, 200, "OK");
        if (!this.isEnded) this.end("hangup-remote");
        return;
      case "INFO": {
        // SIP INFO DTMF — some carriers send it instead of RFC 4733.
        const type = (req.get("content-type") || "").toLowerCase();
        let digit = "";
        if (type.includes("dtmf-relay")) digit = (req.body.match(/Signal\s*=\s*(\S)/i) || [])[1] || "";
        else if (type.includes("application/dtmf")) digit = req.body.trim().charAt(0);
        this.ua.respond(req, 200, "OK");
        if (digit && !this.isEnded) this.emit("dtmf", digit === "10" ? "*" : digit === "11" ? "#" : digit);
        return;
      }
      case "UPDATE": {
        if (this.isEnded) return this.ua.respond(req, 481, "Call/Transaction Does Not Exist");
        if (req.body) {
          this.applyRemoteSdp(req.body);
          this.sdpVersion++;
          return this.ua.respond(req, 200, "OK", {
            headers: { contact: `<${this.ua.contactUri()}>` },
            body: this.localSdp(),
          });
        }
        return this.ua.respond(req, 200, "OK", { headers: { contact: `<${this.ua.contactUri()}>` } });
      }
      case "OPTIONS":
      case "NOTIFY":
        return this.ua.respond(req, 200, "OK");
      default:
        return this.ua.respond(req, 501, "Not Implemented");
    }
  }

  // ---------- controls ----------

  sendBye() {
    if (this.byeSent || !this.remoteTag) return;
    this.byeSent = true;
    this.ua.sendRequest(this.inDialogRequest("BYE")).catch(() => {});
  }

  // Ends the call from our side, whatever state it's in.
  hangup() {
    if (this.isEnded) return;
    if (this.state === "answered") {
      this.sendBye();
      this.end("hangup-local");
    } else if (this.direction === "outbound") {
      this.cancel("cancelled");
    } else {
      this.reject(486, "Busy Here", "declined");
    }
  }

  sendDtmf(digits) {
    if (this.state !== "answered") return;
    const clean = String(digits).toUpperCase().replace(/[^0-9*#A-D]/g, "");
    if (!clean) return;
    if (this.rtp.dtmfPt !== null) {
      this.rtp.sendDtmf(clean);
      return;
    }
    // Far end didn't offer telephone-event: fall back to SIP INFO.
    for (const digit of clean) {
      const info = this.inDialogRequest("INFO");
      info.set("content-type", "application/dtmf-relay");
      info.body = `Signal=${digit}\r\nDuration=160\r\n`;
      this.ua.sendRequest(info).catch(() => {});
    }
  }

  // `source` keeps separate streams (the rep's mic, the other side of a
  // live transfer) mixed rather than queued one after another.
  pushAudio(pcm, source = "main") {
    if (this.state === "answered") this.rtp.pushAudio(pcm, source);
  }

  dropAudioSource(source) {
    this.rtp.dropSource(source);
  }

  isRecording() {
    return !!this.recorder && !this.recordingStopped && this.state === "answered";
  }

  fail(message) {
    if (this.isEnded) return;
    if (this.state === "answered") this.sendBye();
    this.end("failed", { sipReason: message });
  }

  end(reason, { status = 0, sipReason = "", cause = 0, detail = "" } = {}) {
    if (this.isEnded) return;
    this.endReason = reason;
    this.state = "ended";
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.rtp.close();
    this.lease?.release();
    this.lease = null;
    // Keep the dialog findable briefly so late BYEs/ACKs/retransmitted
    // 200s still get handled, then forget it.
    setTimeout(() => {
      if (this.ua.calls.get(this.callId) === this) this.ua.calls.delete(this.callId);
    }, 10000).unref();
    const durationMs = this.answeredAt ? Date.now() - this.answeredAt : 0;
    this.log.log(
      `[sip] call ${this.direction} ${this.remoteNumber || "?"}` +
        (this.direction === "outbound" ? ` from ${this.callerId}` : "") +
        ` ended: ${reason}${status ? ` (${status} ${sipReason})` : sipReason ? ` (${sipReason})` : ""}` +
        (detail ? ` [${detail}]` : "")
    );
    this.emit("ended", { reason, status, sipReason, cause, durationMs });
  }
}
