'use strict';

/**
 * Proveedores de salto de segmentos (intro, resumen, créditos, avance) para /watch.
 *
 * Integra en paralelo con caché en memoria y presupuestos estrictos:
 *   1. TheIntroDB v4  (https://api.theintrodb.org/v4/media)
 *   2. SkipDB         (https://api.skipdb.tv/api/segments)
 *   3. Anime Skip     (https://api.anime-skip.com/graphql, con puente ARM v2 IMDb/TMDB -> AniList)
 *   4. AniSkip v2     (https://api.aniskip.com/v2/skip-times, respaldo MAL para anime)
 *
 * Nunca lanza excepciones hacia la ruta HTTP: ante cualquier fallo de red o
 * tiempo agotado de un proveedor, continúa con los restantes y devuelve la
 * combinación disponible.
 */

const cache = require('./cache');
const config = require('./config');
const tmdb = require('./tmdb');

const THEINTRODB_BASE = 'https://api.theintrodb.org/v4/media';
const SKIPDB_BASE = 'https://api.skipdb.tv/api/segments';
const ANIME_SKIP_GRAPHQL = 'https://api.anime-skip.com/graphql';
const ANISKIP_BASE = 'https://api.aniskip.com/v2/skip-times';
const ARM_BASE = 'https://arm.haglund.dev/api/v2';

const USER_AGENT = 'RamdonLatam/1.10 (+https://github.com/noe359866-code/SAS5)';

const TTL_SEGMENTS_OK = 24 * 3600;       // 24 h para hallazgos positivos
const TTL_SEGMENTS_EMPTY = 10 * 60;      // 10 min para resultados vacíos
const TTL_ARM_OK = 7 * 24 * 3600;        // 7 días para mapeos IMDb/TMDB -> AniList/MAL
const TTL_ARM_EMPTY = 3600;              // 1 h si el título no existe en ARM
const TTL_ANIME_SKIP_SHOW = 12 * 3600;   // 12 h por serie en Anime Skip

const MAX_SEGMENT_SEC = 600;             // descarta segmentos sospechosos > 10 min
const MIN_SEGMENT_SEC = 2;               // descarta micro-segmentos < 2 s

const SEGMENT_LABELS = Object.freeze({
  intro: 'Omitir intro',
  recap: 'Omitir resumen',
  credits: 'Omitir créditos',
  preview: 'Omitir avance',
});

const SOURCE_LABELS = Object.freeze({
  theintrodb: 'TheIntroDB',
  skipdb: 'SkipDB',
  animeskip: 'Anime Skip',
  aniskip: 'AniSkip',
});

// IDs oficiales de tipo de marca en anime-skip/public-api (timestamp_type_ids.go).
const ANIME_SKIP_TYPE_ID_MAP = Object.freeze({
  '14550023-2589-46f0-bfb4-152976506b4c': 'intro',    // Intro
  '679fb610-ff3c-4cf4-83c0-75bcc7fe8778': 'intro',    // New Intro
  'cbb42238-d285-4c88-9e91-feab4bb8ae0a': 'intro',    // Mixed Intro
  'f38ac196-0d49-40a9-8fcf-f3ef2f40f127': 'recap',    // Recap
  '2a730a51-a601-439b-bc1f-7b94a640ffb9': 'credits',  // Credits
  'd839cdb1-21b3-455d-9c21-7ffeb37adbec': 'credits',  // New Credits
  '6c4ade53-4fee-447f-89e4-3bb29184e87a': 'credits',  // Mixed Credits
  'c7b1eddb-defa-4bc6-a598-f143081cfe4b': 'preview',  // Preview
});

const ANIME_SKIP_SHOW_QUERY = `
query FindShowsByExternalId($service: ExternalService!, $serviceId: String!) {
  findShowsByExternalId(service: $service, serviceId: $serviceId) {
    id
    name
    deletedAt
  }
}`.trim();

