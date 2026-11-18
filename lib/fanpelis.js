'use strict';

/** Fanpelis: API JSON para fichas y episodios; HLS verificado en Vimeos. */
const config = require('./config');
const cache = require('./cache');
const { providerHttp } = require('./providerHttp');
const { hitMatches } = require('./streamChoices');
const { allowedVideoUrl, extractFromEmbedHtml, proxiedHls, resolveVimeosEmbed, vimeosCacheSeconds } = require('./vimeos');

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

function baseUrl() {
  return String(config.fanpelisUrl || DEFAULT_BASE).replace(/\/+$/, '');
}

function enabled() {
  return config.fanpelisEnabled !== false;
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function yearOf(value) {
  const match = String(value || '').match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

async function apiJson(path, http) {
  const url = `${baseUrl()}${path}`;
  const key = `fanpelis:json:${url}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const data = await http.json(url, { headers: { ...HEADERS, Referer: `${baseUrl()}/` } });
  cache.set(key, data, path.startsWith('/api/rest/player') ? 300 : SEARCH_TTL_SECONDS);
  return data;
}

/**
 * Fichas de `/search` ordenadas por parecido. Los títulos vienen doblados al
 * español («Matrix recargado»), así que se contrastan el título y el original,
 * y el año desempata: sin esto, buscar «Matrix» devolvería Resurrections.
 * Exportada para pruebas.
 */
function pickCandidates(items, resolved, exactOnly = false) {
  const normalizeTitle = (text) => normalizeText(String(text || '').replace(/\s+\((?:19|20)\d{2}\)\s*$/, ''));
  const titles = [resolved?.title, resolved?.altTitle].map(normalizeTitle).filter(Boolean);
  const wantType = resolved?.mediaType === 'movie' ? 'movies' : null;
  const wantedYear = yearOf(resolved?.year);
  const scored = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item._id) continue;
    if (wantType && item.type && item.type !== wantType) continue;
    if (!wantType && item.type === 'movies') continue;
    const names = [item.title, item.original_title].map(normalizeTitle).filter(Boolean);
    let score = 0;
    if (titles.some((title) => names.includes(title))) score = 5;
    else if (!exactOnly && titles.some((title) => names.some((name) => name.startsWith(`${title} `) || title.startsWith(`${name} `)))) score = 2;
    if (!score) continue; // El año nunca basta para identificar la obra.
    const year = yearOf(item.release_date);
    if (wantedYear && year) {
      if (wantedYear !== year) continue;
      score += 3;
    }
    if (score > 0) scored.push({ post: item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES).map((entry) => entry.post);
}

/** Episodio exacto de `/episodes`. Hay duplicados: gana el slug más corto. */
function pickEpisode(list, season, episode) {
  const matches = (Array.isArray(list) ? list : []).filter((item) => (
    item && item._id
    && Number(item.season_number) === Number(season)
    && Number(item.episode_number) === Number(episode)
  ));
  matches.sort((a, b) => String(a.slug || '').length - String(b.slug || '').length);
  return matches[0] || null;
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
  if (castellano) return 'Castellano';
  if (latino) return 'Latino';
  if (/sub/.test(text)) return 'Subtitulado';
  if (/dual/.test(text)) return 'Dual';
  return lang ? String(lang) : '';
}

/** `.m3u8` del HTML de un embed (desempaquetando si viene empaquetado). */
function masterFromEmbed(html) {
  const extracted = extractFromEmbedHtml(html);
  return { master: extracted.hls[0] || null, subtitles: extracted.subtitles || [] };
}

/** Un embed → hit reproducible, con la caché del .m3u8 por delante. */
async function hitFromEmbed(embed, http) {
  const url = String(embed?.url || '');
  const audioLabel = audioLabelOf(embed?.lang);
  if (!allowedVideoUrl(url, ['lamovie.link']) || !hitMatches({ audioLabel, url }, null)) return null;
  const cacheKey = `fanpelis:embed:${url}:${audioLabel}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return { ...cached, url: proxiedHls(cached.master) };

  const media = await resolveVimeosEmbed(url, `${baseUrl()}/`, http).catch((err) => {
    if (err.timeout) throw err;
    return null;
  });
  if (!media) return null;
  const { master, expiresAt } = media;
  cache.set(cacheKey, media, vimeosCacheSeconds(expiresAt));
  return { ...media, url: proxiedHls(master) };
}

function buildHit(media, embed, resolved) {
  const { master, resolution, expiresAt, subtitles, url, verification } = media;
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
      'WEB-DL', audioLabelOf(embed.lang), 'Fanpelis',
    ].filter(Boolean).join(' '),
    audioLabel: audioLabelOf(embed.lang),
    url,
    directUrl: master,
    relevant: true,
    ...(subtitles.length ? { subtitles } : {}),
  };
  return hit;
}

