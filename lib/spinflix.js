'use strict';
const { resolutionToken } = require('./resolution');

/** SpinFlix: búsqueda y detalle en LaMovieBot; el HLS se verifica en Vimeos. */
const config = require('./config');
const cache = require('./cache');
const { providerHttp, stopProvider, SEARCH_REQUEST_LIMIT } = require('./providerHttp');
const { normalizeText, yearOf, catalogYear, titleScore, titleQueries } = require('./providerTitles');
const { hitMatches } = require('./streamChoices');
const { allowedVideoUrl, hlsCandidate, vimeosMedia, resolveVimeosEmbed, vimeosCacheSeconds,
  unpackPacked, extractFromEmbedHtml } = require('./vimeos');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.2; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/html, */*',
};
const MAX_CANDIDATES = 3; // detalles a verificar por búsqueda
const MAX_EMBEDS = 3;     // servidores por título (suele haber 1)
const SLUG_TTL_SECONDS = 24 * 3600;

function candidateKind(item) {
  const url = String((item && item.url) || '');
  if (/\/pelicula\//.test(url) || (item && item.type === 'movies')) return 'pelicula';
  if (/\/anime\//.test(url) || (item && item.type === 'animes')) return 'anime';
  if (/\/serie\//.test(url) || (item && item.type === 'tvshows')) return 'serie';
  return null;
}

function slugOf(item) {
  if (item && item.slug) return String(item.slug);
  const m = String((item && item.url) || '').match(/\/(?:pelicula|serie|anime)\/([^/?#]+)/);
  return m ? m[1] : null;
}

const imdbId = (value) => typeof value === 'string' && /^tt\d+$/.test(value) ? value : null;
function tmdbId(value) {
  const id = /^[1-9]\d*$/.test(String(value ?? '')) ? Number(value) : null;
  return Number.isSafeInteger(id) ? id : null;
}
const titleRank = (item, titles) => titleScore([item.title, item.original_title, item.tmdb_title], titles);

/** El índice puede asociar un TMDB incorrecto: siempre confirmar en el detalle. */
function pickCandidate(items, resolved, titles, attempted = new Set()) {
  const wantKinds = resolved.mediaType === 'movie' ? ['pelicula'] : ['serie', 'anime'];
  const year = yearOf(resolved.year);
  const found = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const kind = candidateKind(item);
    if (!kind || !wantKinds.includes(kind)) continue;
    const slug = slugOf(item);
    if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) continue;
    const key = `/${kind}/${slug}`;
    if (attempted.has(key)) continue;
    const title = titleRank(item, titles);
    const candidateImdb = imdbId(item.imdb_id);
    const candidateTmdb = tmdbId(item.tmdb_id);
    const sameImdb = candidateImdb && candidateImdb === resolved.imdbId;
    const sameTmdb = candidateTmdb && candidateTmdb === tmdbId(resolved.tmdbId);
    if (!title && !sameImdb && !sameTmdb) continue; // compartir año no basta
    const seenYear = catalogYear(item);
    const dateScore = year && seenYear ? (seenYear === year ? 3 : -3) : 0;
    const score = (sameImdb ? 16 : 0) + (sameTmdb ? 2 : 0) + title * 4 + dateScore;
    if (!found.has(key) || found.get(key).score < score) found.set(key, { item, kind, slug, key, score });
  }
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

/** IDs comprobables primero; si faltan, título completo y año compatible. */
function verifyDetail(detail, kind, resolved, titles) {
  if (!detail || typeof detail !== 'object') return false;
  const seenKind = candidateKind(detail);
  if (seenKind && (kind === 'pelicula') !== (seenKind === 'pelicula')) return false;
  const imdb = imdbId(detail.imdb_id);
  if (resolved.imdbId && imdb) return imdb === resolved.imdbId;
  const tmdb = tmdbId(detail.tmdb_id);
  const wantedTmdb = tmdbId(resolved.tmdbId);
  if (wantedTmdb && tmdb) return tmdb === wantedTmdb;
  const year = yearOf(resolved.year);
  const seenYear = catalogYear(detail);
  return titleRank(detail, titles) > 0 && (!year || !seenYear || year === seenYear);
}

/**
 * Etiqueta de audio que entienden los filtros y las insignias (texto que va
 * en el título sintético del release: «Latino», «Castellano»…).
 */
function languageToken(language) {
  const lang = normalizeText(language);
  if (!lang) return '';
  const latino = /\blatino\b/.test(lang);
  const castellano = /castellano|espanol de espana/.test(lang);
  const dual = /dual|ingles/.test(lang);
  if (latino && dual) return 'Dual Latino';
  if (latino) return 'Latino';
  if (castellano && dual) return 'Dual Castellano';
  if (castellano) return 'Castellano';
  if (/subtitul/.test(lang)) return 'Subtitulado';
  return String(language).trim();
}

