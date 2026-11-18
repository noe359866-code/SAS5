'use strict';
const { resolutionToken } = require('./resolution');

/** Stream directos en español para Stremio. */

const config = require('./config');
const cache = require('./cache');
const cinemeta = require('./cinemeta');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');
const { searchFanpelis } = require('./fanpelis');
const { searchSpinFlix } = require('./spinflix');
const { searchFuegoCine } = require('./fuegocine');
const { searchFlixLatam } = require('./flixlatam');
const { searchPlayLatin } = require('./playlatin');
const { isDirectMedia } = require('./directMedia');
const { hitMatches } = require('./streamChoices');
const { sources: spanishSources, makeSearcher } = require('./spanishProviders');
const { badgeLine } = require('./badges');

const PROVIDERS = [
  { key: 'fanpelis', name: 'Fanpelis', url: 'https://fanpelis.to', libre: true },
  { key: 'flixlatam', name: 'FlixLatam', url: 'https://flixlatam.com', libre: true },
  { key: 'playlatin', name: 'PlayLatinSRC', url: 'https://playlatinsrc.co', libre: true },
  { key: 'spinflix', name: 'SpinFlix', url: 'https://spinoff.link/pelis/#/', libre: true },
  { key: 'fuegocine', name: 'FuegoCine', url: 'https://fuegocine.com', libre: true },
  ...Object.entries(spanishSources).map(([key, { name, url }]) => ({ key, name, url, libre: true })),
];
const PROVIDER_KEYS = PROVIDERS.map(({ key }) => key);
const PROVIDER_NAMES = Object.fromEntries(PROVIDERS.map(({ key, name }) => [key, name]));
const PROVIDER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
};
const SEARCHERS = { fanpelis: searchFanpelis, playlatin: searchPlayLatin, flixlatam: searchFlixLatam, spinflix: searchSpinFlix, fuegocine: searchFuegoCine,
  ...Object.fromEntries(Object.keys(spanishSources).map((key) => [key, makeSearcher(key)])),
};
const STREAM_TTL_SECONDS = 3600;
const PAUSE_AFTER_TIMEOUTS = 3;
const providerHealth = new Map();
const PAUSED = { paused: true };

function parseStreamId(type, id) {
  let raw = String(id || '');
  try { raw = decodeURIComponent(raw); } catch (_) { /* invalid encoding */ }
  const match = /^(tt\d+|tmdb:(?:movie|tv|series):\d+|tmdb:\d+|tvmaze:\d+)(?::(\d+):(\d+))?$/.exec(raw);
  const season = type === 'series' && match && match[2] ? Number(match[2]) : null;
  const episode = type === 'series' && match && match[3] ? Number(match[3]) : null;
  return { raw, baseId: match ? match[1] : raw, season, episode };
}

function activeProviders(cfg) {
  const configured = config.streamProviders;
  let keys = configured ? PROVIDER_KEYS.filter((key) => configured.includes(key)) : PROVIDER_KEYS;
  // Una lista antigua que solo contiene fuentes retiradas vuelve al defecto.
  // STREAM_PROVIDERS=off y una selección personal vacía sí apagan las fuentes.
  if (configured?.length && !keys.length) keys = PROVIDER_KEYS;
  if (config.fanpelisEnabled === false) keys = keys.filter((key) => key !== 'fanpelis');
  if (config.playlatinEnabled === false) keys = keys.filter((key) => key !== 'playlatin');
  if (cfg && Array.isArray(cfg.streams)) keys = keys.filter((key) => cfg.streams.includes(key));
  return keys;
}

function isPaused(key, now = Date.now()) {
  const state = providerHealth.get(key);
  return Boolean(state && state.pausedUntil > now);
}
function pausedProviders() {
  return PROVIDER_KEYS.filter((key) => isPaused(key));
}
function recordProviderResult(key, error) {
  const cooldown = config.streamProviderCooldownSeconds || 0;
  if (!error || !error.timeout) {
    providerHealth.delete(key);
    return;
  }
  const state = providerHealth.get(key) || { timeouts: 0, pausedUntil: 0 };
  state.timeouts += 1;
  if (cooldown > 0 && state.timeouts >= PAUSE_AFTER_TIMEOUTS) {
    state.pausedUntil = Date.now() + cooldown * 1000;
  }
  providerHealth.set(key, state);
}

