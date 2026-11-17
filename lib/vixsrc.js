'use strict';

// Extractor usado por StreamingCommunity en Streamflix: dos GET, sin WebView ni PoW.
const config = require('./config');
const { fetchJson, fetchText } = require('./http');
const BASE = 'https://vixsrc.to';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: '*/*' };

function apiPath(r) {
  const id = Number(r && r.tmdbId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (r.mediaType === 'movie') return `/api/movie/${id}?lang=en`;
  const s = Number(r.season), e = Number(r.episode);
  if (r.mediaType !== 'series' || !Number.isSafeInteger(s) || s < 1 || !Number.isSafeInteger(e) || e < 1) return null;
  return `/api/tv/${id}/${s}/${e}?lang=en`;
}

function embedUrl(src) {
  if (typeof src !== 'string' || !/^\/embed\/\d+\?/.test(src)) return null;
  try {
    const url = new URL(src, BASE);
    return url.origin === BASE && /^\/embed\/\d+$/.test(url.pathname) ? url.href : null;
  } catch (_) { return null; }
}

// Solo extrae literales, no evalúa JavaScript del proveedor.
function playlistFromHtml(html) {
  const text = String(html || '');
  const video = /window\.video\s*=\s*\{([\s\S]*?)\}/.exec(text);
  const master = /window\.masterPlaylist\s*=\s*\{([\s\S]*?)\}/.exec(text);
  if (!video || !master) return null;
  const prop = (body, name) => new RegExp(`(?:['"]?${name}['"]?)\\s*:\\s*['"]([^'"]+)['"]`).exec(body)?.[1];
  const id = prop(video[1], 'id'), token = prop(master[1], 'token'), expires = prop(master[1], 'expires');
  if (!id || !/^[\w-]+$/.test(id) || !token || !/^[\w-]+$/.test(token) || !/^\d+$/.test(expires)) return null;
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= Date.now() + 30000) return null;
  const url = new URL(`/playlist/${id}`, BASE);
  url.searchParams.set('token', token);
  url.searchParams.set('expires', expires);
  if (/\bb=1\b/.test(master[1])) url.searchParams.set('b', '1');
  if (/window\.canPlayFHD\s*=\s*true/.test(text)) url.searchParams.set('h', '1');
  url.searchParams.set('lang', 'en');
  return { url: url.href, expiresAt: expiry * 1000 };
}

async function searchVixsrc(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.vixsrcEnabled === false) return { skipped: 'desactivado por VIXSRC=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) return { skipped: 'ya buscado por TMDB' };
  const path = apiPath(resolved);
  if (!path) return { skipped: 'sin TMDB o episodio válido' };
  const payload = await fetchJson(BASE + path, { timeoutMs, headers: HEADERS });
  let embed = embedUrl(payload && payload.src);
  if (!embed) return { hits: [], query: `vixsrc tmdb:${resolved.tmdbId}` };
  let html;
  try { html = await fetchText(embed, { timeoutMs, headers: { ...HEADERS, Referer: BASE + '/' } }); }
  catch (err) {
    // Los tokens pueden caducar entre API y embed; limitar a un solo reintento.
    if (err.status !== 410) throw err;
    const retry = await fetchJson(BASE + path, { timeoutMs, headers: HEADERS });
    embed = embedUrl(retry && retry.src);
    if (!embed) return { hits: [], query: `vixsrc tmdb:${resolved.tmdbId}` };
    html = await fetchText(embed, { timeoutMs, headers: { ...HEADERS, Referer: BASE + '/' } });
  }
  const playlist = playlistFromHtml(html);
  return { query: `vixsrc tmdb:${resolved.tmdbId}`, hits: playlist ? [{
    provider: 'vixsrc', title: `${resolved.title || ''} VixSrc`.trim(), url: playlist.url,
    referer: embed, expiresAt: playlist.expiresAt, seeders: 0, peers: 0, size: 0, relevant: true,
  }] : [] };
}
module.exports = { apiPath, embedUrl, playlistFromHtml, searchVixsrc };
