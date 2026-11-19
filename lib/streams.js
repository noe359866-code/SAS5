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
const { searchVideoApp } = require('./videoapp');
const { searchPelisPlus } = require('./pelisplus');
const { BASE: GNULAHD_URL, searchGnulaHD } = require('./gnulahd');
const { searchGnulaOne } = require('./sites/gnulaone');
const { searchUltra } = require('./sites/ultra');
const { searchTubeOnline } = require('./sites/tubeonline');
const { searchMirandoGratis } = require('./sites/mirandogratis');
const { searchCuevanas3 } = require('./sites/cuevanas3');
const { isDirectMedia } = require('./directMedia');
const { hitMatches } = require('./streamChoices');
const { badgeLine } = require('./badges');

const PROVIDERS = [
  { key: 'fanpelis', name: 'Fanpelis', url: 'https://fanpelis.to', libre: true },
  { key: 'spinflix', name: 'SpinFlix', url: 'https://spinoff.link/pelis/#/', libre: true },
  { key: 'gnulahd', name: 'GnulaHD (experimental)', url: GNULAHD_URL, libre: true },
  { key: 'videoapp', name: 'VideoApp (experimental)', url: 'https://videoapp.zip', libre: true },
  { key: 'pelisplus', name: 'PelisPlus (experimental)', url: 'https://pelisplushd.la', libre: true },
  // Fuentes con visores extraíbles (Byse/MixDrop/Streamtape/Videohel). Cada
  // una cuesta 1 petición de ficha + 1 por visor soportado; los visores
  // opacos (Streamwish, Voe, hglink…) se cuentan y no se abren.
  { key: 'tubeonline', name: 'TubeOnLine', url: 'https://www.tubeonline.net', libre: true },
  { key: 'mirandogratis', name: 'MirandoGratis', url: 'https://mirandogratis.com', libre: true },
  { key: 'gnulaone', name: 'GnulaOne (experimental)', url: 'https://ver.gnula.one', libre: true },
  { key: 'ultra', name: 'VerPeliculasUltra (experimental)', url: 'https://verpeliculasultra.com', libre: true },
  // API JSON propia (Laravel) con el idioma y la calidad ya resueltos; los
  // visores llegan por un salto intermedio y en las fichas revisadas fueron
  // Vimeos, que ya se resuelve sin abrir el manifiesto.
  { key: 'cuevanas3', name: 'Cuevana 3', url: 'https://cuevanas3.pro', libre: true },
];
const PROVIDER_KEYS = PROVIDERS.map(({ key }) => key);
const PROVIDER_NAMES = Object.fromEntries(PROVIDERS.map(({ key, name }) => [key, name]));
const SEARCHERS = {
  fanpelis: searchFanpelis,
  spinflix: searchSpinFlix,
  gnulahd: searchGnulaHD,
  videoapp: searchVideoApp,
  pelisplus: searchPelisPlus,
  tubeonline: searchTubeOnline,
  mirandogratis: searchMirandoGratis,
  gnulaone: searchGnulaOne,
  ultra: searchUltra,
  cuevanas3: searchCuevanas3,
};
const STREAM_TTL_SECONDS = 300;
const UNVERIFIED_TTL_SECONDS = 30;
const PAUSE_AFTER_FAILURES = 3;
const SIGNATURE_MARGIN_SECONDS = 30;
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
  const blocked = error?.challenge || [429, 521].includes(error?.status);
  const transient = blocked || error?.timeout || error?.status >= 500;
  if (!transient) {
    providerHealth.delete(key);
    return;
  }
  const state = providerHealth.get(key) || { failures: 0, pausedUntil: 0 };
  state.failures += 1;
  if (cooldown > 0 && (blocked || state.failures >= PAUSE_AFTER_FAILURES)) {
    state.pausedUntil = Date.now() + cooldown * 1000;
  }
  providerHealth.set(key, state);
}

function errorReport(error) {
  const status = error?.status;
  const reason = error?.challenge ? 'challenge' : error?.timeout ? 'timeout' : error?.requestLimit ? 'request-budget'
    : status === 401 || status === 403 ? 'access-denied' : status === 429 ? 'rate-limited'
      : status >= 500 ? 'upstream-error' : status >= 300 && status < 400 ? 'redirect'
        : status ? 'http-error' : 'fetch-or-parse-error';
  // No reenviar excepciones de JSON ni URLs firmadas de terceros al diagnóstico.
  return { ok: false, reason, ...(status ? { status } : {}), error: status ? `${reason} (HTTP ${status})` : reason };
}