const ANIME_SKIP_EPISODES_QUERY = `
query FindEpisodesByShowId($showId: ID!) {
  findEpisodesByShowId(showId: $showId) {
    id
    season
    number
    absoluteNumber
    baseDuration
    deletedAt
    timestamps {
      at
      typeId
      type {
        name
      }
    }
  }
}`.trim();

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toPositiveInt(v) {
  const n = parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toDurationSec(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Si viene en milisegundos por error (> 12 horas), convertir a segundos.
  const sec = n > 43200 ? n / 1000 : n;
  return sec >= 30 && sec <= 43200 ? Math.round(sec) : null;
}

/**
 * Normaliza parámetros heterogéneos desde /watch o Stremio IDs.
 * Soporta:
 *   - tt0903747
 *   - tt0903747:1:2
 *   - tmdb:movie:27205 / tmdb:tv:1396 / tmdb:tv:1396:1:2
 *   - anilist:16498 / mal:16498
 */
function parseSkipQuery(input = {}) {
  const rawId = String(input.id || '').trim();
  const rawType = String(input.type || '').trim().toLowerCase();
  let type = rawType === 'series' || rawType === 'tv' ? 'series' : 'movie';

  let imdbId = /^tt\d{4,}$/i.test(String(input.imdbId || input.imdb_id || '').trim())
    ? String(input.imdbId || input.imdb_id).trim().toLowerCase()
    : '';
  let tmdbId = toPositiveInt(input.tmdbId || input.tmdb_id);
  let anilistId = toPositiveInt(input.anilistId || input.anilist_id);
  let malId = toPositiveInt(input.malId || input.mal_id);
  let season = toPositiveInt(input.season);
  let episode = toPositiveInt(input.episode);

  if (rawId) {
    const imdbEp = rawId.match(/^(tt\d{4,})(?::(\d+):(\d+))?$/i);
    if (imdbEp) {
      imdbId = imdbId || imdbEp[1].toLowerCase();
      if (imdbEp[2] && !season) season = toPositiveInt(imdbEp[2]);
      if (imdbEp[3] && !episode) episode = toPositiveInt(imdbEp[3]);
      if (imdbEp[2] && imdbEp[3]) type = 'series';
    } else {
      const tmdbMatch = rawId.match(/^tmdb:(movie|tv|series):(\d+)(?::(\d+):(\d+))?$/i);
      if (tmdbMatch) {
        if (tmdbMatch[1].toLowerCase() !== 'movie') type = 'series';
        tmdbId = tmdbId || toPositiveInt(tmdbMatch[2]);
        if (tmdbMatch[3] && !season) season = toPositiveInt(tmdbMatch[3]);
        if (tmdbMatch[4] && !episode) episode = toPositiveInt(tmdbMatch[4]);
      } else {
        const anilistMatch = rawId.match(/^anilist:(\d+)(?::(\d+))?$/i);
        if (anilistMatch) {
          anilistId = anilistId || toPositiveInt(anilistMatch[1]);
          if (anilistMatch[2] && !episode) episode = toPositiveInt(anilistMatch[2]);
        } else {
          const malMatch = rawId.match(/^mal:(\d+)(?::(\d+))?$/i);
          if (malMatch) {
            malId = malId || toPositiveInt(malMatch[1]);
            if (malMatch[2] && !episode) episode = toPositiveInt(malMatch[2]);
          }
        }
      }
    }
  }

  if (type === 'series' && season && episode == null) {
    season = null;
  }

  const duration = toDurationSec(input.duration);
  const animeFlag = input.anime === true
    || String(input.anime || '').trim().toLowerCase() === '1'
    || String(input.anime || '').trim().toLowerCase() === 'true'
    || Boolean(anilistId || malId);

  return {
    type,
    imdbId,
    tmdbId,
    anilistId,
    malId,
    season: type === 'series' ? (season || (episode ? 1 : null)) : null,
    episode: type === 'series' ? episode : null,
    duration,
    anime: animeFlag,
  };
}

function makeSegment(kind, startSec, endSec, source) {
  if (!SEGMENT_LABELS[kind]) return null;
  const start = Number(startSec);
  if (!Number.isFinite(start) || start < 0) return null;

  let end = endSec == null ? null : Number(endSec);
  if (end != null) {
    if (!Number.isFinite(end)) return null;
    const length = end - start;
    if (length < MIN_SEGMENT_SEC || length > MAX_SEGMENT_SEC) return null;
    end = round2(end);
  } else if (kind !== 'credits') {
    // Solo los créditos finales pueden quedar abiertos hasta el fin del vídeo.
    return null;
  }

  return {
    kind,
    startSec: round2(start),
    endSec: end,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    label: SEGMENT_LABELS[kind],
  };
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || config.skipTimeoutMs || 4000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
      },
      body: options.body,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
 * 1. TheIntroDB v4 — https://api.theintrodb.org/v4/media
 * ========================================================================== */

function parseTheIntroDbPayload(data) {
  if (!data || typeof data !== 'object') return [];
  // Protege contra respuestas de índice/fallback sin segmentos concretos.
  const hasDirectArrays = Array.isArray(data.intro)
    || Array.isArray(data.recap)
    || Array.isArray(data.credits)
    || Array.isArray(data.preview);
  if (!hasDirectArrays) return [];

  const out = [];
  for (const kind of ['intro', 'recap', 'credits', 'preview']) {
    const list = Array.isArray(data[kind]) ? data[kind] : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const startSec = item.start_ms == null ? 0 : Number(item.start_ms) / 1000;
      const endSec = item.end_ms == null ? null : Number(item.end_ms) / 1000;
      const seg = makeSegment(kind, startSec, endSec, 'theintrodb');
      if (seg) out.push(seg);
    }
  }
  return out;
}

