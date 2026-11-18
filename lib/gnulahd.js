'use strict';

const { load } = require('cheerio');
const config = require('./config');
const { providerHttp } = require('./providerHttp');
const { parseManifest } = require('./hlsManifest');
const { isDirectMedia } = require('./directMedia');

const BASE = 'https://ww3.gnulahd.nu';
const KEY = 'gnulahd';
const MAX_TIME = 2500;
const VIDEO_SOURCES = 'video[src],video[data-src],video source[src],video source[data-src]';
const EXCLUDED = 'template,noscript,[download],[id*="trailer" i],[class*="trailer" i],[id*="download" i],[class*="download" i],[id*="descarga" i],[class*="descarga" i]';
const blocked = /^\/(?:wp-admin|wp-json|wp-content|panel|nuevo|item|search|blog|cast|director|studio|network|season|tag|category|proximos-estrenos|genres|generos|label|country|recien-agregado|az-lists|bookmark|contacto|terminos-y-condiciones)(?:\/|$)|^\/(?:lista-az-|ver\/(?:anime|peliculas|series)\/)|-op-\d|\/feed(?:\/|$)/i;
const none = (reason) => ({ hits: [], reason });

function norm(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function localLink(raw, page) {
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw, page);
    return url.origin === BASE && !url.username && !url.password && !url.search && !url.hash && !blocked.test(url.pathname) ? url : null;
  } catch { return null; }
}

