// Shared Twilio logic used by both the local Express server
// (server/index.js, for `npm run dev:all` + ngrok) and the Vercel
// serverless functions (/api/*.js, used on the deployed site). Keeping
// this in one place means the local and production calling paths can
// never drift apart.
import twilio from "twilio";
import crypto from "crypto";

const REQUIRED_ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
];

export function missingTwilioEnv(env = process.env) {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
  if (getCallerIdPool(env).length === 0) missing.push("TWILIO_CALLER_ID (or TWILIO_CALLER_IDS)");
  return missing;
}

// The pool of numbers outbound calls and SMS rotate through as their
// caller ID. Comma-separate several ("+618700001,+618700002,+618700003,
// +618700004") to rotate across them, spreading volume so no single
// number gets flagged by carriers — or leave just one for a
// single-number setup. Reads TWILIO_CALLER_IDS (plural) if set,
// otherwise TWILIO_CALLER_ID (singular) — but either name is split
// the same way, since "the list ended up on the singularly-named var"
// is an easy mistake (that's exactly what happened once already) and
// there's no reason the app should break over which name it's under.
//
// Twilio also requires E.164 ("+61...") for a caller ID — missing the
// "+" makes the gateway reject the call outright, every single call,
// not intermittently (the Twilio Console's own phone number list
// shows each number twice, once with the "+" and once without, right
// underneath — an easy copy-paste trap). Normalized defensively
// rather than trusting the env var is exactly right.
function normalizeCallerId(raw) {
  const s = String(raw).trim();
  return s && !s.startsWith("+") ? `+${s}` : s;
}

export function getCallerIdPool(env = process.env) {
  const raw = env.TWILIO_CALLER_IDS || env.TWILIO_CALLER_ID || "";
  return raw
    .split(",")
    .map((s) => normalizeCallerId(s))
    .filter(Boolean);
}

// Mints a short-lived Access Token so the browser can register as a
// Twilio Voice device (the same softphone model GoHighLevel uses).
export function mintAccessToken(identity, env = process.env) {
  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: env.TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });

  const token = new AccessToken(
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_API_KEY_SID,
    env.TWILIO_API_KEY_SECRET,
    { identity, ttl: 3600 }
  );
  token.addGrant(voiceGrant);
  return token.toJwt();
}

// Builds the TwiML response for the voice webhook: who to dial and
// what caller ID to show. callerId is resolved by the caller (see
// api/voice.js) — usually the next number in TWILIO_CALLER_IDS'
// rotation — rather than read from env here, since picking it may
// require a database round-trip this function shouldn't need to know
// about.
//
// The <Dial>'s `action` is what makes live transfers possible (see
// "Live transfer" below): without one, the moment the lead's leg is
// moved out of this bridge Twilio would treat the rep's own leg as
// finished and hang it up too. With it, Twilio instead asks
// /api/voice-dial-action what to do with the rep next — which is
// "join the transfer conference" if a transfer's in progress, or
// simply hang up if the lead just ended the call normally. Relative
// URL on purpose: Twilio resolves it against the voice webhook URL
// pasted into the TwiML App, so it works unchanged on Vercel and
// behind a local ngrok tunnel alike, with no PUBLIC_URL needed.
export function buildVoiceTwiml(to, callerId, { recording = null } = {}) {
  const twiml = new twilio.twiml.VoiceResponse();

  if (to) {
    // `recording` (see recordingOptions below) is null when calls
    // aren't being recorded — the <Dial> is then exactly as before.
    const dial = twiml.dial({
      callerId,
      action: "/api/voice-dial-action",
      method: "POST",
      ...(recording
        ? {
            record: "record-from-answer",
            recordingStatusCallback: recording.statusCallback,
            recordingStatusCallbackEvent: "completed",
            recordingStatusCallbackMethod: "POST",
          }
        : {}),
    });
    if (/^client:/.test(to)) {
      dial.client(to.replace(/^client:/, ""));
    } else {
      dial.number(to);
    }
  } else {
    twiml.say("Thanks for calling. No destination number was provided.");
  }

  return twiml.toString();
}

// Same API Key credentials used to mint Voice tokens also work as a
// REST client for sending SMS — no separate Twilio setup needed.
function restClient(env = process.env) {
  return twilio(env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, { accountSid: env.TWILIO_ACCOUNT_SID });
}

