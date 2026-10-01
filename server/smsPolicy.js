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

export function permittedDids(user, dids) {
  if (!user || !ROLES.includes(user.role)) return [];
  const tags = scopeTagsForUser(user);
  if(tags !== null && !Array.isArray(tags)) return [];
  return dids.filter(d => tags === null || (d.allowedTags.length > 0 && d.allowedTags.every(t => tags.includes(t))));
}
