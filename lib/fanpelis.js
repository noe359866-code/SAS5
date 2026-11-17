'use strict';

/**
 * Fanpelis (https://fanpelis.to) — API JSON pública, sin PoW y sin clave.
 *
 * Es la fuente hispana que menos cuesta de todas las evaluadas: **tres GET y
 * ni un solo SHA-256**. No hay que adivinar slugs ni scrapear HTML: la API
 * devuelve la obra, sus episodios y los embeds ya resueltos.
 *
 *   GET /api/rest/search?query=…&post_type=movies|tvshows,animes
 *       → { data: { posts: [{ _id, title, original_title, release_date, type, slug }] } }
 *   GET /api/rest/episodes?post_id={serie}
 *       → { data: [{ _id, season_number, episode_number, title, slug }] }
 *   GET /api/rest/player?post_id={obra|episodio}&_any=1
 *       → { data: { embeds: [{ url, lang, quality }], downloads: […] } }
 *
 * `embeds[].url` es un embed de vimeos.net, el MISMO host que ya reproduce
 * SpinFlix. Aquí no hace falta `/streamurl`: el HTML del embed viene
 * empaquetado con el `eval(function(p,a,c,k,e,d)…)` de Dean Edwards y de ahí
 * sale el `.m3u8` (más las pistas `.vtt` de subtítulos) sin ejecutar nada.
 * Por eso se reutilizan `unpackPacked`, `extractFromEmbedHtml` y `proxiedHls`
 * de `spinflix.js`: el HLS va por el proxy propio del addon, que pone el
 * Referer en cada segmento.
 *
 * Verificado (nov-2026, desde un runner de GitHub Actions):
 *
 *   Matrix (1999)      → 1 embed Latino Full HD → embed 53 KB → master .m3u8
 *   Breaking Bad S01E01 → 1 embed Latino Full HD → embed 53 KB → master .m3u8 + .vtt
 *
 * Lo que NO trae: doblaje castellano propio (todo va etiquetado Latino) y las
 * descargas (`downloads[]`) son Mega/Mediafire/1fichier/magnet, que no se
 * pueden reproducir desde un Worker y se ignoran a propósito.
 *
 * `FANPELIS=off` lo desactiva sin tocar el resto de proveedores.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson, fetchText } = require('./http');
const { unpackPacked, extractFromEmbedHtml, proxiedHls } = require('./spinflix');

const DEFAULT_BASE = 'https://fanpelis.to';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};
/** El catálogo se actualiza a diario: 24 h para fichas y episodios. */
const SEARCH_TTL_SECONDS = 24 * 3600;
/** El token del .m3u8 de vimeos caduca a las 12 h: la mitad es seguro. */
const HLS_TTL_SECONDS = 2 * 3600;
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