async function fetchTheIntroDb(query, fetchFn = fetchJson) {
  if (!query.imdbId && !query.tmdbId) return [];
  if (query.type === 'series' && (!query.season || !query.episode)) return [];

  const params = new URLSearchParams();
  if (query.imdbId) params.set('imdb_id', query.imdbId);
  else params.set('tmdb_id', String(query.tmdbId));
  if (query.type === 'series') {
    params.set('season', String(query.season));
    params.set('episode', String(query.episode));
  }
  if (query.duration) {
    params.set('duration_ms', String(Math.round(query.duration * 1000)));
  }

  const data = await fetchFn(`${THEINTRODB_BASE}?${params.toString()}`);
  return parseTheIntroDbPayload(data);
}

/* ==========================================================================
 * 2. SkipDB — https://api.skipdb.tv/api/segments
 * ========================================================================== */

function parseSkipDbPayload(data) {
  if (!data || typeof data !== 'object') return [];
  const segs = data.segments;
  if (!segs || typeof segs !== 'object') return [];

  const map = [
    ['intro', 'intro'],
    ['recap', 'recap'],
    ['outro', 'credits'],
    ['credits', 'credits'],
    ['preview', 'preview'],
  ];
  const out = [];
  const seenKinds = new Set();
  for (const [field, kind] of map) {
    if (seenKinds.has(kind)) continue;
    const raw = segs[field];
    if (!raw || typeof raw !== 'object') continue;
    const startSec = raw.start_ms == null ? null : Number(raw.start_ms) / 1000;
    const endSec = raw.end_ms == null ? null : Number(raw.end_ms) / 1000;
    const seg = makeSegment(kind, startSec, endSec, 'skipdb');
    if (seg) {
      out.push(seg);
      seenKinds.add(kind);
    }
  }
  return out;
}

async function fetchSkipDb(query, fetchFn = fetchJson) {
  if (!query.imdbId) return [];
  if (query.type === 'series' && (!query.season || !query.episode)) return [];

  const params = new URLSearchParams();
  params.set('imdb_id', query.imdbId);
  if (query.type === 'series') {
    params.set('season', String(query.season));
    params.set('episode', String(query.episode));
  }
  if (query.duration) {
    params.set('duration', String(Math.round(query.duration)));
  }

  const data = await fetchFn(`${SKIPDB_BASE}?${params.toString()}`);
  return parseSkipDbPayload(data);
}

/* ==========================================================================
 * 3. Puente ARM v2 (IMDb / TMDB -> AniList & MyAnimeList)
 * ========================================================================== */

function pickArmSeasonEntry(entries, season) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const valid = entries.filter((e) => e && (e.anilist || e.myanimelist));
  if (valid.length === 0) return null;

  if (season) {
    const bySeason = valid.find((e) => (
      Number(e['themoviedb-season']) === season
      || Number(e['thetvdb-season']) === season
      || Number(e.season) === season
    ));
    if (bySeason) return bySeason;
    if (season <= valid.length) return valid[season - 1];
  }
  return valid[0];
}