function secondsBeforeExpiry(hits) {
  const now = Date.now();
  return hits.reduce((seconds, hit) => hit.expiresAt
    ? Math.min(seconds, Math.max(0, Math.floor((hit.expiresAt - now) / 1000) - SIGNATURE_MARGIN_SECONDS)) : seconds, Infinity);
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

/**
 * El addon ya no comprueba el medio: no descarga manifiestos HLS ni MP4 ni
 * sondea segmentos. Una URL que respeta el filtro local (`isDirectMedia`)
 * se publica tal cual, y el cliente decide si reproduce.
 *
 * Consecuencia práctica: una fuente rota se descubre al abrir el enlace, no
 * al pedir la lista. A cambio, cada búsqueda gasta menos peticiones (menos
 * cuota de Worker y menos latencia) y el addon no toca el CDN del proveedor.
 */

async function runProviders(keys, query, resolved, queryTitle, report, timeoutMs = config.streamProviderTimeoutMs, options = {}) {
  const { ignorePause = false } = options;
  const settled = await Promise.allSettled(keys.map((key) => (
    !ignorePause && isPaused(key) ? Promise.resolve(PAUSED)
      : Promise.resolve().then(() => SEARCHERS[key](query, resolved, queryTitle, timeoutMs))
  )));
  const preferred = new Map();
  const titles = [resolved.title, resolved.altTitle].filter(Boolean);
  settled.forEach((result, index) => {
    const key = keys[index];
    if (result.status !== 'fulfilled') {
      recordProviderResult(key, result.reason);
      if (report) report[key] = errorReport(result.reason);
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
    const accepted = new Set();
    for (const hit of response.hits || []) {
      if (!hit || !hit.url || !isDirectMedia(hit.url)) continue;
      if (hit.relevant === false || !hitMatches(hit, null) || !secondsBeforeExpiry([hit])) continue;
      accepted.add(hit.url);
      // La primera fuente que entrega una URL se queda con ella: ya no hay
      // «mejor comprobada» que desempate.
      if (!preferred.has(hit.url)) preferred.set(hit.url, { hit, key });
    }
    if (report) report[key] = {
      ok: true, raw: (response.hits || []).length, accepted: accepted.size, relevant: 0,
      ...(response.reason ? { reason: response.reason } : {}), ...(response.query ? { query: response.query } : {}),
    };
  });
  return [...preferred.values()].map(({ hit, key }) => {
    if (report) report[key].relevant += 1;
    return { ...hit, provider: hit.provider || key, titles };
  });
}

// Palabras que los proveedores pegan al título en su nombre sintético
// («Interestelar 2014 1080p WEB-DL Latino Fanpelis»). Se recortan para que la
// fila de Stremio muestre solo la obra.
const NAME_NOISE = /\s+(?:S\d{1,2}\s*E\d{1,2}|(?:19|20)\d{2}|\d{3,4}[pi]|WEB[- ]?DL|WEBRip|BluRay|BDRip|BRRip|HDRip|HDTV|REMUX|CAM|TS|HLS|MP4|Latino|Lat|Castellano|Subtitulado|Sub|Dual|Fanpelis|SpinFlix|GnulaHD|PelisPlus|VideoApp|TubeOnLine|MirandoGratis|Gnula(?:One)?|Ultra|Gnula)\b[\s\S]*$/i;

/**
 * Nombre visible del stream: el título de la obra, no la calidad.
 *
 * Stremio muestra `name` como encabezado de la fuente. Antes decía «▶ 1080p»
 * y el título quedaba escondido en la descripción; ahora la fila dice
 * «Interestelar» y la calidad deja de ser lo único que se ve.
 */
function streamName(hit) {
  const titles = (Array.isArray(hit.titles) ? hit.titles : [])
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  // `titles[0]` es el título resuelto de la obra: se publica tal cual. No se
  // recorta nada aquí, porque un año puede ser parte del título
  // («Wonder Woman 1984», «1917»).
  if (titles[0]) return titles[0].replace(/\s+/g, ' ');
  // Solo el nombre sintético del proveedor («El Origen 2010 720p Castellano»)
  // se recorta hasta la obra.
  const synthetic = String(hit.title || '').replace(/\s+/g, ' ').trim();
  if (!synthetic) return 'Stream';
  return synthetic.replace(NAME_NOISE, '').trim() || synthetic;
}

function toDirectStream(hit, cfg) {
  const badges = badgeLine(hit.title, hit.titles, cfg && cfg.badges);
  const audio = hit.audioLabel || '';
  const format = resolutionToken(hit.resolution, hit.quality) || hit.quality || (/\.mp4(?:$|[?#])/i.test(hit.url) ? 'MP4' : 'HLS');
  const provider = PROVIDER_NAMES[hit.provider] || '';
  // En series el nombre es el de la serie, así que el capítulo tiene que verse
  // en la descripción: «T1E2».
  const episode = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(String(hit.title || ''));
  const ep = episode ? `T${Number(episode[1])}E${Number(episode[2])}` : '';
  // Descripción: capítulo, quién sirve el enlace y en qué audio; debajo, los
  // distintivos de calidad (o el formato si el usuario apagó los distintivos).
  const headline = [ep, provider, audio ? `🎧 ${audio}` : ''].filter(Boolean).join(' · ');
  return {
    name: streamName(hit),
    title: [headline || 'Stream directo', badges || format].filter(Boolean).join('\n'),
    url: hit.url,
    ...(Array.isArray(hit.subtitles) && hit.subtitles.length ? { subtitles: hit.subtitles } : {}),
    behaviorHints: {
      notWebReady: true,
      bingeGroup: `catalogos-plus-${hit.provider || 'direct'}-${hit.quality || 'hls'}`,
    },
  };
}
function toStream(hit, cfg) { return hit && hit.url ? toDirectStream(hit, cfg) : null; }

async function collectProviders(keys, resolved, options) {
  const report = {};
  let hits = await runProviders(keys, buildQuery(resolved), resolved, resolved.title, report, undefined, options);
  if (!hits.length && resolved.altTitle) {
    const retry = keys.filter((key) => report[key]?.ok && !report[key].paused && !report[key].skipped);
    const alternative = {};
    hits = await runProviders(retry, buildQuery(resolved, resolved.altTitle), resolved, resolved.altTitle,
      alternative, config.streamFallbackTimeoutMs, options);
    for (const [key, detail] of Object.entries(alternative)) if (!detail.skipped) report[key] = detail;
  }
  return { hits, report };
}

async function loadPool(cacheKey, keys, resolved) {
  const { hits, report } = await collectProviders(keys, resolved);
  const partial = Object.values(report).some((entry) => !entry.ok);
  const loaded = { hits, partial, paused: Object.values(report).some((entry) => entry.paused) };
  if (hits.length) {
    // Las fuentes con error se reintentan pronto, pero no fuerzan a repetir
    // todo el fan-out en cada petición de un título que sí dio resultados.
    const remaining = secondsBeforeExpiry(hits);
    const ttl = Math.min(STREAM_TTL_SECONDS, partial ? UNVERIFIED_TTL_SECONDS : Infinity,
      loaded.paused ? config.streamProviderCooldownSeconds || 60 : Infinity, remaining);
    const staleSeconds = partial || loaded.paused ? 0 : Math.min(config.streamStaleSeconds || 0, remaining - ttl);
    if (ttl > 0) cache.set(cacheKey, loaded, ttl, { staleSeconds });
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
  // Sin sondeos no hay orden que dar por «comprobado»: se respeta el orden de
  // las fuentes y los enlaces con vencimiento conocido se retiran antes de
  // tiempo (secondsBeforeExpiry) para que el cliente no reciba una firma seca.
  const available = loaded.hits.filter((hit) => secondsBeforeExpiry([hit]) > 0)
    .slice(0, config.streamMaxResults || 30);
  status.maxAge = secondsBeforeExpiry(available);
  return available.map((hit) => toDirectStream(hit, cfg));
}

async function diagnose(type, id, cfg) {
  const keys = activeProviders(cfg);
  if (!keys.length) return { ok: false, stage: 'providers', providers: [], totalStreams: 0 };
  const resolved = await resolveTitle(type, id);
  if (!resolved) return { ok: false, stage: 'resolveTitle', type, id: String(id || ''), providers: keys };
  const { hits, report: providers } = await collectProviders(keys, resolved, { ignorePause: true });
  return { ok: hits.length > 0, stage: 'search', type, id: String(id || ''), resolved, query: buildQuery(resolved), providers,
    pausedProviders: pausedProviders(), totalStreams: hits.length, mediaProbed: false };
}

module.exports = {
  PROVIDERS, PROVIDER_KEYS, PROVIDER_NAMES, SEARCHERS,
  activeProviders, pausedProviders, searchStreams, diagnose, resolveTitle,
  parseStreamId, buildQuery, runProviders, toStream, toDirectStream,
};
