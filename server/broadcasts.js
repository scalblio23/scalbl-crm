// Broadcast email (the Broadcast tab): one message to many contacts,
// sent through Resend's batch API — up to 100 emails per request, each
// recipient getting their own copy (never a shared To/CC/BCC).
//
// Every broadcast carries an unsubscribe link and the one-click
// List-Unsubscribe headers (Spam Act / Gmail & Yahoo bulk-sender rules);
// unsubscribed addresses are left out of every later broadcast (see
// resolveBroadcastAudience in server/db.js).
//
// Sending is resumable: recipients are rows claimed in batches, so the
// browser's send loop and the every-minute cron can both push a
// broadcast forward without ever emailing anyone twice.
import crypto from "node:crypto";
import {
  claimBroadcastRecipients,
  getBroadcastRow,
  markBroadcastRecipients,
  reapStuckBroadcastRecipients,
  finishBroadcastsIfDone,
} from "./db.js";
import { textToHtml } from "./email.js";

const BATCH_SIZE = 100; // Resend's per-request maximum

// The CRM's public address, for unsubscribe links. Prefers the stable
// production domain over a per-deployment URL.
export function publicLinkBase(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "";
}

// Signed so an unsubscribe link only works for the address it was sent to.
export function unsubscribeToken(email, env = process.env) {
  return crypto
    .createHmac("sha256", String(env.SESSION_SECRET || ""))
    .update(`unsubscribe:${String(email).toLowerCase()}`)
    .digest("base64url");
}

export function verifyUnsubscribeToken(email, token, env = process.env) {
  const a = Buffer.from(unsubscribeToken(email, env));
  const b = Buffer.from(String(token || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubscribeUrl(email, env = process.env) {
  const base = publicLinkBase(env);
  const e = encodeURIComponent(String(email).toLowerCase());
  return `${base}/api/unsubscribe?e=${e}&t=${unsubscribeToken(email, env)}`;
}

// {{name}} / {{first_name}} merge fields.
export function personalize(text, recipient) {
  const name = String(recipient.name || "").trim();
  const first = name.split(/\s+/)[0] || "";
  return String(text || "")
    .replace(/\{\{\s*first_name\s*\}\}/gi, first || "there")
    .replace(/\{\{\s*name\s*\}\}/gi, name || "there");
}

export function buildBroadcastEmail(broadcast, recipient, env = process.env) {
  const body = personalize(broadcast.body, recipient);
  const subject = personalize(broadcast.subject, recipient);
  const unsub = unsubscribeUrl(recipient.email, env);
  const from = broadcast.from_name
    ? `${String(broadcast.from_name).replace(/[<>"\r\n]/g, "")} <${broadcast.from_email}>`
    : broadcast.from_email;
  return {
    from,
    to: [recipient.email],
    subject,
    text: `${body}\n\n—\nDon't want these emails? Unsubscribe: ${unsub}`,
    html:
      `<div>${textToHtml(body)}</div>` +
      `<p style="margin-top:32px;font-size:12px;color:#888">Don't want these emails? ` +
      `<a href="${unsub}" style="color:#888">Unsubscribe</a></p>`,
    headers: {
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    reply_to: env.RESEND_REPLY_TO || undefined,
  };
}

async function postBatch(emails, idempotencyKey, env) {
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(emails),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Resend error (${res.status}): ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  return Array.isArray(json?.data) ? json.data : [];
}

// Sends the next batch (one broadcast, or any broadcast still sending
// when broadcastId is null). Returns how many recipients it handled.
export async function sendNextBroadcastBatch(broadcastId = null, env = process.env) {
  const claimed = await claimBroadcastRecipients(broadcastId, BATCH_SIZE);
  if (!claimed.length) {
    await finishBroadcastsIfDone();
    return 0;
  }
  const byBroadcast = new Map();
  for (const r of claimed) {
    if (!byBroadcast.has(r.broadcast_id)) byBroadcast.set(r.broadcast_id, []);
    byBroadcast.get(r.broadcast_id).push(r);
  }
  for (const [bid, rows] of byBroadcast) {
    const broadcast = await getBroadcastRow(bid);
    try {
      const emails = rows.map((r) => buildBroadcastEmail(broadcast, r, env));
      // Same key for the same recipients, so a retried request can't
      // send this batch twice.
      const key = `broadcast-${bid}-${rows[0].id}-${rows[rows.length - 1].id}`;
      const data = await postBatch(emails, key, env);
      await markBroadcastRecipients(rows.map((r, i) => ({ id: r.id, status: "sent", resendId: data[i]?.id || "" })));
    } catch (err) {
      console.error(`[broadcasts] batch for broadcast ${bid} failed`, err);
      await markBroadcastRecipients(rows.map((r) => ({ id: r.id, status: "failed", error: String(err.message || err).slice(0, 300) })));
    }
  }
  await finishBroadcastsIfDone();
  return claimed.length;
}

// Cron: finishes any broadcast whose browser loop stopped (tab closed).
// Time-boxed so it never runs into the function's own time limit.
export async function processPendingBroadcasts({ budgetMs = 40000 } = {}, env = process.env) {
  if (!env.RESEND_API_KEY) return 0;
  await reapStuckBroadcastRecipients();
  const started = Date.now();
  let total = 0;
  while (Date.now() - started < budgetMs) {
    const n = await sendNextBroadcastBatch(null, env);
    if (!n) break;
    total += n;
    await new Promise((r) => setTimeout(r, 600)); // stay under Resend's rate limit
  }
  return total;
}
