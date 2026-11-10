'use strict';

const cache = require('./cache');
const config = require('./config');
const shared = require('./debridShared');

const API = 'https://easydebrid.com/api/v1';
const AVAILABILITY_TTL = 30 * 60;
const LINK_TTL = 2 * 60;

async function request(token, path, options = {}) {
  return shared.fetchJson(`${API}${path}`, {
    ...options,
    headers: {
      ...shared.bearer(token),
      ...(options.body && !(options.body instanceof URLSearchParams) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    timeoutMs: options.timeoutMs || config.debridTimeoutMs || 4500,
  });
}

async function validateCredential(token) {
  const account = shared.assertEasyDebrid(await request(token, '/user/details', { timeoutMs: 6000 }));
  return { provider: 'easydebrid', accountId: String(account.id) };
}

function detailResults(data) {
  if (data && Array.isArray(data.result)) return data.result;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

async function checkCached(token, credentialId, hits) {
  if (!hits.length) return new Map();
  const hashes = hits.map((hit) => String(hit.infoHash || '').toLowerCase()).filter(Boolean);
  const cacheKey = `debrid:availability:${credentialId}:easydebrid:${hashes.slice().sort().join(',')}`;
  return shared.memo(cacheKey, AVAILABILITY_TTL, async () => {
    const urls = hits.map(shared.buildMagnet);
    const data = await request(token, '/link/lookupdetails', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    });
    const details = detailResults(data);
    const flags = data && Array.isArray(data.cached) ? data.cached : [];
    const result = new Map();
    hits.forEach((hit, index) => {
      const detail = details[index] || null;
      const isCached = detail ? detail.cached === true : flags[index] === true;
      result.set(String(hit.infoHash || '').toLowerCase(), isCached ? (detail || { cached: true }) : null);
    });
    return result;
  });
}

async function resolveCached(token, credentialId, hit, availabilityEntry, resolved) {
  if (!availabilityEntry) return null;
  const hash = String(hit.infoHash || '').toLowerCase();
  const cacheKey = `debrid:link:${credentialId}:easydebrid:${hash}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  return cache.coalesce(cacheKey, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;
    try {
      const data = await request(token, '/link/generate', {
        method: 'POST',
        body: JSON.stringify({ url: shared.buildMagnet(hit) }),
      });
      const files = data && (Array.isArray(data.files) ? data.files : Array.isArray(data.result) ? data.result : []);
      const file = shared.chooseVideoFile(files, resolved);
      if (!file) return null;
      const url = file.url || file.link || file.download;
      const stream = shared.toStream('EasyDebrid', hit, file, url);
      if (stream) require('./cache').set(cacheKey, stream, LINK_TTL);
      return stream;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { validateCredential, checkCached, resolveCached };