function episodeLink($, page, season, episode) {
  const slug = /^\/ver\/([a-z0-9-]+)\/$/.exec(new URL(page).pathname)?.[1];
  if (!slug) return null;
  const matches = new Set();
  for (const el of $('a[href]').toArray()) {
    const url = localLink($(el).attr('href'), page);
    const match = url && /^\/([a-z0-9-]+)-(\d+)x(\d+)\/$/.exec(url.pathname);
    if (match && match[1] === slug && Number(match[2]) === season && Number(match[3]) === episode) matches.add(url.href);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function matchingEpisode($, page, show, titles, season, episode) {
  const label = /^\s*(?:ver\s+)?(.+?)\s+(\d+)[x×](\d+)\b/i.exec($('h1').first().text());
  return Boolean(label && titles.includes(norm(label[1])) && Number(label[2]) === season && Number(label[3]) === episode
    && $('a[href]').toArray().some((el) => localLink($(el).attr('href'), page)?.href === show));
}

function matchingTitle($, titles, year, type) {
  if (!titles.includes(norm($('h1').first().text())) || !$('title').first().text().includes(`(${year})`)) return false;
  const types = new Set();
  for (const node of $('script[type="application/ld+json"]').toArray().slice(0, 8)) {
    const text = $(node).html();
    if (!text || text.length > 64 * 1024) continue;
    try {
      const data = JSON.parse(text);
      for (const entry of [].concat(data?.['@graph'] || data || [])) {
        for (const kind of [].concat(entry?.['@type'] || [])) types.add(kind);
      }
    } catch { /* un metadato ilegible no confirma la identidad */ }
  }
  return types.has(type) && !types.has(type === 'Movie' ? 'TVSeries' : 'Movie');
}

// Solo fichas individuales; como máximo dos títulos y sus variantes con año.
function candidatePages(titles, year) {
  const pages = new Set();
  for (const title of titles) {
    const slug = title.replace(/ /g, '-');
    if (!/^[a-z0-9][a-z0-9-]{0,109}$/.test(slug)) continue;
    for (const variant of [slug, `${slug}-${year}`]) {
      const url = localLink(`/ver/${variant}/`, BASE);
      if (url) pages.add(url.href);
    }
  }
  return pages;
}

function mediaLink(raw, page) {
  const url = localLink(raw, page);
  return url && /^(?:\/[a-z0-9][a-z0-9_.-]*)+\.(?:m3u8|mp4|m4s|ts|aac|vtt)$/i.test(url.pathname) ? url : null;
}

const audioLabels = new Map([['latino', 'Latino'], ['espanol latino', 'Latino'], ['castellano', 'Castellano']]);
const labels = (el) => [el.attr('data-lang'), el.attr('data-language')].filter(Boolean);
function hlsCandidates($, page) {
  const candidates = new Map();
  for (const node of $(VIDEO_SOURCES).toArray()) {
    const el = $(node);
    if (el.closest(EXCLUDED).length) continue;
    const url = mediaLink(el.attr('src') || el.attr('data-src'), page);
    if (!url || !/\.m3u8$/i.test(url.pathname) || !isDirectMedia(url.href)) continue;
    // La etiqueta debe pertenecer al vídeo o a su <source>, no al menú o al SEO.
    const own = labels(el);
    const names = new Set((own.length ? own : labels(el.closest('video'))).map((label) => audioLabels.get(norm(label))));
    const label = names.size === 1 ? [...names][0] : null;
    if (label) candidates.set(url.href, candidates.has(url.href) && candidates.get(url.href) !== label ? null : label);
  }
  return [...candidates].filter(([, label]) => label).slice(0, 2);
}

async function readPublicManifest(url, http) {
  const text = await http.text(url, { headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL' }, maxBytes: 256 * 1024 });
  const manifest = parseManifest(text);
  // No reenviar playlists con claves, variables, redirección por steering ni
  // referencias dependientes de otros orígenes o de firmas en la URL.
  if (!manifest || /(?:^\s*#EXT-X-(?:KEY|SESSION-KEY|DEFINE|CONTENT-STEERING):|\{\$)/m.test(text)) return null;
  for (const line of text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (!line.startsWith('#')) {
      if (!mediaLink(line, url)) return null;
    } else {
      for (const [, quoted, plain] of line.matchAll(/\bURI\s*=\s*(?:"([^"]*)"|([^,\s]*))/g)) {
        if (!mediaLink(quoted ?? plain, url)) return null;
      }
    }
  }
  return manifest;
}

async function searchGnulaHD(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  const series = resolved.mediaType === 'series';
  const { season, episode } = resolved;
  if (series && !(Number.isInteger(season) && season > 0 && Number.isInteger(episode) && episode > 0)) return { skipped: 'episode-required' };
  // Esta primera pasada ya intenta el título original; no duplicar tráfico.
  if (title !== resolved.title) return { skipped: 'alternative-already-checked' };
  const year = String(resolved.year || '');
  const titles = [...new Set([resolved.title, resolved.altTitle].map(norm).filter(Boolean))];
  if (!/^(?:19|20)\d{2}$/.test(year) || !titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(Math.min(timeoutMs, MAX_TIME));
  const get = async (url) => {
    try { return load(await http.text(url, { headers: { Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024 })); }
    catch (err) { if (err.status === 404 || err.status === 410) return null; throw err; }
  };
  for (const show of candidatePages(titles, year)) {
    let $ = await get(show);
    if (!$ || !matchingTitle($, titles, year, series ? 'TVSeries' : 'Movie')) continue;
    let page = show;
    if (series) {
      page = episodeLink($, show, season, episode);
      if (!page) return none('no-episode-link');
      $ = await get(page);
      if (!$ || !matchingEpisode($, page, show, titles, season, episode)) return none('episode-mismatch');
    }
    const candidates = hlsCandidates($, page);
    if (!candidates.length) return none('no-public-media');
    const checks = await Promise.allSettled(candidates.map(async ([url, audioLabel]) => {
      const manifest = await readPublicManifest(url, http);
      if (!manifest) return null;
      if (manifest.variants.length) {
        const first = mediaLink(manifest.variants[0].uri, url);
        if (!first || !/\.m3u8$/i.test(first.pathname) || !(await readPublicManifest(first.href, http))?.segment) return null;
      }
      return { provider: KEY, title: resolved.title, url, audioLabel,
        quality: 'HLS', resolution: manifest.resolution, verification: 'manifest-ok' };
    }));
    const hits = checks.flatMap((check) => check.status === 'fulfilled' && check.value ? [check.value] : []);
    if (!hits.length) {
      const failure = checks.find((check) => check.status === 'rejected');
      if (failure) throw failure.reason;
      return none('unverified-hls');
    }
    return hits;
  }
  return none('no-match');
}

module.exports = { BASE, EXCLUDED, VIDEO_SOURCES, searchGnulaHD, norm, episodeLink, matchingEpisode };
