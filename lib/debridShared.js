'use strict';

const cache = require('./cache');

const VIDEO_EXT = /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|ogv)$/i;
const SAMPLE = /(?:^|[\s._-])sample(?:[\s._-]|$)/i;

function providerError(code = 'provider_error', status) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  return error;
}

/** Fetch JSON with a hard timeout. API keys are sent only in headers or
 * provider-required request bodies; error messages never include URLs/bodies. */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 4500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        throw providerError('provider_invalid_response', response.status || undefined);
      }
    }
    if (!response.ok) throw providerError('provider_http_error', response.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function assertTorbox(data) {
  if (!data || data.success !== true) {
    const code = String(data && data.error || '');
    throw providerError(code === 'BAD_TOKEN' || code === 'NO_AUTH' ? 'invalid_credential' : 'provider_rejected',
      code === 'BAD_TOKEN' || code === 'NO_AUTH' ? 401 : 502);
  }
  return data.data;
}

function assertPremiumize(data) {
  if (!data || data.status !== 'success') {
    const code = String(data && data.code || '');
    throw providerError(code === 'authentication_failed' ? 'invalid_credential' : 'provider_rejected',
      code === 'authentication_failed' ? 401 : 502);
  }
  return data;
}

function assertEasyDebrid(data) {
  if (!data || data.id == null) throw providerError('invalid_credential', 401);
  return data;
}

/** One in-flight fetch and one in-memory result per key. Credential ids are
 * embedded in every private cache key by callers. */
async function memo(key, ttlSeconds, loader) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  return cache.coalesce(key, async () => {
    const again = cache.get(key);
    if (again !== undefined) return again;
    const value = await loader();
    cache.set(key, value, ttlSeconds);
    return value;
  });
}

function mapLimit(items, limit, callback) {
  const output = new Array(items.length);
  let next = 0;
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        output[index] = await callback(items[index], index);
      } catch (_) {
        output[index] = null;
      }
    }
  })).then(() => output);
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

function filePath(file) {
  if (!file || typeof file !== 'object') return '';
  const direct = file.path || file.absolute_path || file.filename || file.name || file.short_name || '';
  const directory = Array.isArray(file.directory) ? file.directory.join('/') : String(file.directory || file.folder || '');
  const name = String(direct || '');
  if (!directory || name.startsWith(`${directory}/`) || name.startsWith('/')) return name;
  return [directory, name].filter(Boolean).join('/');
}

function fileSize(file) {
  return Number(file && (file.bytes ?? file.filesize ?? file.size)) || 0;
}

function isVideo(file) {
  const path = filePath(file);
  if (!VIDEO_EXT.test(path) || SAMPLE.test(path)) return false;
  if (file && file.selected !== undefined && Number(file.selected) === 0) return false;
  return true;
}

function episodeInFile(path, season, episode) {
  const s = Number(season);
  const e = Number(episode);
  if (!(s >= 0 && e >= 0)) return false;

  const explicit = /(?:^|[^\d])S0*(\d{1,2})[ ._-]*E0*(\d{1,3})(?:\s*[-~]\s*E?0*(\d{1,3}))?/ig;
  for (const match of String(path).matchAll(explicit)) {
    const fileSeason = Number(match[1]);
    const first = Number(match[2]);
    const last = match[3] ? Number(match[3]) : first;
    if (fileSeason === s && first <= e && e <= last) return true;
  }

  const xStyle = new RegExp(`(?:^|[^\\d])0*${s}x0*${e}(?!\\d)`, 'i');
  if (xStyle.test(path)) return true;

  const seasonFolder = String(path).match(/\bseason\s*0*(\d{1,2})\b/i);
  if (seasonFolder && Number(seasonFolder[1]) === s) {
    const episodeFile = String(path).match(/\b(?:episode|ep)\s*0*(\d{1,3})\b/i);
    if (episodeFile && Number(episodeFile[1]) === e) return true;
  }
  return false;
}

function chooseVideoFile(files, resolved) {
  const videos = (Array.isArray(files) ? files : []).filter(isVideo);
  if (!videos.length) return null;
  if (resolved && resolved.mediaType === 'series' && resolved.season != null && resolved.episode != null) {
    const matching = videos.filter((file) => episodeInFile(filePath(file), resolved.season, resolved.episode));
    if (matching.length) return matching.sort((a, b) => fileSize(b) - fileSize(a))[0];
    return videos.length === 1 ? videos[0] : null;
  }
  return videos.sort((a, b) => fileSize(b) - fileSize(a))[0];
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function buildMagnet(hit) {
  const params = new URLSearchParams({ xt: `urn:btih:${hit.infoHash}` });
  if (hit.title) params.set('dn', hit.title);
  for (const source of hit.sources || []) {
    if (!String(source).startsWith('tracker:')) continue;
    const tracker = String(source).slice('tracker:'.length);
    if (/^https?:\/\//i.test(tracker) || /^udp:\/\//i.test(tracker)) params.append('tr', tracker);
  }
  return `magnet:?${params.toString()}`;
}

function toStream(providerName, hit, file, url) {
  if (!isHttpsUrl(url)) return null;
  const name = filePath(file).split(/[\\/]/).filter(Boolean).pop() || hit.title || 'Video';
  const size = fileSize(file);
  return {
    name: `⚡ ${providerName}`,
    title: `${name}\n⚡ Directo${size ? `  ·  💾 ${formatSize(size)}` : ''}`,
    url,
    behaviorHints: {
      filename: name,
      notWebReady: false,
      bingeGroup: `catalogos-plus-${String(hit.infoHash || '').slice(0, 8)}`,
    },
  };
}

module.exports = {
  fetchJson,
  bearer,
  assertTorbox,
  assertPremiumize,
  assertEasyDebrid,
  providerError,
  memo,
  mapLimit,
  formatSize,
  filePath,
  fileSize,
  chooseVideoFile,
  episodeInFile,
  isHttpsUrl,
  buildMagnet,
  toStream,
};
