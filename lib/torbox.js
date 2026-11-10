'use strict';

const cache = require('./cache');
const config = require('./config');
const shared = require('./debridShared');

const API = 'https://api.torbox.app/v1/api';
const AVAILABILITY_TTL = 30 * 60;
const TORRENT_LIST_TTL = 30;
const LINK_TTL = 2 * 60;

function apiUrl(path) {
  return `${API}${path}`;
}

async function request(token, path, options = {}) {
  return shared.fetchJson(apiUrl(path), {
    ...options,
    headers: { ...shared.bearer(token), ...(options.headers || {}) },
    timeoutMs: options.timeoutMs || config.debridTimeoutMs || 4500,
  });
}

async function validateCredential(token) {
  const data = await request(token, '/user/me?settings=false', { timeoutMs: 6000 });
  const user = shared.assertTorbox(data);
  if (!user || typeof user !== 'object') throw shared.providerError('invalid_credential', 401);
  return { provider: 'torbox' };
}

function findHashEntry(data, hash) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data.find((entry) => entry && String(entry.hash || '').toLowerCase() === hash.toLowerCase()) || null;
  }
  if (typeof data !== 'object') return null;
  return data[hash] || data[hash.toUpperCase()] || data[hash.toLowerCase()] || null;
}

async function checkCached(token, credentialId, hits) {
  if (!hits.length) return new Map();
  const hashes = hits.map((hit) => String(hit.infoHash || '').toLowerCase()).filter(Boolean);
  if (!hashes.length) return new Map();
  const cacheKey = `debrid:availability:${credentialId}:torbox:${hashes.slice().sort().join(',')}`;
  return shared.memo(cacheKey, AVAILABILITY_TTL, async () => {
    const url = new URL(apiUrl('/torrents/checkcached'));
    url.searchParams.set('hash', hashes.join(','));
    url.searchParams.set('format', 'object');
    url.searchParams.set('list_files', 'true');
    const body = shared.assertTorbox(await shared.fetchJson(url.toString(), {
      headers: shared.bearer(token),
      timeoutMs: config.debridTimeoutMs || 4500,
    }));
    const result = new Map();
    for (const hash of hashes) result.set(hash, findHashEntry(body, hash));
    return result;
  });
}

function listOf(responseData) {
  if (Array.isArray(responseData)) return responseData;
  if (responseData && Array.isArray(responseData.torrents)) return responseData.torrents;
  return [];
}

async function torrentList(token, credentialId) {
  return shared.memo(`debrid:list:${credentialId}:torbox`, TORRENT_LIST_TTL, async () => {
    const data = shared.assertTorbox(await request(token, '/torrents/mylist?limit=1000&bypass_cache=true'));
    return listOf(data);
  });
}

function torrentHash(torrent) {
  return String(torrent && (torrent.hash || torrent.info_hash) || '').toLowerCase();
}

function torrentReady(torrent) {
  if (!torrent) return false;
  if (torrent.download_present === false) return false;
  if (torrent.download_finished === true || torrent.cached === true) return true;
  return String(torrent.download_state || '').toLowerCase() === 'cached';
}

async function getTorrentById(token, torrentId) {
  let current = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = shared.assertTorbox(await request(
      token,
      `/torrents/mylist?id=${encodeURIComponent(torrentId)}&bypass_cache=true`
    ));
    current = Array.isArray(data) ? data[0] : data;
    if (current && Array.isArray(current.files) && current.files.length) return current;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return current;
}

async function createCachedTorrent(token, credentialId, hit) {
  const form = new FormData();
  form.set('magnet', shared.buildMagnet(hit));
  // Explicitly disable seeding; the addon must not seed the user's content.
  form.set('seed', 'false');
  form.set('allow_zip', 'false');
  form.set('add_only_if_cached', 'true');
  const data = shared.assertTorbox(await request(token, '/torrents/createtorrent', {
    method: 'POST',
    body: form,
  }));
  const torrentId = data && (data.torrent_id ?? data.id);
  if (torrentId == null) return null;
  cache.del(`debrid:list:${credentialId}:torbox`);
  return torrentId;
}

async function resolveCached(token, credentialId, hit, availabilityEntry, resolved) {
  const hash = String(hit.infoHash || '').toLowerCase();
  if (!availabilityEntry || !hash) return null;
  const cacheKey = `debrid:link:${credentialId}:torbox:${hash}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  return cache.coalesce(cacheKey, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;
    try {
      const list = await torrentList(token, credentialId);
      let torrent = list.find((entry) => torrentHash(entry) === hash && torrentReady(entry));
      let torrentId = torrent && (torrent.id ?? torrent.torrent_id);
      if (torrentId == null) {
        // Defense in depth: even a stale positive cache lookup cannot add a
        // miss because TorBox itself enforces add_only_if_cached=true.
        torrentId = await createCachedTorrent(token, credentialId, hit);
        if (torrentId == null) return null;
      }

      let full = torrent && Array.isArray(torrent.files) && torrent.files.length ? torrent : null;
      if (!full) full = await getTorrentById(token, torrentId);
      if (!full || !Array.isArray(full.files)) return null;
      const file = shared.chooseVideoFile(full.files, resolved);
      if (!file || file.id == null) return null;

      const url = new URL(apiUrl('/torrents/requestdl'));
      // TorBox documents `token` as a required query parameter for requestdl.
      // This request is server-side only; never return or log the permalink.
      url.searchParams.set('token', token);
      url.searchParams.set('torrent_id', String(torrentId));
      url.searchParams.set('file_id', String(file.id));
      const download = shared.assertTorbox(await shared.fetchJson(url.toString(), {
        timeoutMs: config.debridTimeoutMs || 4500,
      }));
      const link = typeof download === 'string' ? download : download && (download.download || download.url);
      const stream = shared.toStream('TorBox', hit, file, link);
      if (stream) cache.set(cacheKey, stream, LINK_TTL);
      return stream;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { validateCredential, checkCached, resolveCached };