async function apiJson(path, timeoutMs) {
  const url = `${baseUrl()}${path}`;
  const key = `fanpelis:json:${path}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const data = await fetchJson(url, { timeoutMs, headers: { ...HEADERS, Referer: `${baseUrl()}/` } });
  cache.set(key, data, SEARCH_TTL_SECONDS);
  return data;
}

/**
 * Fichas de `/search` ordenadas por parecido. Los títulos vienen doblados al
 * español («Matrix recargado»), así que se contrastan el título y el original,
 * y el año desempata: sin esto, buscar «Matrix» devolvería Resurrections.
 * Exportada para pruebas.
 */
function pickCandidates(items, resolved) {
  const titles = [resolved && resolved.title, resolved && resolved.altTitle].filter(Boolean).map(normalizeText);
  const wantType = resolved && resolved.mediaType === 'movie' ? 'movies' : null;
  const scored = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item._id) continue;
    if (wantType && item.type && item.type !== wantType) continue;
    if (!wantType && item.type === 'movies') continue;
    const names = [item.title, item.original_title].map(normalizeText).filter(Boolean);
    let score = 0;
    if (titles.some((title) => names.includes(title))) score += 5;
    else if (titles.some((title) => names.some((name) => name.startsWith(title) || title.startsWith(name)))) score += 2;
    const year = yearOf(item.release_date);
    if (resolved && resolved.year && year) {
      score += String(year) === String(resolved.year).slice(0, 4) ? 3 : -3;
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
  if (/castellano|espanol de espana/.test(text)) return 'Castellano';
  if (/latino|\blat\b/.test(text)) return 'Latino';
  if (/sub/.test(text)) return 'Subtitulado';
  if (/dual/.test(text)) return 'Dual';
  return lang ? String(lang) : 'Latino';
}

/** Hosts de reproductor que sabemos abrir; el resto son anuncios o descargas. */
const PLAYER_HOSTS = /^https:\/\/(?:vimeos\.net|lamovie\.link|filemoon|vidhide|streamwish|streamtape|doodstream|dood\.|mixdrop|uqload|voe\.|dropload|unlimplay|netu)/i;

/** `.m3u8` del HTML de un embed (desempaquetando si viene empaquetado). */
function masterFromEmbed(html) {
  const extracted = extractFromEmbedHtml(html);
  return { master: extracted.hls[0] || null, subtitles: extracted.subtitles || [] };
}

/** Un embed → hit reproducible, con la caché del .m3u8 por delante. */
async function hitFromEmbed(embed, resolved, timeoutMs) {
  const url = String(embed && embed.url || '');
  if (!PLAYER_HOSTS.test(url)) return null;
  const cacheKey = `fanpelis:embed:${url}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let html;
  try {
    html = await fetchText(url, {
      timeoutMs,
      headers: { ...HEADERS, Accept: 'text/html,*/*', Referer: `${baseUrl()}/` },
    });
  } catch (_) {
    return null;
  }
  const { master, subtitles } = masterFromEmbed(html);
  if (!master) {
    // El embed responde pero no entrega el .m3u8: se sirve tal cual y que lo
    // intente el reproductor de Stremio con el Referer puesto.
    const hit = {
      provider: 'fanpelis',
      title: [resolved.title, resolved.year, audioLabelOf(embed.lang), 'Fanpelis'].filter(Boolean).join(' '),
      url,
      referer: `${baseUrl()}/`,
      audioLabel: audioLabelOf(embed.lang),
      seeders: 0, peers: 0, size: 0, relevant: true,
    };
    cache.set(cacheKey, hit, HLS_TTL_SECONDS);
    return hit;
  }
  const ep = resolved.mediaType !== 'movie' && resolved.season != null && resolved.episode != null
    ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}`
    : '';
  const hit = {
    provider: 'fanpelis',
    title: [
      `${resolved.title}${resolved.year ? ` ${resolved.year}` : ''}${ep}`,
      /4k|2160/i.test(String(embed.quality)) ? '2160p' : /full|1080/i.test(String(embed.quality)) ? '1080p' : '720p',
      'WEB-DL', audioLabelOf(embed.lang), 'Fanpelis',
    ].filter(Boolean).join(' '),
    audioLabel: audioLabelOf(embed.lang),
    url: proxiedHls(master),
    directUrl: master,
    seeders: 0, peers: 0, size: 0, relevant: true,
    ...(subtitles.length ? { subtitles } : {}),
  };
  cache.set(cacheKey, hit, HLS_TTL_SECONDS);
  return hit;
}

async function hitsForPost(post, resolved, query, timeoutMs) {
  let target = post;
  if (resolved.mediaType !== 'movie') {
    if (!(resolved.season >= 1 && resolved.episode >= 1)) return { hits: [], query };
    const list = await apiJson(`/api/rest/episodes?post_id=${encodeURIComponent(post._id)}`, timeoutMs);
    const episode = pickEpisode(list && list.data, resolved.season, resolved.episode);
    if (!episode) return { hits: [], query };
    target = episode;
  }
  const player = await apiJson(`/api/rest/player?post_id=${encodeURIComponent(target._id)}&_any=1`, timeoutMs);
  const embeds = (player && player.data && Array.isArray(player.data.embeds)) ? player.data.embeds : [];
  const hits = [];
  for (const embed of embeds.slice(0, 4)) {
    const hit = await hitFromEmbed(embed, resolved, timeoutMs);
    if (hit) hits.push(hit);
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
  const kind = resolved.mediaType === 'movie' ? 'movies' : 'tvshows,animes';
  // Título original y el de la petición: la API entiende ambos y una sola
  // consulta basta en la mayoría de los casos.
  const queries = [...new Set([resolved.title, resolved.altTitle, queryTitle].filter(Boolean))];
  let failure = null;
  let responded = false;
  for (const q of queries) {
    let items = [];
    try {
      const data = await apiJson(`/api/rest/search?query=${encodeURIComponent(q)}&post_type=${encodeURIComponent(kind)}&posts_per_page=8`, timeoutMs);
      items = (data && data.data && (data.data.posts || (data.data.data && data.data.data.posts))) || [];
      responded = true;
    } catch (err) {
      failure = failure || err;
      continue;
    }
    for (const post of pickCandidates(items, resolved)) {
      const result = await hitsForPost(post, resolved, `fanpelis="${q}"`, timeoutMs);
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
  PLAYER_HOSTS,
};