async function hitsForPost(post, resolved, query, http) {
  let target = post;
  if (resolved.mediaType !== 'movie') {
    if (!(resolved.season >= 1 && resolved.episode >= 1)) return { hits: [], query };
    const list = await apiJson(`/api/rest/episodes?post_id=${encodeURIComponent(post._id)}`, http);
    const episode = pickEpisode(list && list.data, resolved.season, resolved.episode);
    if (!episode) return { hits: [], query };
    target = episode;
  }
  const player = await apiJson(`/api/rest/player?post_id=${encodeURIComponent(target._id)}&_any=1`, http);
  const embeds = (player && player.data && Array.isArray(player.data.embeds)) ? player.data.embeds : [];
  const hits = [];
  for (const embed of embeds.slice(0, 4)) {
    try {
      const media = await hitFromEmbed(embed, http);
      if (media) hits.push(buildHit(media, embed, resolved));
    } catch (err) {
      if (!hits.length) throw err;
      break;
    }
  }
  return { hits, query };
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
  const http = providerHttp(timeoutMs);
  const kind = resolved.mediaType === 'movie' ? 'movies' : 'tvshows,animes';
  // La API busca SOLO contra el título traducido (`title`): «The Matrix»
  // devuelve 0 aunque la ficha lo tenga como `original_title`. Por eso se
  // prueba también sin el artículo inicial, que es como lo titulan las fichas
  // hispanas («Matrix», «Interestelar»).
  const stripArticle = (title) => String(title || '').replace(/^(?:the|el|la|los|las|le|les)\s+/i, '').trim();
  const base = [queryTitle, resolved.title, resolved.altTitle].filter(Boolean);
  const queries = [...new Set([...base, ...base.map(stripArticle)].filter(Boolean))];
  // Algunos títulos con subtítulo no salen por su nombre completo (Mufasa:
  // El rey león). Prueba solo la primera parte, pero verifica el título entero.
  const shortTitle = String(resolved.title || '').split(':', 1)[0].trim();
  const fallback = shortTitle && !queries.includes(shortTitle) ? shortTitle : null;
  if (fallback) queries.push(fallback);
  let failure = null;
  let responded = false;
  for (const q of queries) {
    let items = [];
    try {
      const data = await apiJson(`/api/rest/search?query=${encodeURIComponent(q)}&post_type=${encodeURIComponent(kind)}&posts_per_page=8`, http);
      items = (data && data.data && (data.data.posts || (data.data.data && data.data.data.posts))) || [];
      responded = true;
    } catch (err) {
      if (err.timeout || err.challenge || err.status === 429) throw err;
      failure = failure || err;
      continue;
    }
    for (const post of pickCandidates(items, resolved, q === fallback)) {
      // Un fallo con UNA ficha (player caído, episodio inexistente) no debe
      // tumbar la búsqueda entera: se anota y se sigue con la siguiente.
      let result;
      try {
        result = await hitsForPost(post, resolved, `fanpelis="${q}"`, http);
      } catch (err) {
        if (err.timeout || err.challenge || err.status === 429) throw err;
        failure = failure || err;
        continue;
      }
      if (result.hits.length) return result;
    }
  }
  if (failure && !responded) throw failure;
  return { hits: [], query: `fanpelis="${queries[0] || ''}"` };
}

module.exports = {
  searchFanpelis,
  // exportados para pruebas offline
  pickCandidates,
  pickEpisode,
  audioLabelOf,
  masterFromEmbed,
};
