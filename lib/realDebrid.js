'use strict';

/**
 * Real-Debrid is intentionally limited to the user's own, completed torrent
 * library. There is no global-cache claim and this adapter never calls
 * instantAvailability, addMagnet, or selectFiles.
 */

const config = require('./config');
const cache = require('./cache');
const shared = require('./debridShared');

const API = 'https://api.real-debrid.com/rest/1.0';
const LIBRARY_TTL = 30;
// A moderate page size is used by maintained Real-Debrid integrations; keep a
// hard page cap so an account with an unusually large library cannot stall a
// Stremio stream request indefinitely.
const LIBRARY_PAGE_SIZE = 500;
const MAX_LIBRARY_PAGES = 20;
const LIBRARY_SCAN_MAX_MS = 15_000;
const LINK_TTL = 2 * 60;

async function request(token, path, options = {}) {
  return shared.fetchJson(`${API}${path}`, {
    ...options,
    headers: { ...shared.bearer(token), ...(options.headers || {}) },
    timeoutMs: options.timeoutMs || config.debridTimeoutMs || 4500,
  });
}

async function validateAccessToken(token) {
  const account = await request(token, '/user', { timeoutMs: 6000 });
  if (!account || account.id == null) throw shared.providerError('invalid_credential', 401);
  return account;
}

function listFrom(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.torrents)) return data.torrents;
  return [];
}

async function checkCached(token, credentialId, hits) {
  const hashes = [...new Set((Array.isArray(hits) ? hits : [])
    .map((hit) => String(hit && hit.infoHash || '').toLowerCase()).filter(Boolean))];
  if (!hashes.length) return new Map();

  // Cache the answer for this exact batch, not a partially scanned account
  // list: a later request may ask about different hashes from older pages.
  const cacheKey = `debrid:list:${credentialId}:realdebrid:${hashes.slice().sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  return cache.coalesce(cacheKey, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;

    const pending = new Set(hashes);
    const ready = new Map();
    const perRequestTimeout = config.debridTimeoutMs || 4500;
    const deadline = Date.now() + Math.min(LIBRARY_SCAN_MAX_MS, perRequestTimeout * 2);
    let complete = false;
    for (let page = 1; page <= MAX_LIBRARY_PAGES; page++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const params = new URLSearchParams({ page: String(page), limit: String(LIBRARY_PAGE_SIZE) });
      let torrents;
      try {
        torrents = listFrom(await request(token, `/torrents?${params.toString()}`, {
          timeoutMs: Math.min(perRequestTimeout, remainingMs),
        }));
      } catch (_) {
        // Preserve matches from earlier pages, but don't cache incomplete misses.
        break;
      }
      for (const torrent of torrents) {
        if (!torrent || String(torrent.status || '').toLowerCase() !== 'downloaded') continue;
        const hash = String(torrent.hash || torrent.infoHash || '').toLowerCase();
        if (hash && pending.has(hash)) {
          ready.set(hash, torrent);
          pending.delete(hash);
        }
      }

      // All requested hashes are present, or a short page proves the list ended.
      if (!pending.size || torrents.length < LIBRARY_PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    const result = new Map(hashes.map((hash) => [hash, ready.get(hash) || null]));
    // A full final page at the safety cap means the scan may be incomplete.
    // Serve the positive matches found so far, but don't cache possible misses.
    if (complete) cache.set(cacheKey, result, LIBRARY_TTL);
    return result;
  });
}

async function resolveCached(token, credentialId, hit, libraryTorrent, resolved) {
  if (!libraryTorrent || libraryTorrent.id == null) return null;
  const hash = String(hit.infoHash || '').toLowerCase();
  const cacheKey = `debrid:link:${credentialId}:realdebrid:${hash}`;
  const cached = require('./cache').get(cacheKey);
  if (cached !== undefined) return cached;
  return require('./cache').coalesce(cacheKey, async () => {
    const again = require('./cache').get(cacheKey);
    if (again !== undefined) return again;
    try {
      const info = await request(token, `/torrents/info/${encodeURIComponent(libraryTorrent.id)}`);
      if (!info || String(info.status || '').toLowerCase() !== 'downloaded' ||
          !Array.isArray(info.files) || !Array.isArray(info.links)) return null;

      // Real-Debrid's links array corresponds to selected files, not necessarily
      // to the original index in info.files.
      let selectedFiles = info.files.filter((file) => Number(file && file.selected) === 1);
      if (!selectedFiles.length && info.links.length === info.files.length) selectedFiles = info.files;
      const file = shared.chooseVideoFile(selectedFiles, resolved);
      if (!file) return null;
      const selectedIndex = selectedFiles.indexOf(file);
      const link = info.links[selectedIndex];
      if (!link) return null;

      const unrestricted = await request(token, '/unrestrict/link', {
        method: 'POST',
        body: new URLSearchParams({ link }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const stream = shared.toStream('Real-Debrid', hit, file, unrestricted && unrestricted.download);
      if (stream) require('./cache').set(cacheKey, stream, LINK_TTL);
      return stream;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { validateAccessToken, checkCached, resolveCached };