async function resolveAnimeIds(query, fetchFn = fetchJson) {
  if (query.anilistId || query.malId) {
    return {
      anilistId: query.anilistId || null,
      malId: query.malId || null,
      matchedArm: true,
    };
  }
  if (!query.imdbId && !query.tmdbId) {
    return { anilistId: null, malId: null, matchedArm: false };
  }

  const sourceKey = query.imdbId ? `imdb:${query.imdbId}` : `tmdb:${query.tmdbId}`;
  const cacheKey = `skip:arm:${sourceKey}`;
  const cached = cache.get(cacheKey);
  let entries;
  if (cached !== undefined) {
    entries = cached;
  } else {
    const endpoint = query.imdbId
      ? `${ARM_BASE}/imdb?id=${encodeURIComponent(query.imdbId)}&include=anilist,myanimelist`
      : `${ARM_BASE}/themoviedb?id=${encodeURIComponent(String(query.tmdbId))}&include=anilist,myanimelist`;
    const raw = await fetchFn(endpoint);
    entries = Array.isArray(raw) ? raw : [];
    cache.set(cacheKey, entries, entries.length > 0 ? TTL_ARM_OK : TTL_ARM_EMPTY);
  }

  const picked = pickArmSeasonEntry(entries, query.season);
  if (!picked) return { anilistId: null, malId: null, matchedArm: false };
  return {
    anilistId: toPositiveInt(picked.anilist),
    malId: toPositiveInt(picked.myanimelist),
    matchedArm: true,
  };
}

/* ==========================================================================
 * 4. Anime Skip GraphQL — https://api.anime-skip.com/graphql
 * ========================================================================== */

function mapAnimeSkipType(ts) {
  if (!ts || typeof ts !== 'object') return null;
  if (ts.typeId && ANIME_SKIP_TYPE_ID_MAP[ts.typeId]) {
    return ANIME_SKIP_TYPE_ID_MAP[ts.typeId];
  }
  const name = String(ts.type && ts.type.name || '').trim().toLowerCase();
  if (!name) return null;
  if (name === 'intro' || name === 'new intro' || name === 'mixed intro') return 'intro';
  if (name === 'recap') return 'recap';
  if (name === 'credits' || name === 'new credits' || name === 'mixed credits' || name === 'outro') return 'credits';
  if (name === 'preview') return 'preview';
  return null;
}

function selectAnimeSkipEpisode(episodes, season, episode) {
  if (!Array.isArray(episodes) || episodes.length === 0) return null;
  const active = episodes.filter((ep) => ep && !ep.deletedAt && Array.isArray(ep.timestamps) && ep.timestamps.length > 0);
  if (active.length === 0) return null;

  const epStr = String(episode);
  const seasonStr = season ? String(season) : '';

  // 1. Coincidencia exacta de temporada y episodio.
  if (seasonStr) {
    const exact = active.find((ep) => String(ep.season || '').trim() === seasonStr && String(ep.number || '').trim() === epStr);
    if (exact) return exact;
  }
  // 2. Coincidencia por número de episodio dentro de la entrada AniList de esa temporada.
  const byNum = active.find((ep) => String(ep.number || '').trim() === epStr);
  if (byNum) return byNum;

  // 3. Coincidencia por número absoluto (series largas como One Piece / Naruto).
  const byAbs = active.find((ep) => String(ep.absoluteNumber || '').trim() === epStr);
  if (byAbs) return byAbs;

  return null;
}

function parseAnimeSkipTimestamps(episodeObj, fallbackDurationSec) {
  if (!episodeObj || !Array.isArray(episodeObj.timestamps) || episodeObj.timestamps.length === 0) {
    return [];
  }
  const sorted = episodeObj.timestamps
    .filter((ts) => ts && Number.isFinite(Number(ts.at)) && Number(ts.at) >= 0)
    .slice()
    .sort((a, b) => Number(a.at) - Number(b.at));

  const effectiveDuration = Number(episodeObj.baseDuration) > 0
    ? Number(episodeObj.baseDuration)
    : (Number(fallbackDurationSec) > 0 ? Number(fallbackDurationSec) : null);

  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i];
    const kind = mapAnimeSkipType(curr);
    if (!kind) continue;

    const startSec = Number(curr.at);
    const next = sorted[i + 1];
    let endSec = next ? Number(next.at) : null;

    if (endSec == null) {
      // Última marca: solo se permite si es de créditos en la segunda mitad del episodio.
      if (kind !== 'credits') continue;
      const minCreditsStart = effectiveDuration ? effectiveDuration * 0.45 : 600;
      if (startSec < minCreditsStart) continue;
      if (effectiveDuration && effectiveDuration > startSec + MIN_SEGMENT_SEC) {
        const tailLen = effectiveDuration - startSec;
        endSec = tailLen <= MAX_SEGMENT_SEC ? effectiveDuration : null;
      }
    }

    const seg = makeSegment(kind, startSec, endSec, 'animeskip');
    if (seg) out.push(seg);
  }
  return out;
}