async function resolveTitle(type, id) {
  const parsed = parseStreamId(type, id);
  const mediaType = type === 'series' ? 'series' : 'movie';
  let baseId = parsed.baseId;
  if (/^tmdb:\d+$/.test(baseId)) {
    baseId = `tmdb:${mediaType === 'series' ? 'tv' : 'movie'}:${baseId.split(':').pop()}`;
  }
  let title = '';
  let altTitle = null;
  let year = '';
  let imdbId = /^tt\d+$/.test(baseId) ? baseId : null;
  let tmdbId = null;
  let tmdbType = null;

  if (imdbId) {
    const found = await tmdb.findByImdbId(imdbId, config.tmdbLanguage, config.streamProviderTimeoutMs).catch(() => null);
    const item = found && (mediaType === 'movie' ? found.movie || found.tv : found.tv || found.movie);
    if (item) {
      title = item.title || item.name || item.original_title || item.original_name || '';
      altTitle = item.original_title || item.original_name || null;
      year = String(item.release_date || item.first_air_date || '').slice(0, 4);
      tmdbId = Number(item.id) || null;
      tmdbType = item === found.movie ? 'movie' : 'tv';
    }
    if (!title && mediaType === 'series') {
      const show = await tvmaze.showLookupByImdb(imdbId, config.streamProviderTimeoutMs).catch(() => null);
      if (show && show.name) {
        title = show.name;
        year = String(show.premiered || '').slice(0, 4);
      }
    }
    if (!title) {
      const meta = await cinemeta.lookup(mediaType, imdbId, config.streamProviderTimeoutMs);
      if (meta) {
        title = meta.name || '';
        year = String(meta.releaseInfo || meta.year || '').slice(0, 4);
      }
    }
  } else if (/^tmdb:(?:movie|tv|series):\d+$/.test(baseId)) {
    const parts = baseId.split(':');
    tmdbType = parts[1] === 'movie' ? 'movie' : 'tv';
    tmdbId = Number(parts[2]);
    // Las fichas /tv de TMDB, a diferencia de /movie, no incluyen imdb_id por defecto.
    const params = tmdbType === 'tv' ? { append_to_response: 'external_ids' } : {};
    const data = await tmdb.tmdbGet(`/${tmdbType}/${tmdbId}`, params, 24 * 3600, config.tmdbLanguage, config.streamProviderTimeoutMs).catch(() => null);
    if (data) {
      title = data.title || data.name || '';
      altTitle = data.original_title || data.original_name || null;
      year = String(data.release_date || data.first_air_date || '').slice(0, 4);
      const externalId = data.imdb_id || data.external_ids?.imdb_id;
      if (/^tt\d+$/.test(externalId || '')) imdbId = externalId;
    }
  } else if (/^tvmaze:\d+$/.test(baseId)) {
    const show = await tvmaze.showById(baseId.split(':').pop()).catch(() => null);
    if (show) {
      title = show.name || '';
      year = String(show.premiered || '').slice(0, 4);
      imdbId = show.externals && show.externals.imdb || null;
    }
  }
  if (!title) return null;
  if (altTitle === title) altTitle = null;
  return { title, altTitle, year, season: parsed.season, episode: parsed.episode, mediaType, imdbId, tmdbId, tmdbType };
}

function buildQuery(resolved, title = resolved.title) {
  const year = resolved.year ? ` ${resolved.year}` : '';
  if (resolved.mediaType === 'series' && resolved.season && resolved.episode) {
    return `${title} S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}`;
  }
  return `${title}${year}`;
}

async function runProviders(keys, query, resolved, queryTitle, report, timeoutMs = config.streamProviderTimeoutMs, { ignorePause = false } = {}) {
  const settled = await Promise.allSettled(keys.map((key) => (
    !ignorePause && isPaused(key) ? Promise.resolve(PAUSED) : SEARCHERS[key](query, resolved, queryTitle, timeoutMs)
  )));
  const seen = new Set();
  const hits = [];
  settled.forEach((result, index) => {
    const key = keys[index];
    if (result.status !== 'fulfilled') {
      recordProviderResult(key, result.reason);
      if (report) report[key] = { ok: false, error: result.reason && result.reason.message || 'provider error' };
      return;
    }
    if (result.value === PAUSED) {
      if (report) report[key] = { ok: true, paused: true };
      return;
    }
    recordProviderResult(key, null);
    const response = Array.isArray(result.value) ? { hits: result.value } : result.value || {};
    if (response.skipped) {
      if (report) report[key] = { ok: true, skipped: response.skipped };
      return;
    }
    let accepted = 0;
    for (const hit of response.hits || []) {
      if (!hit || !hit.url || !isDirectMedia(hit.url, key)) continue;
      if (hit.relevant === false || !hitMatches(hit, null)) continue;
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      hits.push({ ...hit, provider: hit.provider || key, titles: [resolved.title, resolved.altTitle].filter(Boolean) });
      accepted += 1;
    }
    if (report) report[key] = { ok: true, raw: (response.hits || []).length, relevant: accepted, ...(response.query ? { query: response.query } : {}) };
  });
  return hits;
}

