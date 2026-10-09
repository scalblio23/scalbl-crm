import { createHash } from 'node:crypto';
import { scopeTagsForUser, ROLES } from './auth.js';

export function smsError(status, message) {
  return Object.assign(new Error(message), { status });
}

// No inferred country code. Storage is E.164; the provider receives digits only.
export function normalizeNumber(value) {
  if (typeof value !== 'string' || !/^\+?[\d ()-]+$/.test(value)) throw smsError(400, 'Invalid international phone number');
  const digits = value.replace(/[ ()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw smsError(400, 'Use international phone numbers');
  return '+' + digits;
}

export function parseDids(raw = '') {
  if (!raw) return [];
  let entries;
  try { entries = JSON.parse(raw); } catch { throw smsError(503, 'Invalid SMS DID configuration'); }
  if (!Array.isArray(entries)) throw smsError(503, 'Invalid SMS DID configuration');
  const seen = new Set();
  return entries.map(entry => {
    const number = normalizeNumber(entry?.number);
    // A mapping is a single security boundary: ALL its tags are required.
    // Optional clientScope is an explicit stable scope name, not a bypass.
    const tags = entry?.allowedTags;
    if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || !t.trim()) ||
        (entry.clientScope !== undefined && (typeof entry.clientScope !== 'string' || !entry.clientScope.trim())) || seen.has(number)) {
      throw smsError(503, 'Invalid or duplicate SMS DID scope');
    }
    seen.add(number);
    const allowedTags = [...new Set(tags)].sort();
    // Include tags even with a named scope: changing ownership cannot expose old history.
    const scopeKey = createHash('sha256').update(JSON.stringify([entry.clientScope || '', allowedTags])).digest('hex');
    return { number, allowedTags, scopeKey, adminScope: entry.clientScope === 'admin' && !allowedTags.length };
  });
}

// Australian local mobile/landline (04xx xxx xxx, 02 xxxx xxxx) -> +61.
// Only for callers that know the number is Australian (automations);
// normalizeNumber() itself still refuses to infer a country code.
export function auToInternational(value) {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[ ()-]/g, '');
  return /^0[2-478]\d{8}$/.test(digits) ? '+61' + digits.slice(1) : value;
}

// tags === null means unscoped (sees every DID). Otherwise a DID needs
// a non-empty tag set, all of which are in `tags`.
export function didsForTags(tags, dids) {
  if (tags !== null && !Array.isArray(tags)) return [];
  return dids.filter(d => tags === null || (d.allowedTags.length > 0 && d.allowedTags.every(t => tags.includes(t))));
}

export function permittedDids(user, dids) {
  if (!user || !ROLES.includes(user.role)) return [];
  return didsForTags(scopeTagsForUser(user), dids);
}