async function fetchAnimeSkip(anilistId, season, episode, duration, fetchFn = fetchJson) {
  if (!anilistId || !episode) return [];
  const clientId = String(config.animeSkipClientId || '').trim();
  if (!clientId) return [];

  const showCacheKey = `skip:animeskip:anilist:${anilistId}`;
  let episodes = cache.get(showCacheKey);

  if (episodes === undefined) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Client-ID': clientId,
    };
    const showRes = await fetchFn(ANIME_SKIP_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: ANIME_SKIP_SHOW_QUERY,
        variables: { service: 'ANILIST', serviceId: String(anilistId) },
      }),
    });
    const shows = showRes && showRes.data && Array.isArray(showRes.data.findShowsByExternalId)
      ? showRes.data.findShowsByExternalId.filter((s) => s && !s.deletedAt && s.id)
      : [];

    if (shows.length === 0) {
      cache.set(showCacheKey, [], TTL_SEGMENTS_EMPTY);
      return [];
    }

    const epRes = await fetchFn(ANIME_SKIP_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: ANIME_SKIP_EPISODES_QUERY,
        variables: { showId: String(shows[0].id) },
      }),
    });
    episodes = epRes && epRes.data && Array.isArray(epRes.data.findEpisodesByShowId)
      ? epRes.data.findEpisodesByShowId
      : [];
    cache.set(showCacheKey, episodes, episodes.length > 0 ? TTL_ANIME_SKIP_SHOW : TTL_SEGMENTS_EMPTY);
  }

  const epObj = selectAnimeSkipEpisode(episodes, season, episode);
  return parseAnimeSkipTimestamps(epObj, duration);
}

/* ==========================================================================
 * 5. AniSkip v2 — https://api.aniskip.com/v2/skip-times
 * ========================================================================== */

function parseAniSkipPayload(data) {
  if (!data || !data.found || !Array.isArray(data.results)) return [];
  const typeMap = {
    op: 'intro',
    'mixed-op': 'intro',
    ed: 'credits',
    'mixed-ed': 'credits',
    recap: 'recap',
  };
  const out = [];
  for (const item of data.results) {
    if (!item || !item.interval) continue;
    const kind = typeMap[String(item.skipType || '').toLowerCase()];
    if (!kind) continue;
    const seg = makeSegment(kind, item.interval.startTime, item.interval.endTime, 'aniskip');
    if (seg) out.push(seg);
  }
  return out;
}

async function fetchAniSkip(malId, episode, duration, fetchFn = fetchJson) {
  if (!malId || !episode) return [];
  const episodeLength = duration ? Math.round(duration) : 0;
  const url = `${ANISKIP_BASE}/${encodeURIComponent(String(malId))}/${encodeURIComponent(String(episode))}`
    + `?types[]=op&types[]=ed&types[]=recap&episodeLength=${encodeURIComponent(String(episodeLength))}`;
  const data = await fetchFn(url);
  return parseAniSkipPayload(data);
}

/* ==========================================================================
 * Fusión con prioridad por tipo de contenido
 * ========================================================================== */

function mergeSkipSegments(bySource, isAnime) {
  const priority = isAnime
    ? ['animeskip', 'aniskip', 'theintrodb', 'skipdb']
    : ['theintrodb', 'skipdb', 'animeskip', 'aniskip'];

  const pickedByKind = new Map();
  for (const src of priority) {
    const list = Array.isArray(bySource[src]) ? bySource[src] : [];
    const grouped = new Map();
    for (const seg of list) {
      if (!seg || !seg.kind) continue;
      if (!grouped.has(seg.kind)) grouped.set(seg.kind, []);
      grouped.get(seg.kind).push(seg);
    }
    for (const [kind, segs] of grouped.entries()) {
      if (!pickedByKind.has(kind)) {
        pickedByKind.set(kind, segs);
      }
    }
  }

  const merged = [];
  for (const list of pickedByKind.values()) {
    for (const seg of list) merged.push(seg);
  }
  merged.sort((a, b) => a.startSec - b.startSec);
  return merged;
}

