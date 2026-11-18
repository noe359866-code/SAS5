'use strict';

/** Fanpelis: API JSON para fichas y episodios; HLS verificado en Vimeos. */
const config = require('./config');
const cache = require('./cache');
const { providerHttp, stopProvider, providerFormatError, SEARCH_REQUEST_LIMIT } = require('./providerHttp');
const { normalizeText, yearOf, catalogYear, titleScore, titleQueries } = require('./providerTitles');
const { hitMatches } = require('./streamChoices');
const { allowedVideoUrl, extractFromEmbedHtml, resolveVimeosEmbed, vimeosCacheSeconds } = require('./vimeos');

const DEFAULT_BASE = 'https://fanpelis.to';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};
/** El catálogo se actualiza a diario: 24 h para fichas y episodios. */
const SEARCH_TTL_SECONDS = 24 * 3600;
const MAX_CANDIDATES = 3;
const MAX_EPISODE_COPIES = 2;
const MAX_EMBEDS = 4;

function baseUrl() {
  return String(config.fanpelisUrl || DEFAULT_BASE).replace(/\/+$/, '');
}

function enabled() {
  return config.fanpelisEnabled !== false;
}

async function apiList(stage, params, http) {
  const base = baseUrl();
  const url = `${base}/api/rest/${stage}?${new URLSearchParams(params)}`;
  const key = `fanpelis:json:${url}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const data = await http.json(url, { stage, headers: { ...HEADERS, Referer: `${base}/` } });
  let list;
  if (stage === 'search') list = Array.isArray(data?.data?.posts) ? data.data.posts : data?.data?.data?.posts;
  else if (stage === 'episodes') list = data?.data;
  else if (stage === 'player') list = data?.data?.embeds;
  // Un error de la API con HTTP 200 no se puede cachear como lista vacía.
  if (data?.error === true || !Array.isArray(list)) throw providerFormatError(stage);
  cache.set(key, list, stage === 'player' ? 300 : SEARCH_TTL_SECONDS);
  return list;
}

/** Coincidencia de título completo y año compatible, nunca solo un prefijo. */
function pickCandidates(items, resolved, attempted = new Set()) {
  const titles = [resolved.title, resolved.altTitle];
  const movie = resolved.mediaType === 'movie';
  const wantedYear = yearOf(resolved.year);
  const scored = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?._id || (movie ? item.type && item.type !== 'movies' : item.type === 'movies')) continue;
    const id = String(item._id);
    if (attempted.has(id)) continue;
    const title = titleScore([item.title, item.original_title], titles);
    const seenYear = catalogYear(item);
    if (!title || (wantedYear && seenYear && wantedYear !== seenYear)) continue;
    const score = title + (wantedYear && wantedYear === seenYear ? 2 : 0);
    if (!scored.has(id) || scored.get(id).score < score) scored.set(id, { post: item, score });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES).map(({ post }) => post);
}

/** Solo copias del episodio exacto. Primero el slug publicado más corto. */
function pickEpisodes(list, season, episode) {
  const matches = (Array.isArray(list) ? list : []).filter((item) => (
    item?._id && Number(item.season_number) === Number(season) && Number(item.episode_number) === Number(episode)
  ));
  const length = (item) => String(item.slug || '').length || Infinity;
  matches.sort((a, b) => length(a) - length(b));
  return [...new Map(matches.map((item) => [String(item._id), item])).values()].slice(0, MAX_EPISODE_COPIES);
}

function pickEpisode(list, season, episode) {
  return pickEpisodes(list, season, episode)[0] || null;
}

/** Idioma del embed → etiqueta de audio del addon. */
function audioLabelOf(lang) {
  const text = normalizeText(lang);
  const latino = /latino|\blat\b/.test(text);
  const castellano = /castellano|espanol de espana/.test(text);
  const english = /ingles|english|\beng\b/.test(text);
  if (english && latino) return 'Latino + Inglés';
  if (english && castellano) return 'Castellano + Inglés';
  if (english) return 'Inglés';
  if (/\b(?:sub|subtitulado|subtitulada|subbed)\b/.test(text)) return 'Subtitulado';
  if (castellano) return 'Castellano';
  if (latino) return 'Latino';
  if (/dual/.test(text)) return 'Dual';
  return lang ? String(lang) : '';
}

/** `.m3u8` del HTML de un embed (desempaquetando si viene empaquetado). */
function masterFromEmbed(html) {
  const extracted = extractFromEmbedHtml(html);
  return { master: extracted.hls[0] || null, subtitles: extracted.subtitles || [] };
}

/** Un embed → hit reproducible, con la caché del .m3u8 por delante. */
async function hitFromEmbed(url, http) {
  const base = baseUrl();
  const cacheKey = `fanpelis:embed:${base}:${url}`;
  const cached = cache.get(cacheKey);
  const media = cached ?? await resolveVimeosEmbed(url, `${base}/`, http);
  if (media && !cached) {
    const ttl = vimeosCacheSeconds(media.expiresAt);
    if (ttl > 0) cache.set(cacheKey, media, media.verification === 'manifest-ok' ? ttl : Math.min(ttl, 30));
  }
  return media;
}

function buildHit(media, audioLabel, resolved) {
  const { master, resolution, expiresAt, subtitles, verification } = media;
  const ep = resolved.mediaType !== 'movie' && resolved.season != null && resolved.episode != null
    ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}`
    : '';
  const hit = {
    resolution,
    provider: 'fanpelis',
    quality: 'HLS',
    expiresAt,
    verification,
    title: [
      `${resolved.title}${resolved.year ? ` ${resolved.year}` : ''}${ep}`,
      resolution,
      'WEB-DL', audioLabel, 'Fanpelis',
    ].filter(Boolean).join(' '),
    audioLabel,
    url: master,
    relevant: true,
    ...(subtitles.length ? { subtitles } : {}),
  };
  return hit;
}

