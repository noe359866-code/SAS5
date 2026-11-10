'use strict';

const cache = require('./cache');
const config = require('./config');
const shared = require('./debridShared');

const API = 'https://www.premiumize.me/api';
const AVAILABILITY_TTL = 30 * 60;
const LINK_TTL = 2 * 60;

async function request(token, path, options = {}) {
  return shared.fetchJson(`${API}${path}`, {
    ...options,
    headers: { ...shared.bearer(token), ...(options.headers || {}) },
    timeoutMs: options.timeoutMs || config.debridTimeoutMs || 4500,
  });
}

async function validateCredential(token) {
  const data = shared.assertPremiumize(await request(token, '/account/info', { timeoutMs: 6000 }));
  if (!data.customer_id && !data.premium_until) throw shared.providerError('invalid_credential', 401);
  return { provider: 'premiumize' };
}

async function checkCached(token, credentialId, hits) {
  if (!hits.length) return new Map();
  const hashes = hits.map((hit) => String(hit.infoHash || '').toLowerCase()).filter(Boolean);
  const cacheKey = `debrid:availability:${credentialId}:premiumize:${hashes.slice().sort().join(',')}`;
  return shared.memo(cacheKey, AVAILABILITY_TTL, async () => {
    const body = new URLSearchParams();
    for (const hit of hits) body.append('items[]', shared.buildMagnet(hit));
    const data = shared.assertPremiumize(await request(token, '/cache/check', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }));
    const flags = Array.isArray(data.response) ? data.response : [];
    const result = new Map();
    hits.forEach((hit, index) => {
      result.set(String(hit.infoHash || '').toLowerCase(), flags[index] === true ? { cached: true } : null);
    });
    return result;
  });
}

async function resolveCached(token, credentialId, hit, availabilityEntry, resolved) {
  if (!availabilityEntry) return null;
  const hash = String(hit.infoHash || '').toLowerCase();
  const cacheKey = `debrid:link:${credentialId}:premiumize:${hash}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  return cache.coalesce(cacheKey, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;
    try {
      // Only call directdl after a positive /cache/check result. Premiumize
      // documents direct-link generation as potentially consuming fair-use.
      const body = new URLSearchParams({ src: shared.buildMagnet(hit) });
      const data = shared.assertPremiumize(await request(token, '/transfer/directdl', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }));
      let files = Array.isArray(data.content) ? data.content : [];
      if (!files.length && (data.location || data.link)) {
        files = [{ path: data.filename || hit.title, size: data.filesize, link: data.location || data.link }];
      }
      const file = shared.chooseVideoFile(files, resolved);
      if (!file) return null;
      const stream = shared.toStream('Premiumize', hit, file, file.link || file.url || file.location);
      if (stream) cache.set(cacheKey, stream, LINK_TTL);
      return stream;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { validateCredential, checkCached, resolveCached };