/**
 * Consulta todos los proveedores de salto aplicables y devuelve los segmentos
 * fusionados + resumen por proveedor.
 */
async function getSkipSegments(rawInput, opts = {}) {
  const fetchFn = opts.fetchJson || fetchJson;
  const query = parseSkipQuery(rawInput);

  if (!query.imdbId && !query.tmdbId && !query.anilistId && !query.malId) {
    return {
      ok: true,
      segments: [],
      sources: { theintrodb: 0, skipdb: 0, animeskip: 0, aniskip: 0 },
      providers: [],
    };
  }

  // Si solo vino un TMDB ID y TMDB está configurado, resolvemos el IMDb ID
  // para desbloquear SkipDB y ARM v2.
  if (!query.imdbId && query.tmdbId && tmdb.isConfigured()) {
    try {
      const ext = await tmdb.externalIds(query.type === 'series' ? 'tv' : 'movie', query.tmdbId);
      if (ext && /^tt\d{4,}$/i.test(String(ext.imdb_id || ''))) {
        query.imdbId = String(ext.imdb_id).toLowerCase();
      }
    } catch (_) { /* seguimos con tmdbId */ }
  }

  // Redondeamos la duración a bloques de 15 s para compartir caché entre
  // reproducciones del mismo episodio con ligeras diferencias de codificación.
  const durationBucket = query.duration ? Math.round(query.duration / 15) * 15 : 0;
  const cacheKey = `skip:v1:${query.type}:${query.imdbId || ''}:${query.tmdbId || ''}:${query.anilistId || ''}:${query.malId || ''}:${query.season || 0}:${query.episode || 0}:${durationBucket}:${query.anime ? 1 : 0}`;

  if (!opts.bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const shouldCheckAnime = Boolean(
    query.anime
    || query.anilistId
    || query.malId
    || (query.type === 'series' && query.episode)
  );

  // Disparamos TheIntroDB, SkipDB y el puente ARM en paralelo.
  const [introDbSegs, skipDbSegs, animeIds] = await Promise.all([
    fetchTheIntroDb(query, fetchFn).catch(() => []),
    fetchSkipDb(query, fetchFn).catch(() => []),
    shouldCheckAnime
      ? resolveAnimeIds(query, fetchFn).catch(() => ({ anilistId: null, malId: null, matchedArm: false }))
      : Promise.resolve({ anilistId: null, malId: null, matchedArm: false }),
  ]);

  let animeSkipSegs = [];
  let aniSkipSegs = [];
  const episodeForAnime = query.episode || (query.type === 'movie' ? 1 : null);

  if (episodeForAnime && (animeIds.anilistId || animeIds.malId)) {
    [animeSkipSegs, aniSkipSegs] = await Promise.all([
      animeIds.anilistId
        ? fetchAnimeSkip(animeIds.anilistId, query.season, episodeForAnime, query.duration, fetchFn).catch(() => [])
        : Promise.resolve([]),
      animeIds.malId
        ? fetchAniSkip(animeIds.malId, episodeForAnime, query.duration, fetchFn).catch(() => [])
        : Promise.resolve([]),
    ]);
  }

  const bySource = {
    theintrodb: introDbSegs,
    skipdb: skipDbSegs,
    animeskip: animeSkipSegs,
    aniskip: aniSkipSegs,
  };

  const isAnime = Boolean(query.anime || animeIds.matchedArm);
  const segments = mergeSkipSegments(bySource, isAnime);
  const activeProviders = [...new Set(segments.map((s) => s.source))];

  const payload = {
    ok: true,
    segments,
    sources: {
      theintrodb: introDbSegs.length,
      skipdb: skipDbSegs.length,
      animeskip: animeSkipSegs.length,
      aniskip: aniSkipSegs.length,
    },
    providers: activeProviders,
  };

  if (!opts.bypassCache) {
    cache.set(cacheKey, payload, segments.length > 0 ? TTL_SEGMENTS_OK : TTL_SEGMENTS_EMPTY);
  }
  return payload;
}

module.exports = {
  getSkipSegments,
  parseSkipQuery,
  parseTheIntroDbPayload,
  parseSkipDbPayload,
  parseAnimeSkipTimestamps,
  parseAniSkipPayload,
  selectAnimeSkipEpisode,
  pickArmSeasonEntry,
  mergeSkipSegments,
  SEGMENT_LABELS,
  SOURCE_LABELS,
};
