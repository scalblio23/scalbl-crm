import { normalizeNumber, smsError } from './smsPolicy.js';

// Statuses that mean Crazytel has taken the SMS. Its lifecycle is
// accepted -> sent -> delivered (per a third-party Crazytel client; not
// yet confirmed against a raw response). Only 'queued' used to count, so
// a successful send could come back 'unrecognized_provider_response'.
const ACCEPTED_STATUSES = new Set(['queued', 'accepted', 'sent', 'delivered']);

// Describes a response body WITHOUT its values: keys and types only (one
// level of nesting), plus `status` when it's a short plain word. Never the
// API key, the recipient, or the message text.
export function describeResponseShape(body) {
  const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (typeOf(body) !== 'object') return { bodyType: typeOf(body) };
  const keys = {};
  for (const [k, v] of Object.entries(body).slice(0, 30)) {
    keys[k] = typeOf(v) === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 30).map(([k2, v2]) => [k2, typeOf(v2)])) : typeOf(v);
  }
  const status = typeof body.status === 'string' && /^[A-Za-z_-]{1,32}$/.test(body.status) ? body.status : undefined;
  return { keys, status };
}

export async function sendCrazytelSms({ from, to, text, idempotencyKey }, {
  apiKey = process.env.CRAZYTEL_API_KEY, fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw smsError(503, 'Crazytel SMS is not configured');
  if (typeof text !== 'string' || !text.trim() || text.length > 1600 || !idempotencyKey) throw smsError(400, 'Invalid SMS');
  const payload = { from: normalizeNumber(from).slice(1), to: normalizeNumber(to).slice(1), text };
  try {
    const response = await fetchImpl('https://crazytel.io/api/v2/sms/send', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'x-crazytel-api-key': apiKey, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    // Only definitive validation/auth rejections are safe failures. Never retry here.
    if ([400,401,403,404,422].includes(response.status)) return { status:'failed', providerId:null, error:`provider_http_${response.status}` };
    if (!response.ok) return { status:'unknown', providerId:null, error:`provider_http_${response.status}` };
    const body = await response.json();
    const providerStatus = typeof body?.status === 'string' ? body.status.toLowerCase() : '';
    if (ACCEPTED_STATUSES.has(providerStatus) && typeof body.uuid === 'string' && body.uuid.length > 0 && body.uuid.length <= 200) {
      return { status:'queued', providerId:body.uuid, error:null };
    }
    console.warn('[crazytelSms] unrecognized send response', JSON.stringify({ httpStatus: response.status, ...describeResponseShape(body) }));
    return { status:'unknown', providerId:null, error:'unrecognized_provider_response' };
  } catch {
    return { status:'unknown', providerId:null, error:'transport_or_response_uncertain' };
  }
}
