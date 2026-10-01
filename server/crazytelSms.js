import { normalizeNumber, smsError } from './smsPolicy.js';

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
    if (body.status === 'queued' && typeof body.uuid === 'string' && body.uuid.length > 0 && body.uuid.length <= 200) {
      return { status:'queued', providerId:body.uuid, error:null };
    }
    return { status:'unknown', providerId:null, error:'unrecognized_provider_response' };
  } catch {
    return { status:'unknown', providerId:null, error:'transport_or_response_uncertain' };
  }
}