const AUDIO_LABELS = [
  [/\b(?:latino|latam|lat)\b/, 'Lat'],
  [/castellano|espanol de espana/, 'Castellano'],
  [/\b(?:ingles|english|eng)\b/, 'Inglés'],
  [/\bportugues\b/, 'Portugués'],
  [/\bfrances\b/, 'Francés'],
  [/\bitaliano\b/, 'Italiano'],
  [/\baleman\b/, 'Alemán'],
  [/\bjapones\b/, 'Japonés'],
  [/\bcoreano\b/, 'Coreano'],
  [/\bruso\b/, 'Ruso'],
  [/\bchino\b/, 'Chino'],
];

/**
 * Audio tal y como debe leerlo el usuario: «Lat», «ES», «Inglés» o la
 * combinación que traiga la ficha («Lat + Inglés», «ES + Inglés»…).
 * Un «español» a secas, sin latino ni castellano, se muestra «ES».
 */
function audioLabel(language) {
  const lang = normalizeText(language);
  if (!lang) return '';
  const out = [];
  for (const [pattern, label] of AUDIO_LABELS) {
    if (pattern.test(lang) && !out.includes(label)) out.push(label);
  }
  if (!out.length && /\bespanol\b|\bspanish\b/.test(lang)) out.push('Español');
  if (/subtitul/.test(lang)) out.push('Subtitulado');
  if (!out.length && /\bdual\b|\bmulti/.test(lang)) out.push('Dual');
  return out.join(' + ');
}

const baseUrl = () => String(config.spinflixUrl || 'https://lamoviebot.tvymas.workers.dev').replace(/\/+$/, '');

async function apiJson(path, http) {
  return http.json(`${baseUrl()}${path}`, { headers: HEADERS });
}

/** Solo opciones de vídeo en español de la ficha o el episodio comprobado. */
function embedsOf(detail) {
  const list = Array.isArray(detail?.embeds?.video) ? detail.embeds.video : [];
  const selected = new Map();
  for (const embed of list) {
    const label = audioLabel(embed?.language);
    if (!hitMatches({ audioLabel: label }, null)) continue;
    const link = typeof embed.link === 'string' && allowedVideoUrl(embed.link) ? embed.link : null;
    const streamUrl = hlsCandidate(embed.stream_url) ? embed.stream_url : null;
    const key = link || streamUrl;
    if (!key || selected.has(key)) continue;
    selected.set(key, { language: embed.language, label, link, streamUrl });
    if (selected.size === MAX_EMBEDS) break;
  }
  return selected.values();
}

function masterCandidates(data, streamUrl) {
  const failed = new Set((Array.isArray(data?.videos?.hls_status) ? data.videos.hls_status : [])
    .filter((entry) => /bloquead|forbidden|error|expir|\b[45]\d{2}\b/i.test(entry?.status || ''))
    .map((entry) => entry.url));
  const hls = Array.isArray(data?.videos?.hls) ? data.videos.hls : [];
  const qualities = Array.isArray(data?.qualities) ? data.qualities : [];
  const all = [...hls, streamUrl, ...qualities.map((quality) => quality?.url)];
  return [...new Set(all.filter(hlsCandidate))].sort((a, b) => Number(failed.has(a)) - Number(failed.has(b)));
}

async function hitFromEmbed(embed, resolved, http) {
  const { link, streamUrl } = embed;
  const cacheKey = `spinflix:hls:${JSON.stringify([baseUrl(), link, streamUrl])}`;
  const cached = cache.get(cacheKey);
  const media = cached ?? await mediaFromEmbed(link, streamUrl, http);
  if (!media) return null;
  if (!cached) {
    const ttl = vimeosCacheSeconds(media.expiresAt);
    if (ttl > 0) cache.set(cacheKey, media, ttl);
  }
  return spinFlixHit(media, embed, resolved);
}

/**
 * Sin sondeo del manifiesto: basta con que el resolver o el visor publicado
 * den una URL `.m3u8` válida por su forma. Se prefiere el HLS del resolver y,
 * si no lo hay, el del visor original.
 */
async function mediaFromEmbed(link, streamUrl, http) {
  const tried = new Set();
  const data = link ? await apiJson(`/streamurl?url=${encodeURIComponent(link)}`, http).catch((err) => {
    if (stopProvider(err)) throw err;
    return null;
  }) : null;
  let fallback = null;
  try {
    for (const master of masterCandidates(data, streamUrl).slice(0, 2)) {
      tried.add(master);
      const media = vimeosMedia(master);
      if (!media) continue;
      if (master !== streamUrl) return media;
      fallback ||= media;
    }
    if (!link) return fallback; // un stream_url nuevo se usa solo si es HLS válido
    const inspected = await resolveVimeosEmbed(link, 'https://spinoff.link/', http, tried);
    return inspected || fallback;
  } catch (err) {
    if (stopProvider(err) && !((err.timeout || err.requestLimit) && link && fallback)) throw err;
    return link ? fallback : null;
  }
}