// Sends an outbound SMS. Uses TWILIO_MESSAGING_SERVICE_SID if set
// (recommended by Twilio — better deliverability, required for some
// inbound routing setups); otherwise falls back to sending from the
// caller ID pool. Unlike outbound calls — which rotate sequentially,
// tracked client-side per browser tab (see src/lib/twilioDevice.js) —
// each SMS send is its own stateless serverless invocation with no
// "next in sequence" to pick up, so this rotates by picking a random
// number from the pool per send instead. Same goal either way:
// spread volume so no single number gets carrier-flagged (the same
// concern a spam-filtered "Delivered" message is a symptom of).
export async function sendSms({ to, body }, env = process.env) {
  const client = restClient(env);
  const params = { to, body };
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    const pool = getCallerIdPool(env);
    params.from = pool[Math.floor(Math.random() * pool.length)];
  }
  const message = await client.messages.create(params);
  return { sid: message.sid, status: message.status };
}

// ---------- Multi-line dialling ----------
// "Dial N leads at once, whoever answers first gets bridged to the
// rep" is built on a Twilio Conference: the rep's browser leg (see
// api/voice.js's Conference branch) and each lead's REST-placed leg
// (see below) all join the same conference by name. The rep's leg
// both starts it (so they hear default hold music while lines ring)
// and ends it on exit (so hanging up tears the whole thing down);
// every lead leg does neither, so a losing leg being hung up — or
// even one ringing out to voicemail on its own — never touches the
// conference itself.
//
// Every lead leg joins muted (see buildConferenceTwiml) — a lead's
// audio never reaches the rep just by answering, only once
// unmuteConferenceParticipant() below confirms it as the winner. This
// is what actually prevents cross-talk: a losing leg answering a
// moment after the winner is claimed is still fully live in the
// conference (it can hear it) for as long as it takes endOrCancelCall
// to reach it, but it was never audible to the rep in the first
// place, muted the instant it joined.
export function generateMultilineConferenceName() {
  return `ml_${crypto.randomBytes(8).toString("hex")}`;
}

// Twilio needs a real, publicly-reachable URL to fetch each lead
// leg's TwiML and hit its status callback — unlike /api/voice and
// /api/sms-inbound (fixed webhook URLs pasted into the Twilio Console
// once), these are generated fresh per batch with query params baked
// in, so they can't be pre-configured. On Vercel this just works via
// the deployment's own VERCEL_URL; local dev (no public hostname of
// its own) needs PUBLIC_URL set to the same ngrok tunnel already used
// for the Voice webhook — see .env.example.
export function publicBaseUrl(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "";
}

// ---------- Call recording ----------
// Every outbound call is recorded by default, and Twilio reports each
// finished recording to /api/recording-status (see that file), which
// drops it into the lead's conversation as a playable message. Set
// TWILIO_RECORD_CALLS=false to switch recording off entirely. Needs a
// public base URL for the callback (same requirement as multi-line
// dialling); with none — local dev without PUBLIC_URL — calls simply
// aren't recorded, rather than recorded with nowhere to report to.
// The ids passed in are baked into the callback URL so the recording
// can be attributed: leadId for a contact call, `to` (the dialled
// number) as a fallback for a manual dial, conferenceName for Multi
// Line. Returns null when not recording.
export function recordingOptions({ leadId, to, conferenceName } = {}, env = process.env) {
  if (String(env.TWILIO_RECORD_CALLS || "true").toLowerCase() === "false") return null;
  const base = publicBaseUrl(env);
  if (!base) return null;
  const params = new URLSearchParams();
  if (leadId) params.set("leadId", String(leadId));
  if (to) params.set("to", String(to));
  if (conferenceName) params.set("conf", String(conferenceName));
  const qs = params.toString();
  return { statusCallback: `${base}/api/recording-status${qs ? `?${qs}` : ""}` };
}

