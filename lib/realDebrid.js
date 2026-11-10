'use strict';

/**
 * Real-Debrid is intentionally limited to the user's own, completed torrent
 * library. There is no global-cache claim and this adapter never calls
 * instantAvailability, addMagnet, or selectFiles.
 */

const config = require('./config');
const shared = require('./debridShared');

const API = 'https://api.real-debrid.com/rest/1.0';
const LIBRARY_TTL = 30;
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
  const cacheKey = `debrid:list:${credentialId}:realdebrid`;
  const torrents = await shared.memo(cacheKey, LIBRARY_TTL, async () => {
    const params = new URLSearchParams({ limit: '5000' });
    const data = await request(token, `/torrents?${params.toString()}`);
    return listFrom(data);
  });
  const ready = new Map();
  for (const torrent of torrents) {
    if (!torrent || String(torrent.status || '').toLowerCase() !== 'downloaded') continue;
    const hash = String(torrent.hash || torrent.infoHash || '').toLowerCase();
    if (hash) ready.set(hash, torrent);
  }
  const result = new Map();
  for (const hit of hits) {
    const hash = String(hit.infoHash || '').toLowerCase();
    result.set(hash, ready.get(hash) || null);
  }
  return result;
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