async function hitsForPlayer(target, resolved, http) {
  const embeds = await apiList('player', { post_id: target._id, _any: '1' }, http);
  const urls = new Set();
  const hits = [];
  for (const embed of embeds) {
    const url = embed?.url;
    const audioLabel = audioLabelOf(embed?.lang);
    // El límite cuenta visores aptos, no anuncios, idiomas descartados ni duplicados.
    if (typeof url !== 'string' || urls.has(url) || !hitMatches({ audioLabel }, null) || !allowedVideoUrl(url, ['lamovie.link'])) continue;
    urls.add(url);
    try {
      const media = await hitFromEmbed(url, http);
      if (media) hits.push(buildHit(media, audioLabel, resolved));
    } catch (err) {
      if (stopProvider(err)) {
        const keep = hits.some((hit) => hit.verification === 'manifest-ok') || ((err.timeout || err.requestLimit) && hits.length);
        if (!keep) throw err;
        break;
      }
    }
    if (urls.size === MAX_EMBEDS) break;
  }
  return hits;
}

async function hitsForPost(post, resolved, query, http) {
  let targets = [post];
  if (resolved.mediaType !== 'movie') {
    const list = await apiList('episodes', { post_id: post._id }, http);
    targets = pickEpisodes(list, resolved.season, resolved.episode);
  }
  let fallback = [];
  let failure;
  for (const target of targets) {
    try {
      const hits = await hitsForPlayer(target, resolved, http);
      if (hits.some((hit) => hit.verification === 'manifest-ok')) return { hits, query };
      if (hits.length && !fallback.length) fallback = hits;
    } catch (err) {
      if (stopProvider(err)) {
        if ((err.timeout || err.requestLimit) && fallback.length) break;
        throw err;
      }
      failure ??= err;
    }
  }
  if (!fallback.length && failure) throw failure;
  return { hits: fallback, query };
}

/**
 * Buscador para `/stream/:type/:id`. Como los demás proveedores hispanos,
 * busca por su cuenta (los títulos de la fuente están en español): la pasada
 * con el título alternativo se salta.
 */
async function searchFanpelis(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!enabled()) return { skipped: 'desactivado por FANPELIS=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) {
    return { skipped: 'ya buscado con el título principal' };
  }
  if (!resolved) return { skipped: 'sin título resuelto' };
  if (resolved.mediaType !== 'movie' && !(resolved.season >= 1 && resolved.episode >= 1)) {
    return { skipped: 'sin temporada/episodio' };
  }
  const http = providerHttp(timeoutMs, SEARCH_REQUEST_LIMIT);
  const kind = resolved.mediaType === 'movie' ? 'movies' : 'tvshows,animes';
  // La API busca SOLO contra el título traducido (`title`): «The Matrix»
  // devuelve 0 aunque la ficha lo tenga como `original_title`. Por eso se
  // prueba también sin el artículo inicial, que es como lo titulan las fichas
  // hispanas («Matrix», «Interestelar»).
  // Mufasa se encuentra antes por el título corto sin relajar la identidad.
  const queries = titleQueries([queryTitle, resolved.title, resolved.altTitle], true);
  let fallback;
  let failure;
  const attempted = new Set();
  try {
    for (const q of queries) {
      let items;
      try {
        items = await apiList('search', { query: q, post_type: kind, posts_per_page: '8' }, http);
      } catch (err) {
        if (stopProvider(err)) throw err;
        failure ??= err;
        continue;
      }
      for (const post of pickCandidates(items, resolved, attempted)) {
        attempted.add(String(post._id));
        try {
          const result = await hitsForPost(post, resolved, `fanpelis="${q}"`, http);
          if (result.hits.some((hit) => hit.verification === 'manifest-ok')) return result;
          // Un rechazo puntual del CDN no es prueba de que la ficha sea mejor.
          if (result.hits.length) fallback ||= result;
        } catch (err) {
          if (stopProvider(err)) throw err;
          if (![404, 410].includes(err.status)) failure ??= err;
        }
      }
    }
  } catch (err) {
    if (!(fallback && (err.timeout || err.requestLimit))) throw err;
  }
  if (fallback) return fallback;
  if (failure) throw failure;
  return { hits: [], reason: attempted.size ? 'no-compatible-media' : 'no-match', query: `fanpelis="${queries[0] || ''}"` };
}

module.exports = {
  searchFanpelis,
  // exportados para pruebas offline
  pickCandidates,
  pickEpisode,
  audioLabelOf,
  masterFromEmbed,
};