// Fetches a recording's MP3 from Twilio, authenticated with the same
// API Key that mints Voice tokens — the browser never talks to Twilio
// directly for media (see api/recording-audio.js, which streams this
// through behind the app's own login). `range` is the browser's Range
// header, forwarded so seeking in the player works.
export async function fetchRecordingMedia(recordingSid, { range } = {}, env = process.env) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${encodeURIComponent(
    recordingSid
  )}.mp3`;
  const auth = Buffer.from(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };
  if (range) headers.Range = range;
  return fetch(url, { headers });
}

export function buildConferenceTwiml({ conferenceName, isRep, recording = null }) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.dial().conference(
    {
      startConferenceOnEnter: isRep,
      endConferenceOnExit: isRep,
      // Recording is declared on the rep's leg only (it's what starts
      // the conference) — see recordingOptions below. The finished
      // recording is attributed to the batch's winning lead by
      // api/recording-status.js, since which lead that is isn't known
      // until someone answers.
      ...(recording && isRep
        ? {
            record: "record-from-start",
            recordingStatusCallback: recording.statusCallback,
            recordingStatusCallbackEvent: "completed",
            recordingStatusCallbackMethod: "POST",
          }
        : {}),
      // A lead leg joins muted — it can hear the conference but isn't
      // heard by the rep — until api/multiline-status.js confirms it
      // as the winner and explicitly unmutes it. Without this, every
      // leg that answers is live audio to the rep the instant it's
      // picked up, regardless of whether the server has decided it's
      // the winner yet — exactly what let a losing (already-hung-up-
      // in-Twilio's-eyes-a-moment-later) call's audio bleed through.
      muted: !isRep,
      beep: false,
    },
    conferenceName
  );
  return twiml.toString();
}

// Unmutes the winning leg once claimMultilineWinner has confirmed it
// server-side — this is the only thing that ever makes a lead leg
// audible to the rep; joining the conference (buildConferenceTwiml
// above) never does on its own. `conferenceName` accepts the
// Conference's friendly name in place of its SID for this endpoint
// (documented Twilio REST API behavior) — tried first since it's one
// less round trip — falling back to looking the conference up by
// name (it's always "in-progress" by the time a leg inside it has
// answered) if that's ever rejected.
export async function unmuteConferenceParticipant({ conferenceName, callSid }, env = process.env) {
  const client = restClient(env);
  try {
    await client.conferences(conferenceName).participants(callSid).update({ muted: false });
  } catch (err) {
    const conferences = await client.conferences.list({ friendlyName: conferenceName, limit: 1 });
    if (!conferences[0]) throw err;
    await client.conferences(conferences[0].sid).participants(callSid).update({ muted: false });
  }
}

// How long a lead's line is allowed to ring before Twilio gives up on
// it and reports "no-answer" — well short of Twilio's own 60s
// default. A power dialler moves on fast; nobody's waiting a full
// minute to find out a line went unanswered.
export const MULTILINE_RING_SECONDS = 25;

// Twilio requires E.164 (e.g. +61412334556) to actually route a
// call — a locally-formatted number like "0412 334 556" (exactly what
// typing your own number into "Add contact" naturally produces) gets
// rejected outright, so the call never rings at all. The single-line
// dialler normalizes this client-side before dialing (see
// src/lib/twilioDevice.js's toE164) since it's a browser WebRTC
// connection; multi-line's lead legs are placed here, straight from
// the database, so the same normalization has to happen server-side
// instead. Same Australia-first logic as that copy — keep them in
// sync if either changes.
function toE164(rawPhone) {
  const cleaned = String(rawPhone || "").replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("0")) return `+61${cleaned.slice(1)}`;
  if (cleaned.startsWith("61")) return `+${cleaned}`;
  return cleaned;
}

// Places one leg of a multi-line batch via the REST API (as opposed
// to the rep's own leg, which the browser places itself as a WebRTC
// Device connection — see src/lib/twilioDevice.js). `url` is what
// Twilio fetches once the call is answered (the conference-join
// TwiML); `statusCallback` is hit on every status transition
// (ringing/in-progress/completed/…) so the batch's progress — and
// which leg wins — can be tracked server-side.
export async function placeConferenceLeg({ to, from, url, statusCallback }, env = process.env) {
  const client = restClient(env);
  const call = await client.calls.create({
    to: toE164(to),
    from,
    url,
    statusCallback,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    timeout: MULTILINE_RING_SECONDS,
  });
  return { sid: call.sid, status: call.status };
}

// Hangs up (if it's already answered/in-progress) or cancels (if
// it's still queued/ringing) one call by SID — used both to drop a
// losing leg the instant a batch has a winner, and to abort every
// still-pending leg if the rep hangs up before anyone answers. Twilio
// rejects "completed" on a call that hasn't been answered yet (and
// vice versa for "canceled"), and there's no cheap way to know which
// state a given leg is in from here without an extra lookup, so this
// just tries both — the second is a harmless no-op once the first has
// already taken effect, and either failing outright (call already
// ended on its own) is fine to swallow.
export async function endOrCancelCall(sid, env = process.env) {
  const client = restClient(env);
  for (const status of ["completed", "canceled"]) {
    try {
      await client.calls(sid).update({ status });
      return;
    } catch {
      // try the next status, or give up silently — see comment above
    }
  }
}

// ---------- Live transfer ----------
// "Put the lead on hold, ring someone else, then merge everyone into
// one call." A normal single-line call is a plain <Dial> bridge
// between the rep's browser leg (the parent call) and the lead's leg
// (its child) — there's no third seat in a bridge, so the transfer
// works by moving everyone into a Twilio Conference instead:
//
//   1. The added party is dialled via the REST API, straight into a
//      conference named after the rep's own call (below), with the
//      join TwiML inlined on the call itself — no public callback URL
//      needed, unlike multi-line dialling.
//   2. The lead's leg is redirected to a hold-music TwiML (see
//      buildHoldTwiml). That pulls it out of the <Dial> bridge, which
//      ends the rep's <Dial> — and, thanks to its `action` (see
//      buildVoiceTwiml), Twilio then asks /api/voice-dial-action what
//      to do with the rep. That handler sees the lead is still alive
//      (i.e. this was a transfer, not the lead hanging up) and joins
//      the rep into the same conference, where the added party lands
//      the moment they answer. The lead hears music; the rep and the
//      added party talk privately.
//   3. "Merge" redirects the lead's leg into the conference too.
//
// Everything after that is the conference's own lifecycle: the rep's
// seat ends it on exit, nobody else's does, so the rep hanging up
// still tears the whole call down in one go. A rep already in a
// conference (Multi Line, or after an earlier transfer on the same
// call) skips the <Dial>/action dance entirely — the lead's leg is
// simply redirected out to hold and back in again.
//
// Nothing is stored server-side: the browser keeps the handful of
// call SIDs it gets back from /api/transfer-start and asks Twilio
// (via /api/transfer-status) how each leg is doing.

// A Twilio-hosted track — the same music Twilio's own default
// conference wait music draws from, so a held lead hears exactly what
// a Multi Line lead does while waiting. One play-through (a good few
// minutes) then a polite hangup, rather than looping forever: a lead
// only ever ends up parked here without being brought back if the
// rep's browser vanished mid-transfer, and a call left on hold
// indefinitely is money down the drain.
export const TRANSFER_HOLD_MUSIC_URL = "http://com.twilio.music.classical.s3.amazonaws.com/BusyStrings.mp3";

// How long the added party's line rings before Twilio gives up on it
// — a touch longer than a multi-line lead leg gets, since this is
// usually a known colleague/closer rather than a cold lead.
export const TRANSFER_RING_SECONDS = 30;

export function transferConferenceName(parentCallSid) {
  return `xfer_${parentCallSid}`;
}

export function buildHoldTwiml() {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.play({ loop: 1 }, TRANSFER_HOLD_MUSIC_URL);
  twiml.say("Sorry, we weren't able to reconnect your call. Goodbye.");
  twiml.hangup();
  return twiml.toString();
}

// The lead's leg of a single-line call, found from the rep's browser
// call SID (its parent). Only a still-connected leg counts — a lead
// who's already hung up has nothing to transfer.
export async function findBridgedLeadLeg(parentCallSid, env = process.env) {
  const client = restClient(env);
  const calls = await client.calls.list({ parentCallSid, status: "in-progress", limit: 5 });
  return calls[0] ? { sid: calls[0].sid, to: calls[0].to, from: calls[0].from } : null;
}

// Replaces what a live call is doing with new TwiML — how a lead gets
// parked on hold, and how they get brought (back) into the conference.
export async function redirectCallToTwiml(sid, twiml, env = process.env) {
  const client = restClient(env);
  await client.calls(sid).update({ twiml });
}

export async function fetchCallStatus(sid, env = process.env) {
  const client = restClient(env);
  const call = await client.calls(sid).fetch();
  return call.status;
}

// Dials the person being added, straight into the transfer conference
// on answer. Same as a multi-line lead leg (placeConferenceLeg) except
// the join TwiML rides along inline, so no publicly reachable URL is
// needed — transfers work in local dev with nothing but the Voice
// webhook tunnel that single-line calling already needs.
export async function placeTransferLeg({ to, from, conferenceName }, env = process.env) {
  const client = restClient(env);
  const call = await client.calls.create({
    to: toE164(to),
    from,
    twiml: buildConferenceTwiml({ conferenceName, isRep: false }),
    timeout: TRANSFER_RING_SECONDS,
  });
  return { sid: call.sid, status: call.status, to: toE164(to) };
}

// What the rep's leg does once its <Dial> to the lead ends (see
// buildVoiceTwiml's `action`). Twilio posts the outcome of the Dial
// here; the one case that isn't simply "the call's over" is a live
// transfer having just pulled the lead out of the bridge — told apart
// by the lead's leg still being in progress, which a lead who hung up
// never is. The Dial's own outcome is checked first so the common
// ring-outs (no-answer/busy/failed) never cost a REST lookup at all.
export async function buildDialActionTwiml({ CallSid, DialCallSid, DialCallStatus }, env = process.env) {
  const twiml = new twilio.twiml.VoiceResponse();
  const bridged = DialCallStatus === "completed" || DialCallStatus === "answered";
  if (CallSid && DialCallSid && bridged) {
    let leadStatus = "";
    try {
      leadStatus = await fetchCallStatus(DialCallSid, env);
    } catch (err) {
      console.error("[twilio] dial-action status lookup failed", err.message);
    }
    if (leadStatus === "in-progress") {
      return buildConferenceTwiml({ conferenceName: transferConferenceName(CallSid), isRep: true });
    }
  }
  twiml.hangup();
  return twiml.toString();
}
