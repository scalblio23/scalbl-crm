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
export function buildVoiceTwiml(to, callerId, { recording = null } = {}) {
  const twiml = new twilio.twiml.VoiceResponse();

  if (to) {
    // `recording` (see recordingOptions below) is null when calls
    // aren't being recorded — the <Dial> is then exactly as before.
    const dial = twiml.dial({
      callerId,
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
// Hands a live lead over to a third party (typically the client's own
// closer) without the rep having to hang up and redial anyone. Built
// deliberately so the *existing* call paths are untouched: a
// Powerdialler call still starts as a plain <Dial><Number> bridge
// (see buildVoiceTwiml) and only gets moved into a conference at the
// moment a rep actually clicks "Transfer" — so nothing about placing
// a normal call, or how a normal call ends, is any different from
// before this existed.
//
// How a Powerdialler transfer works (Multi Line calls are already in
// a conference, so they skip straight to step 3):
//   1. The browser picks a fresh conference name and asks the server
//      to start the transfer (see startLiveTransfer below).
//   2. The server redirects the LEAD's leg (the child call that the
//      rep's <Dial> created) into that conference. Twilio ends the
//      rep's now-empty <Dial>, which — with no further TwiML — ends
//      the rep's browser leg; the browser is expecting that and
//      immediately re-joins the same conference itself (the same
//      joinConference() path Multi Line already uses). The lead hears
//      a second or so of silence while that happens.
//   3. The server dials the transfer target via the REST API with
//      TwiML that joins them into the same conference.
//   4. Once the target has answered, all three can talk. "Complete
//      transfer" flips who ends the conference on exit (rep: no
//      longer; lead + target: yes) and the rep hangs up, leaving the
//      other two connected. "Cancel transfer" just hangs the target up.
//
// Nothing here needs PUBLIC_URL or a status callback: the target's
// TwiML is passed inline, and the browser polls the target call's
// status directly (getCallStatus) — so this works identically in
// local dev and on Vercel.
export const TRANSFER_RING_SECONDS = 30;

// The browser generates the name (so it can rejoin the moment its
// own leg drops, before the server has even replied) — validated
// server-side to a fixed shape so it can never be a Multi Line
// conference someone else is in, or anything weird in TwiML.
export function isValidTransferConferenceName(name) {
  return /^xfer_[a-f0-9]{16,32}$/.test(String(name || ""));
}

export function isValidMultilineConferenceName(name) {
  return /^ml_[a-f0-9]{16}$/.test(String(name || ""));
}

function isCallSid(sid) {
  return /^CA[a-f0-9]{32}$/.test(String(sid || ""));
}

// The lead's leg of a plain Powerdialler call — the child call that
// the rep's <Dial> created. Only ever one in-progress child for a
// given parent.
export async function findConnectedChildCall(parentCallSid, env = process.env) {
  if (!isCallSid(parentCallSid)) return null;
  const client = restClient(env);
  const calls = await client.calls.list({ parentCallSid, status: "in-progress", limit: 5 });
  return calls[0] || null;
}

// Redirects one live call into a conference. Used on the lead's leg
// — startConferenceOnEnter so they aren't left listening to hold
// music, endConferenceOnExit false so the conference survives them
// (it's the rep's leg that owns the conference until a completed
// transfer hands that over — see handOffConference).
export async function moveCallToConference(callSid, conferenceName, env = process.env) {
  const client = restClient(env);
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.dial().conference(
    { startConferenceOnEnter: true, endConferenceOnExit: false, beep: false },
    conferenceName
  );
  await client.calls(callSid).update({ twiml: twiml.toString() });
}

// Dials the transfer target straight into the conference. Inline
// TwiML (no URL Twilio has to fetch from us). beep=onEnter so the rep
// and lead hear them arrive.
export async function placeTransferLeg({ to, from, conferenceName }, env = process.env) {
  const client = restClient(env);
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.dial().conference(
    { startConferenceOnEnter: false, endConferenceOnExit: false, beep: "onEnter" },
    conferenceName
  );
  const call = await client.calls.create({
    to: toE164(to),
    from,
    twiml: twiml.toString(),
    timeout: TRANSFER_RING_SECONDS,
  });
  return { sid: call.sid, status: call.status };
}

// One of: queued | ringing | in-progress | completed | busy | failed |
// no-answer | canceled. Polled by the browser while a transfer is up.
export async function getCallStatus(callSid, env = process.env) {
  if (!isCallSid(callSid)) throw Object.assign(new Error("Invalid call"), { status: 400 });
  const client = restClient(env);
  const call = await client.calls(callSid).fetch();
  return call.status;
}

// "Complete transfer": the rep is about to hang up and leave the
// lead and the target talking. The rep's leg joined the conference
// as its owner (endConferenceOnExit=true — the same as any Multi Line
// call, so hanging up normally still tears everything down), so
// before they leave, ownership has to move: rep → no longer ends it
// on exit, everyone else → does (so when either the lead or the
// target hangs up afterwards, the other isn't left sitting in an
// empty conference). Refuses unless the target is actually in the
// conference — completing a transfer to someone who hasn't answered
// would just strand the lead.
export async function handOffConference({ conferenceName, repCallSid, targetCallSid }, env = process.env) {
  if (!isCallSid(repCallSid) || !isCallSid(targetCallSid)) {
    throw Object.assign(new Error("Invalid call"), { status: 400 });
  }
  const client = restClient(env);
  const confs = await client.conferences.list({ friendlyName: conferenceName, status: "in-progress", limit: 1 });
  const conf = confs[0];
  if (!conf) throw Object.assign(new Error("The call isn't in a live conference any more."), { status: 409 });
  const participants = await client.conferences(conf.sid).participants.list({ limit: 20 });
  if (!participants.some((p) => p.callSid === targetCallSid)) {
    throw Object.assign(new Error("The person you're transferring to hasn't answered yet."), { status: 409 });
  }
  if (!participants.some((p) => p.callSid === repCallSid)) {
    throw Object.assign(new Error("Your own line isn't in the conference any more."), { status: 409 });
  }
  const others = participants.filter((p) => p.callSid !== repCallSid);
  // Everyone else first, then the rep — if anything fails partway
  // the rep still owns the conference, which is the safe state (their
  // hang-up ends the call for everyone, exactly as before).
  await Promise.all(
    others.map((p) => client.conferences(conf.sid).participants(p.callSid).update({ endConferenceOnExit: true }))
  );
  await client.conferences(conf.sid).participants(repCallSid).update({ endConferenceOnExit: false });
  return { participants: participants.length };
}

// Everything the transfer endpoints share between the local Express
// server and the Vercel functions — request validation, the Twilio
// choreography above, and the response shape. Throws errors carrying
// a `.status` so each thin handler can pass them straight through.
export async function startLiveTransfer(body, env = process.env) {
  const missing = missingTwilioEnv(env);
  if (missing.length) {
    throw Object.assign(new Error(`Twilio is not configured. Missing: ${missing.join(", ")}`), { status: 500 });
  }
  const to = String(body?.to || "").trim();
  if (!toE164(to) || toE164(to).replace(/\D/g, "").length < 6) {
    throw Object.assign(new Error("Enter a phone number to transfer to."), { status: 400 });
  }
  const conferenceName = String(body?.conferenceName || "");
  const moveLead = !!body?.moveLead;
  // A lead only ever gets moved into a fresh transfer conference; a
  // call that's already in one (Multi Line, or a second transfer
  // attempt on the same call) just names the conference it's in.
  const validName =
    isValidTransferConferenceName(conferenceName) || (!moveLead && isValidMultilineConferenceName(conferenceName));
  if (!validName) throw Object.assign(new Error("Invalid conference name."), { status: 400 });
  const pool = getCallerIdPool(env);
  const requestedFrom = body?.callerId;
  const from = requestedFrom && pool.includes(requestedFrom) ? requestedFrom : pool[0];

  let leadCallSid = null;
  if (moveLead) {
    // Powerdialler: the lead is still on a plain <Dial> bridge with
    // the rep's browser leg — move them into the conference first.
    const child = await findConnectedChildCall(body?.callSid, env);
    if (!child) {
      throw Object.assign(new Error("There's no connected lead on this call to transfer."), { status: 409 });
    }
    leadCallSid = child.sid;
    await moveCallToConference(child.sid, conferenceName, env);
  }

  // Everything that can be validated has been, and the lead's leg has
  // been moved by this point — so a failure to place the target's leg
  // (Twilio rejecting the number, say) is reported as a *result*, not
  // thrown: the browser must still know the lead was moved (its own
  // leg is about to drop and needs rejoining) and can offer another
  // number from inside the conference. Every error thrown above
  // means nothing was moved and the call carries on exactly as it was.
  let target = null;
  let targetError = null;
  try {
    target = await placeTransferLeg({ to, from, conferenceName }, env);
  } catch (err) {
    if (!moveLead) throw err;
    console.error("[twilio] transfer target leg failed after moving the lead", err.message);
    targetError = err.message || "Could not ring that number.";
  }
  return {
    conferenceName,
    to: toE164(to),
    from,
    leadCallSid,
    targetCallSid: target ? target.sid : null,
    targetStatus: target ? target.status : "failed",
    targetError,
    ringSeconds: TRANSFER_RING_SECONDS,
  };
}
