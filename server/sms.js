// Outbound SMS for the CRM's own features — the contact "SMS" button,
// Broadcast, booking confirmations, patient reminders and Automations —
// all sent through Crazytel (server/crazytelSms.js), from the numbers in
// CRAZYTEL_SMS_DIDS.
import { sendCrazytelSms } from "./crazytelSms.js";
import { SmsStore } from "./smsStore.js";
import { getPool } from "./db.js";
import { parseDids, didsForTags, auToInternational } from "./smsPolicy.js";

export function missingSmsEnv(env = process.env) {
  const missing = [];
  if (!env.CRAZYTEL_API_KEY) missing.push("CRAZYTEL_API_KEY");
  if (!parseDids(env.CRAZYTEL_SMS_DIDS || "").length) missing.push("CRAZYTEL_SMS_DIDS");
  return missing;
}

// Which of our numbers a text goes out from. Same rule as the Crazytel
// inbox: a number mapped to the contact's tag wins; otherwise the first
// admin-scoped number in CRAZYTEL_SMS_DIDS. Deterministic, so a contact
// always sees the same number and their reply lands in the same thread.
export function pickSenderDid({ tag } = {}, env = process.env) {
  const dids = parseDids(env.CRAZYTEL_SMS_DIDS || "");
  const tagMatched = tag ? didsForTags([tag], dids) : [];
  return tagMatched[0] || dids.find((d) => d.adminScope) || null;
}

let sendSeq = 0;
function oneOffKey(to) {
  sendSeq = (sendSeq + 1) % 1e9;
  return `crm-${Date.now().toString(36)}-${sendSeq.toString(36)}-${String(to).replace(/\D/g, "").slice(-6)}`;
}

// Sends one text. Resolves { sid, status: "queued", did } once Crazytel has
// accepted it; throws otherwise. `key` makes a retry of the same message
// safe (Crazytel dedupes on it) — pass a stable one where a send can be
// repeated (reminders, automation steps); a one-off key is made otherwise.
// A rejection carries `permanent: true` (bad number, no credit, auth) so
// callers that retry know not to.
export async function sendSms({ to, body, tag, key } = {}, env = process.env) {
  const missing = missingSmsEnv(env);
  if (missing.length) {
    throw Object.assign(new Error(`SMS is not configured. Missing: ${missing.join(", ")}`), { permanent: true });
  }
  const did = pickSenderDid({ tag }, env);
  if (!did) {
    throw Object.assign(new Error("No Crazytel sender number available (CRAZYTEL_SMS_DIDS)"), { permanent: true });
  }
  const result = await sendCrazytelSms(
    { from: did.number, to: auToInternational(to), text: body, idempotencyKey: key || oneOffKey(to) },
    { apiKey: env.CRAZYTEL_API_KEY }
  );
  if (result.status === "failed") {
    throw Object.assign(new Error(`Crazytel rejected the SMS (${result.error.replace("provider_http_", "HTTP ")})`), {
      permanent: true,
    });
  }
  if (result.status !== "queued") {
    throw new Error(`Crazytel didn't confirm the SMS was sent (${result.error}) — check the Crazytel portal before resending`);
  }
  return { sid: result.providerId, status: "queued", did, result };
}

// Also files a sent text into the contact's Crazytel SMS thread
// (Conversations → Crazytel SMS), where their reply lands. Never turns a
// sent text into a failure.
export async function recordSentSms(sent, to, body) {
  try {
    await new SmsStore(getPool()).recordOutbound(sent.did, to, body, sent.result);
  } catch (err) {
    console.error("[sms] sent SMS could not be added to its Crazytel thread", err?.message || err);
  }
}