function toDirectStream(hit, cfg) {
  const badges = badgeLine(hit.title, hit.titles, cfg && cfg.badges);
  const audio = `🎧 ${hit.audioLabel || 'Latino'}`;
  return {
    name: `▶ ${resolutionToken(hit.resolution, hit.quality) || hit.quality || (/\.mp4(?:$|[?#])/i.test(hit.url) ? 'MP4' : 'HLS')}`,
    title: [hit.title, badges, audio].filter(Boolean).join('\n'),
    url: hit.url,
    ...(Array.isArray(hit.subtitles) && hit.subtitles.length ? { subtitles: hit.subtitles } : {}),
    behaviorHints: {
      notWebReady: true,
      bingeGroup: `catalogos-plus-${hit.provider || 'direct'}-${hit.quality || 'hls'}`,
      proxyHeaders: { request: { Referer: hit.referer || 'https://vimeos.net/', 'User-Agent': PROVIDER_HEADERS['User-Agent'] } },
    },
  };
}
function toStream(hit, cfg) { return hit && hit.url ? toDirectStream(hit, cfg) : null; }

async function loadPool(cacheKey, keys, resolved) {
  const report = {};
  let hits = await runProviders(keys, buildQuery(resolved), resolved, resolved.title, report);
  if (!hits.length && resolved.altTitle) {
    hits = await runProviders(keys, buildQuery(resolved, resolved.altTitle), resolved, resolved.altTitle, report, config.streamFallbackTimeoutMs);
  }
  const partial = Object.values(report).some((entry) => !entry.ok);
  const loaded = { hits, partial, paused: Object.values(report).some((entry) => entry.paused) };
  if (!partial && hits.length) {
    const ttl = loaded.paused ? Math.min(STREAM_TTL_SECONDS, config.streamProviderCooldownSeconds || 60) : STREAM_TTL_SECONDS;
    cache.set(cacheKey, loaded, ttl, { staleSeconds: config.streamStaleSeconds || 0 });
  }
  return loaded;
}

async function searchStreams(type, id, cfg, status = {}, runtime = {}) {
  const keys = activeProviders(cfg);
  if (!keys.length) return [];
  const resolved = await resolveTitle(type, id);
  if (!resolved) { status.partial = true; return []; }
  const cacheKey = `direct-streams:${keys.join(',')}:${type}:${decodeURIComponent(String(id || ''))}`;
  let loaded = cache.get(cacheKey);
  if (loaded === undefined) {
    const stale = cache.getStale(cacheKey);
    const refresh = cache.coalesce(cacheKey, () => loadPool(cacheKey, keys, resolved));
    if (stale !== undefined) {
      loaded = stale;
      status.stale = true;
      const promise = refresh.catch(() => {});
      if (runtime && typeof runtime.waitUntil === 'function') runtime.waitUntil(promise);
    } else loaded = await refresh;
  }
  if (loaded.partial) status.partial = true;
  if (loaded.paused) status.paused = true;
  return loaded.hits.slice(0, config.streamMaxResults || 30).map((hit) => toDirectStream(hit, cfg));
}

async function diagnose(type, id, cfg) {
  const keys = activeProviders(cfg);
  if (!keys.length) return { ok: false, stage: 'providers', providers: [], totalStreams: 0 };
  const resolved = await resolveTitle(type, id);
  if (!resolved) return { ok: false, stage: 'resolveTitle', type, id: String(id || ''), providers: keys };
  const providers = {};
  const hits = await runProviders(keys, buildQuery(resolved), resolved, resolved.title, providers, undefined, { ignorePause: true });
  return { ok: hits.length > 0, stage: 'search', type, id: String(id || ''), resolved, query: buildQuery(resolved), providers, pausedProviders: pausedProviders(), totalStreams: hits.length };
}

module.exports = {
  PROVIDERS, PROVIDER_KEYS, PROVIDER_NAMES, SEARCHERS,
  activeProviders, pausedProviders, searchStreams, diagnose, resolveTitle,
  parseStreamId, buildQuery, runProviders, toStream, toDirectStream,
};