function spinFlixHit(media, embed, resolved) {
  const { master, resolution, subtitles = [], expiresAt } = media;
  const lang = languageToken(embed.language);
  const ep = resolved.mediaType !== 'movie' && resolved.season != null && resolved.episode != null
    ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}`
    : '';
  const title = [
    `${resolved.title}${resolved.year ? ` ${resolved.year}` : ''}${ep}`,
    resolution, 'WEB-DL', lang, 'SpinFlix',
  ].filter(Boolean).join(' ');
  const hit = {
    provider: 'spinflix',
    quality: 'HLS',
    expiresAt,
    resolution,
    title,
    audioLabel: embed.label,
    url: master,
    size: 0,
    relevant: true,
    ...(subtitles.length ? { subtitles } : {}),
  };
  return hit;
}

async function hitsFromDetail(detail, kind, slug, resolved, http) {
  let target = detail;
  if (kind !== 'pelicula') {
    if (!(resolved.season >= 1 && resolved.episode >= 1)) return [];
    target = await apiJson(`/${kind}/${slug}/${resolved.season}/${resolved.episode}`, http);
    const expected = [resolved.season, resolved.episode];
    const numbers = [target?.season_number ?? target?.season, target?.episode_number ?? target?.episode];
    if (numbers.some((value, i) => /^\d+$/.test(value || '') && Number(value) !== expected[i])) return [];
  }
  const hits = [];
  for (const embed of embedsOf(target)) {
    try {
      const hit = await hitFromEmbed(embed, resolved, http);
      if (hit) hits.push(hit);
    } catch (err) {
      if (!stopProvider(err)) continue;
      // Con al menos un enlace válido no se abandona la fuente por un visor
      // caído; los rechazos de acceso sí cortan (ver stopProvider).
      const keep = hits.length > 0;
      if (!keep) throw err;
      break;
    }
  }
  return hits;
}

/** Busca con los títulos ya obtenidos por el addon, sin nuevas consultas de metadatos. */
async function searchSpinFlix(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'sin título resuelto' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'ya buscado con el título principal' };
  if (resolved.mediaType !== 'movie' && !(resolved.season >= 1 && resolved.episode >= 1)) {
    return { skipped: 'sin temporada/episodio que buscar' };
  }
  const http = providerHttp(timeoutMs, SEARCH_REQUEST_LIMIT);
  const titles = [resolved.title, resolved.altTitle];
  const queries = titleQueries(titles);
  const attempted = new Set();
  let failure;
  let responded = false;
  let matched = false;

  for (const q of queries) {
    const query = `spinflix="${q}"`;
    try {
      const data = await apiJson(`/search?q=${encodeURIComponent(q)}&page=1`, http);
      responded = true;
      const items = Array.isArray(data?.results) ? data.results : data?.items;
      for (const { kind, slug, key } of pickCandidate(items, resolved, titles, attempted)) {
        attempted.add(key);
        try {
          // La ficha de película puede contener URLs que rotan; se vuelve a
          // pedir cuando se recalcula el pool. La de serie solo da identidad.
          const detailKey = `spinflix:detail:${baseUrl()}${key}`;
          let detail = kind === 'pelicula' ? undefined : cache.get(detailKey);
          if (detail === undefined) {
            detail = await apiJson(key, http);
            if (kind !== 'pelicula' && detail && typeof detail === 'object') cache.set(detailKey, detail, SLUG_TTL_SECONDS);
          }
          if (!verifyDetail(detail, kind, resolved, titles)) continue;
          matched = true;
          const hits = await hitsFromDetail(detail, kind, slug, resolved, http);
          if (hits.length) return { hits, query };
        } catch (err) {
          if (stopProvider(err)) throw err;
          // Un episodio ausente en una ficha no invalida las demás candidatas.
          if (!failure || err.status >= 500) failure = err;
        }
      }
    } catch (err) {
      if (stopProvider(err)) throw err;
      if (!failure || err.status >= 500) failure = err;
    }
  }
  if (failure && (!responded || failure.status >= 500)) throw failure;
  return { hits: [], reason: matched ? 'no-compatible-media' : 'no-match', query: `spinflix="${queries[0] || ''}"` };
}

module.exports = {
  searchSpinFlix,
  // exportados para tests offline
  pickCandidate,
  verifyDetail,
  resolutionToken,
  languageToken,
  audioLabel,
  unpackPacked,
  extractFromEmbedHtml,
};
