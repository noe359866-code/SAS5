'use strict';

/**
 * Proveedores de contenido (streams torrent) para Stremio.
 *
 * Cinco fuentes públicas, sin clave ni registro:
 *  - Knaben        → https://knaben.org/api/v2/        (API JSON v2)
 *  - Torlock       → https://www.torlock.com/apis.html (feed Torznab XML)
 *  - BlackHoleBay  → https://theblackholebay.lol/api   (API JSON)
 *  - Nyaa          → https://nyaaapi.onrender.com/docs (API JSON no oficial
 *                    de nyaa.si: anime y live action asiático)
 *  - YTS           → https://yts.gg/api                (API JSON, solo películas)
 *
 * Flujo: Stremio pide /stream/:type/:id.json con un IMDb id
 * (tt…, tt…:temporada:episodio en series). Resolvemos título+año con
 * TMDB (o TVMaze en series), buscamos en los proveedores activos en
 * paralelo, deduplicamos por infoHash y devolvemos streams magnet
 * ordenados por seeders. Cada proveedor es independiente: si uno
 * falla o tarda, los demás siguen respondiendo.
 *
 * Knaben, Torlock y BlackHoleBay son indexadores generales y reciben la
 * misma consulta de texto. Nyaa y YTS son especializados: YTS se consulta
 * por IMDb id, y Nyaa con consulta y filtro propios (títulos en romaji,
 * numeración de fansub, lotes por temporada).
 *
 * Selección de proveedores:
 *  - Global: variable STREAM_PROVIDERS="knaben,torlock,blackholebay,nyaa,yts"
 *  - Por usuario: campo `streams` de la config de /configure.
 *
 * Filtros por usuario (campos `hide`, `sort` y `maxSize` de la config):
 * cada resultado se clasifica por su nombre (CAM, REMUX, 3D, resolución,
 * HDR…; ver lib/streamFilters.js). La búsqueda se cachea SIN filtrar y las
 * preferencias de cada usuario se aplican al responder, así que dos
 * usuarios con filtros distintos comparten la misma búsqueda.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson, fetchText } = require('./http');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');
const { classify, applyPrefs } = require('./streamFilters');

const PROVIDERS = [
  { key: 'knaben', name: 'Knaben', url: 'https://knaben.org/api/v2/' },
  { key: 'torlock', name: 'Torlock', url: 'https://www.torlock.com/apis.html' },
  { key: 'blackholebay', name: 'BlackHoleBay', url: 'https://theblackholebay.lol/api' },
  { key: 'nyaa', name: 'Nyaa', url: 'https://nyaaapi.onrender.com/docs' },
  { key: 'yts', name: 'YTS', url: 'https://yts.gg/api' },
];
const PROVIDER_KEYS = PROVIDERS.map((p) => p.key);
const PROVIDER_NAMES = Object.fromEntries(PROVIDERS.map((p) => [p.key, p.name]));

// Algunos indexadores bloquean el User-Agent por defecto de fetch.
const PROVIDER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.2; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/xml, */*',
};

const STREAM_TTL_SECONDS = 3600; // 1h: los seeders cambian, no cachear de más
const PER_PROVIDER_LIMIT = 50;
// Resultados que se guardan por título antes de filtrar. Más que los que se
// muestran (STREAM_MAX_RESULTS) para que, al ocultar categorías, sigan
// quedando streams; acotado porque la caché en memoria es compartida.
const STREAM_POOL_LIMIT = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────
function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

/** Trackers extraíbles de un magnet, en formato `sources` de Stremio. */
function magnetSources(magnet, infoHash) {
  const sources = [];
  if (magnet) {
    for (const m of String(magnet).matchAll(/[?&]tr=([^&]+)/g)) {
      try {
        sources.push(`tracker:${decodeURIComponent(m[1])}`);
      } catch (_) { /* tracker mal codificado: se ignora */ }
    }
  }
  if (infoHash) sources.push(`dht:${infoHash}`);
  return sources.length ? sources : undefined;
}

function decodeXml(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución de título (IMDb/TMDB/TVMaze id → título, año, temporada/episodio)
// ─────────────────────────────────────────────────────────────────────────────
function parseStreamId(type, id) {
  const raw = decodeURIComponent(String(id || ''));
  const parts = raw.split(':');
  const out = { raw, baseId: raw, season: null, episode: null };
  if (parts[0] && parts[0].startsWith('tt')) {
    out.baseId = parts[0];
    if (parts.length >= 3) {
      out.season = parseInt(parts[1], 10);
      out.episode = parseInt(parts[2], 10);
    }
  }
  return out;
}

/**
 * Respaldo sin clave: Cinemeta (el meta-addon por defecto de Stremio).
 * Clave para que los streams funcionen aunque TMDB no esté configurado
 * en el despliegue: sin título resoluble no hay nada que buscar.
 */
async function cinemetaLookup(type, imdbId) {
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`;
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const data = await fetchJson(url, { timeoutMs: 8000, headers: PROVIDER_HEADERS });
    const meta = data && data.meta ? data.meta : null;
    cache.set(url, meta, 24 * 3600);
    return meta;
  } catch (err) {
    console.error('[Streams] Cinemeta falló para', imdbId, '->', err.message);
    return null;
  }
}

/** Rasgos de un título de TMDB (resultado de /find o ficha de detalle). */
function tmdbTraits(item) {
  const genres = Array.isArray(item.genre_ids)
    ? item.genre_ids
    : Array.isArray(item.genres) ? item.genres.map((g) => g && g.id) : null;
  return {
    animation: genres ? genres.includes(16) : null, // 16 = Animación
    language: item.original_language || null,
  };
}

/** Rasgos de una serie de TVMaze. */
function tvmazeTraits(show) {
  return {
    animation: show.type === 'Animation' || (Array.isArray(show.genres) && show.genres.includes('Anime')),
    language: show.language || null,
  };
}

/**
 * Título, año y temporada/episodio de un id de Stremio. Además devuelve lo
 * que se sepa del título para los proveedores especializados:
 *  - imdbId            → YTS busca por él.
 *  - tmdbId, tmdbType  → títulos alternativos (romaji) para Nyaa.
 *  - animation         → true/false, o null si se desconoce (categoría de Nyaa).
 *  - language, country → idioma original (código de TMDB o nombre en inglés
 *                        de TVMaze) y países de producción (Cinemeta).
 */
async function resolveTitle(type, id) {
  const { baseId, season, episode } = parseStreamId(type, id);
  const mediaType = type === 'series' ? 'series' : 'movie';
  let title = null;    // título en inglés (el que usan los indexadores)
  let altTitle = null; // título original, por si el inglés no da resultados
  let year = '';
  const traits = { imdbId: null, tmdbId: null, tmdbType: null, animation: null, language: null, country: null };

  if (baseId.startsWith('tt')) {
    if (/^tt\d+$/.test(baseId)) traits.imdbId = baseId;
    const found = await tmdb.findByImdbId(baseId, 'en');
    const item = mediaType === 'movie' ? found.movie : found.tv;
    const fallback = mediaType === 'movie' ? found.tv : found.movie;
    const hit = item || fallback;
    if (hit) {
      // Con language=en, title/name ya viene en inglés; original_* es el
      // título original (p. ej. japonés romanizado), que casi ningún
      // torrent usa como nombre de release → va como alternativa.
      title = hit.title || hit.name || hit.original_title || hit.original_name;
      altTitle = hit.original_title || hit.original_name || null;
      year = String(hit.release_date || hit.first_air_date || '').slice(0, 4);
      Object.assign(traits, tmdbTraits(hit), { tmdbId: hit.id, tmdbType: hit === found.movie ? 'movie' : 'tv' });
    }
    if (!title && mediaType === 'series') {
      const show = await tvmaze.showLookupByImdb(baseId);
      if (show) {
        title = show.name;
        year = show.premiered ? show.premiered.slice(0, 4) : '';
        Object.assign(traits, tvmazeTraits(show));
      }
    }
    if (!title) {
      const meta = await cinemetaLookup(mediaType, baseId);
      if (meta && meta.name) {
        title = meta.name;
        year = String(meta.releaseInfo || meta.year || '').slice(0, 4);
        const genres = meta.genres || meta.genre;
        if (Array.isArray(genres)) traits.animation = genres.includes('Animation');
        traits.country = meta.country || null;
      }
    }
  } else if (baseId.startsWith('tmdb:')) {
    const numId = baseId.split(':').pop();
    if (/^\d+$/.test(numId)) {
      const tmdbType = tmdb.tmdbMediaType(mediaType);
      const data = await tmdb.tmdbGet(`/${tmdbType}/${numId}`, {}, 24 * 3600, 'en');
      if (data) {
        title = data.title || data.name || data.original_title || data.original_name;
        altTitle = data.original_title || data.original_name || null;
        year = String(data.release_date || data.first_air_date || '').slice(0, 4);
        Object.assign(traits, tmdbTraits(data), { tmdbId: data.id, tmdbType });
        if (/^tt\d+$/.test(data.imdb_id || '')) traits.imdbId = data.imdb_id;
      }
    }
  } else if (baseId.startsWith('tvmaze:')) {
    const numId = baseId.split(':').pop();
    if (/^\d+$/.test(numId)) {
      const show = await tvmaze.showById(numId);
      if (show) {
        title = show.name;
        year = show.premiered ? show.premiered.slice(0, 4) : '';
        Object.assign(traits, tvmazeTraits(show));
      }
    }
  }

  if (!title) return null;
  if (altTitle === title) altTitle = null;
  return { title, altTitle, year, season, episode, mediaType, ...traits };
}

function buildQuery(resolved, titleOverride) {
  const { year, season, episode, mediaType } = resolved;
  const title = titleOverride || resolved.title;
  if (mediaType === 'series' && season != null && episode != null) {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');
    return `${title} S${s}E${e}`;
  }
  return year ? `${title} ${year}` : title;
}

/** Filtro de relevancia: evita secuelas/episodios equivocados. */
function isRelevant(hit, resolved, queryTitle) {
  const name = normalizeText(hit.title);
  if (!name) return false;
  if (resolved.mediaType === 'series' && resolved.season != null && resolved.episode != null) {
    const s = String(resolved.season).padStart(2, '0');
    const e = String(resolved.episode).padStart(2, '0');
    const flat = name.replace(/\s+/g, '');
    return (
      flat.includes(`s${s}e${e}`) ||
      flat.includes(`s${s}`) || // pack de temporada completa
      name.includes(`season ${resolved.season}`) ||
      name.includes(`temporada ${resolved.season}`)
    );
  }
  const titleTokens = normalizeText(queryTitle || resolved.title)
    .split(' ')
    .filter((t) => t.length > 1);
  const nameTokens = new Set(name.split(' '));
  const matched = titleTokens.filter((t) => nameTokens.has(t)).length;
  const ratio = titleTokens.length ? matched / titleTokens.length : 1;
  // Año declarado y distinto → casi seguro es otra película (secuela/remake).
  const years = name.match(/\b(19|20)\d{2}\b/g) || [];
  const yearOk = !resolved.year || !years.length || years.includes(resolved.year);
  if (resolved.year && resolved.mediaType === 'movie' && years.length && !yearOk) return false;
  if (ratio >= 1) return true;
  // Títulos largos a veces difieren por subtítulos/artículos: aceptamos
  // coincidencia parcial fuerte si el año (cuando consta) coincide.
  return ratio >= 0.6 && yearOk && matched >= 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsers por proveedor (exportados para tests offline)
// ─────────────────────────────────────────────────────────────────────────────
function parseKnaben(data) {
  const hits = (data && (data.hits || data.results)) || [];
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((h) => h && (h.hash || h.magnetUrl))
    .map((h) => ({
      provider: 'knaben',
      title: h.title || h.name || '',
      infoHash: String(h.hash || '').toLowerCase() || null,
      magnet: h.magnetUrl || null,
      seeders: Number(h.liveSeeders ?? h.seeders) || 0,
      peers: Number(h.livePeers ?? h.peers) || 0,
      size: Number(h.bytes ?? h.size) || 0,
    }));
}

function parseBlackHoleBay(data) {
  const results = (data && data.results) || [];
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => r && (r.info_hash || r.magnet))
    .map((r) => ({
      provider: 'blackholebay',
      title: r.name || r.title || '',
      infoHash: r.info_hash ? String(r.info_hash).toLowerCase() : null,
      magnet: r.magnet || null,
      seeders: Number(r.seeders) || 0,
      peers: Number(r.leechers ?? r.peers) || 0,
      size: Number(r.size) || 0,
    }));
}

function torznabAttr(block, name) {
  const m = block.match(new RegExp(`name="${name}"\\s+value="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function parseTorlock(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items
    .map((block) => {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const magnetMatch = block.match(/magnet:\?[^"<\s]+/i);
      const magnet = magnetMatch ? decodeXml(magnetMatch[0]) : null;
      let infoHash = torznabAttr(block, 'infohash');
      if (!infoHash && magnet) {
        const m = magnet.match(/urn:btih:([a-zA-Z0-9]+)/i);
        if (m) infoHash = m[1];
      }
      if (!magnet && !infoHash) return null;
      const sizeTag = block.match(/<size>([\d.]+)<\/size>/i) || block.match(/length="(\d+)"/i);
      return {
        provider: 'torlock',
        title: titleMatch ? decodeXml(titleMatch[1]).trim() : '',
        infoHash: infoHash ? String(infoHash).toLowerCase() : null,
        magnet,
        seeders: Number(torznabAttr(block, 'seeders')) || 0,
        peers: Number(torznabAttr(block, 'peers')) || 0,
        size: sizeTag ? Number(sizeTag[1]) || 0 : 0,
      };
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda por proveedor (nunca lanza: [] ante cualquier error)
// ─────────────────────────────────────────────────────────────────────────────
async function searchKnaben(query) {
  const url = new URL('https://api.knaben.org/v2/search');
  url.searchParams.set('q', query);
  url.searchParams.set('o', 'seeders');
  url.searchParams.set('d', 'desc');
  url.searchParams.set('s', String(PER_PROVIDER_LIMIT));
  const data = await fetchJson(url.toString(), { timeoutMs: 9000, headers: PROVIDER_HEADERS });
  return parseKnaben(data);
}

async function searchTorlock(query, resolved) {
  const url = new URL('https://www.torlock.com/torznab/api');
  if (resolved.mediaType === 'series') {
    url.searchParams.set('t', 'tvsearch');
    if (resolved.season != null) url.searchParams.set('season', String(resolved.season));
    if (resolved.episode != null) url.searchParams.set('ep', String(resolved.episode));
  } else {
    url.searchParams.set('t', 'movie-search');
  }
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(PER_PROVIDER_LIMIT));
  const xml = await fetchText(url.toString(), { timeoutMs: 9000, headers: PROVIDER_HEADERS });
  return parseTorlock(xml);
}

async function searchBlackHoleBay(query) {
  const url = new URL('https://theblackholebay.lol/api/search');
  url.searchParams.set('q', query);
  url.searchParams.set('category', '200'); // 200 = Vídeo (películas y series)
  const data = await fetchJson(url.toString(), { timeoutMs: 9000, headers: PROVIDER_HEADERS });
  return parseBlackHoleBay(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nyaa (anime y live action asiático)
//
// Nyaa no nombra los lanzamientos como los indexadores generales: usa el
// título en romaji («Sousou no Frieren»), numeración de fansub
// («Título - 05», «Título S2 - 05») y lotes por temporada. Por eso lleva
// consulta y filtro de relevancia propios.
// ─────────────────────────────────────────────────────────────────────────────
// Idioma original (código de TMDB o nombre en inglés de TVMaze) y países
// (Cinemeta) de lo que se publica en Nyaa.
const NYAA_LANGUAGES = new Set([
  'ja', 'ko', 'zh', 'cn', 'th',
  'japanese', 'korean', 'chinese', 'mandarin', 'cantonese', 'thai',
]);
const NYAA_COUNTRIES = /japan|korea|china|hong kong|taiwan|thailand/i;
// Países de TMDB cuyos títulos alternativos son romanizaciones del original.
const NYAA_ORIGIN_COUNTRIES = { ja: ['JP'], ko: ['KR'], zh: ['CN', 'TW', 'HK'], cn: ['HK', 'CN'], th: ['TH'] };
const NYAA_MAX_TITLES = 4;
const NYAA_MAX_PREFIX = 15; // el índice de Nyaa guarda prefijos de hasta 15 caracteres
const ROMANIZED_TYPE = /romaji|romani[sz]|translit/i;
const NON_LATIN_LETTER = /[^\P{L}\p{Script=Latin}]/u;

function isEpisodeRequest(resolved) {
  return resolved.mediaType === 'series' && resolved.season != null && resolved.episode != null;
}

/** Nyaa solo aporta en anime y producciones asiáticas: el resto no se consulta. */
function nyaaEligible(resolved) {
  if (resolved.language) return NYAA_LANGUAGES.has(String(resolved.language).toLowerCase());
  if (resolved.country) return NYAA_COUNTRIES.test(resolved.country);
  return true; // origen desconocido: se consulta igualmente
}

/**
 * Clave para comparar títulos: como normalizeText, pero «Journey's» =
 * «Journeys» y sin el artículo inicial («The Title» = «Title»).
 */
function nyaaKey(text) {
  return normalizeText(String(text || '').replace(/['’‘`´]/g, '')).replace(/^(?:the|an?) (?=\S)/, '');
}

/**
 * Palabras de un título para el buscador de Nyaa, que casa cada palabra
 * por prefijo. Se quedan en letras y números ASCII, así que no puede
 * colarse ningún operador de la sintaxis de búsqueda:
 *  - «Journey's» → «Journey»: encuentra Journey's, Journeys y Journey`s.
 *  - «SPY×FAMILY» → «SPY»: encuentra «Spy x Family» y «SPYxFAMILY».
 *  - «K-On!» → «K On», «Re:ZERO» → «Re ZERO»: si el primer trozo es muy
 *    corto se añaden los siguientes para que la búsqueda no sea genérica.
 */
function nyaaQueryWords(title) {
  const raws = String(title || '').split(/\s+/).filter(Boolean);
  // Sin el artículo inicial: muchos lanzamientos lo omiten.
  if (raws.length > 1 && /^(?:the|an?)$/i.test(raws[0])) raws.shift();
  const words = [];
  for (const raw of raws) {
    const parts = raw
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .split(/['’‘`´]/)[0]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
    let length = 0;
    for (const part of parts) {
      words.push(part.slice(0, NYAA_MAX_PREFIX));
      length += part.length;
      if (length >= 3) break;
    }
  }
  return words;
}

/** Títulos romanizados (romaji…) de la respuesta `alternative_titles` de TMDB. */
function romanizedTitles(data, language) {
  const list = (data && (data.results || data.titles)) || [];
  if (!Array.isArray(list)) return [];
  const countries = NYAA_ORIGIN_COUNTRIES[String(language || '').toLowerCase()] || [];
  const isRomanized = (entry) => ROMANIZED_TYPE.test(entry.type || '');
  return list
    .filter((entry) => entry && typeof entry.title === 'string'
      && /^[\x20-\x7e]+$/.test(entry.title) // solo ASCII, como lo escribe un fansub
      && nyaaKey(entry.title).length >= 5
      && !findSeasonMarker(entry.title)      // «Título 2nd Season» es de una temporada concreta
      && (countries.includes(entry.iso_3166_1) || isRomanized(entry)))
    .sort((a, b) => Number(isRomanized(b)) - Number(isRomanized(a)))
    .map((entry) => entry.title);
}

/** Variantes del título para buscar y comparar: inglés, original y romanizadas. */
async function nyaaTitles(resolved) {
  const titles = [resolved.title, resolved.altTitle];
  if (resolved.tmdbId && resolved.tmdbType) {
    const data = await tmdb.tmdbGet(
      `/${resolved.tmdbType}/${resolved.tmdbId}/alternative_titles`, {}, 7 * 24 * 3600, 'en'
    );
    titles.push(...romanizedTitles(data, resolved.language));
  }
  const seen = new Set();
  return titles.filter((title) => {
    // Un título a medias en otro alfabeto («進撃の巨人 The Final Season»)
    // dejaría una variante genérica («the final season»): se descarta.
    if (!title || NON_LATIN_LETTER.test(title)) return false;
    const key = nyaaKey(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, NYAA_MAX_TITLES);
}

/** 2 → «2nd», 3 → «3rd», 11 → «11th». */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/**
 * Consulta para el buscador de Nyaa (sintaxis en https://nyaa.si/help;
 * comportamiento real en nyaa/search.py de github.com/nyaadevs/nyaa):
 *  - Palabras sueltas: cada una casa por prefijo y se exigen todas;
 *    «(a b)|(c d)» pide un grupo u otro. Así van las variantes del título.
 *  - "Literales" entre comillas: subcadena exacta del nombre (sin distinguir
 *    mayúsculas). Un grupo "a"|"b"|"c" exige al menos una y se combina con
 *    lo demás como condición aparte; no se puede mezclar con palabras
 *    sueltas dentro de un mismo «o». Así van las marcas de episodio y lote.
 *
 * Para un episodio se piden, en una sola consulta, sus dos nombres
 * habituales y los lotes de su temporada. Para una película, solo el título.
 */
function buildNyaaQuery(resolved, titles) {
  const groups = new Map();
  for (const title of titles) {
    const words = nyaaQueryWords(title).join(' ');
    if (words && !groups.has(words.toLowerCase())) groups.set(words.toLowerCase(), `(${words})`);
  }
  if (!groups.size) return '';
  const titleQuery = [...groups.values()].join('|');
  if (!isEpisodeRequest(resolved)) return titleQuery;

  const { season, episode } = resolved;
  const s = String(season).padStart(2, '0');
  const e = String(episode).padStart(2, '0');
  const markers = [
    `S${s}E${e}`,         // «Título S01E05»
    ` - ${e}`, `_-_${e}`, // «Título - 05», «Título S2 - 05»
    '01-', '01~', '01 ~', // lote por rango: «(01-28)», «01 ~ 28»
  ];
  // Lotes de la temporada. Las marcas se piden con su separador porque,
  // sueltas, casan también con los episodios: «S01» está en «S01E07» y
  // «S2» o «Season 2» en «Título S2 - 07» o «… (Título Season 2)».
  for (const n of new Set([String(season), s])) {
    markers.push(`Season ${n} `, `(Season ${n}`);                              // «Season 1 [BD]», «(Season 1)»
    markers.push(`S${n})`, `S${n}]`);                                          // «(S01)», «[S1]»
    if (n.length > 1 || resolved.animation === false) markers.push(`S${n} `);  // «Título S01 [BD]»
    else markers.push(`S${n} [`, `S${n} (`);                                   // «Título S2 [BD]», no «S2 - 07»
    if (n.length > 1) markers.push(`S${n}.`);                                  // «Título.S01.1080p»
  }
  if (season > 1) markers.push(`${ordinal(season)} Season [`, `${ordinal(season)} Season (`); // «2nd Season [BD]»
  // Lotes sin marca de temporada: «[Grupo] Título [BD 1080p]», «(Batch)».
  // «BD» va con su separador: suelto casaría con los CRC («[A7BD4B57]»).
  markers.push('Batch', 'Complete', ' BD', '[BD', '(BD', 'Bluray', 'Blu-ray', 'DVD');
  return `${[...new Set(markers)].map((marker) => `"${marker}"`).join('|')} ${titleQuery}`;
}

// Marcas de temporada en el nombre de un lanzamiento, de más a menos específica.
const SEASON_MARKERS = [
  /\bS(\d{1,2})\s*[-~+&]\s*S(\d{1,2})\b/i,                        // S01-S03
  /\bSeasons?\s*(\d{1,2})(?:-|\s*[~+&]\s*|\s+to\s+)(\d{1,2})\b/i, // Season 1-3, Seasons 1 & 2
  /\bS(\d{1,2})\b/i,                                              // S2, S02
  /\b(?:Season|Temporada|Saison)\s*(\d{1,2})\b/i,                 // Season 2, Temporada 2
  /\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,                       // 2nd Season
];
// «S01E05», «S01E01-E12», «S01 E01-E14» (lote por tramos)
const EXPLICIT_EPISODE = /\bS(\d{1,2})[\s._-]*E(\d{1,4})(?:\s*[-~]\s*E?(\d{1,4})(?![\dA-Za-z]))?/i;
// Estilo fansub: «Título - 05», «Título - 05v2», «Título - 01 ~ 28», «Título Ep 05»
const FANSUB_EPISODE = new RegExp(
  '^(.*?)(?:\\s[-–]\\s+(?:(?:episode|ep|e)\\.?\\s*)?|\\s+(?:episode|ep)\\.?\\s*)' +
  '(\\d{1,4})(?:v\\d+)?(?:\\s*[-~]\\s*(\\d{1,4})(?:v\\d+)?)?(?=$|[\\s\\[(]|\\.(?:mkv|mp4|avi)\\b)',
  'i'
);
const LEADING_TAGS = /^(?:\s*\[[^\]]*\])+/; // «[Grupo][…]» al principio del nombre
// Secuela numerada sin la palabra «Season»: «Título II», «Título 2 (Otro título)».
const SEQUEL_SUFFIX = /^(.*\S)\s+(II|III|IV|V|VI|VII|VIII|IX|X|[1-9])((?:\s*(?:\([^)]*\)|\[[^\]]*\]))*\s*(?:[[(][^\])]*)?)$/;
const ROMAN_NUMERALS = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
const EPISODE_RANGE = /(\d{1,3})\s*[-~]\s*(\d{1,3})(?=[\])\s]|$)/; // «01-28», «01 ~ 28»
const PACK_WORDS = /\b(?:batch|complete|blu-?ray|bd|dvd)/i;
const MOVIE_COLLECTION = /\b(?:collection|trilogy|tetralogy|filmography|anthology|movies|films)\b/i;

/** Primera marca de temporada de un texto: { from, to, index, length } o null. */
function findSeasonMarker(text) {
  let best = null;
  for (const re of SEASON_MARKERS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) {
      const from = Number(m[1]);
      best = { from, to: m[2] ? Number(m[2]) : from, index: m.index, length: m[0].length };
    }
  }
  return best;
}

/**
 * ¿La parte del nombre anterior a la marca de episodio/temporada es el
 * título buscado? Compara por igualdad (no por palabras sueltas) para no
 * confundir una serie con sus derivadas («Título: Otra Historia - 05»).
 * `keys` son las variantes del título pasadas por nyaaKey.
 */
function nyaaTitleMatches(titlePart, name, keys, year) {
  const withoutGroups = (text) => text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const text = String(titlePart || '')
    .replace(LEADING_TAGS, '')
    .replace(/[[(][^\])]*$/, ''); // paréntesis que abre la propia marca: «(Season 01)»
  const asides = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]); // «(Otro título)», «(2023)»
  let main = withoutGroups(text);
  const years = asides.filter((aside) => /^\s*(?:19|20)\d{2}\s*$/.test(aside)).map(Number);
  if (!keys.has(nyaaKey(main))) {
    const tail = main.match(/^(.*\D)((?:19|20)\d{2})\W*$/); // «Título 2020», «Título.2020.»
    if (tail) {
      main = tail[1];
      years.push(Number(tail[2]));
    }
  }
  // Mismo nombre y otro año: es otra versión (p. ej. un remake).
  if (year && years.length && !years.some((y) => Math.abs(y - year) <= 1)) return false;
  const aliases = String(name || '').split('|').slice(1).map(withoutGroups); // «… | Otro título»
  return [main, ...main.split(/[|/]/), ...asides, ...aliases].some((part) => keys.has(nyaaKey(part)));
}

/**
 * Filtro de relevancia de Nyaa para un episodio. Prima la precisión: ante
 * la duda (numeración absoluta, secuelas con subtítulo propio…) descarta.
 */
function nyaaEpisodeMatches(rawName, resolved, keys) {
  const { season, episode } = resolved;
  const name = String(rawName || '').replace(/_/g, ' ');
  // En las secuelas el año del nombre suele ser el de esa temporada, no el de la serie.
  const year = season === 1 ? Number(resolved.year) || null : null;
  const titleOk = (part) => nyaaTitleMatches(part, name, keys, year);
  const inRange = (from, to) => {
    const first = Number(from);
    const last = to != null && Number(to) >= first ? Number(to) : first;
    return first <= episode && episode <= last;
  };
  // Título seguido, quizá, de su temporada: «Título S2», «Título 2nd Season»,
  // «Título II». Sin marca, un fansub numera la 1ª temporada (o en absoluto,
  // y eso no se adivina).
  const seasonTitleOk = (text) => {
    const marker = findSeasonMarker(text);
    if (marker) {
      if (season < marker.from || season > marker.to) return false;
      return titleOk(`${text.slice(0, marker.index)} ${text.slice(marker.index + marker.length)}`);
    }
    const sequel = text.match(SEQUEL_SUFFIX);
    const number = sequel ? ROMAN_NUMERALS[sequel[2]] || Number(sequel[2]) : 0;
    if (number === season && titleOk(`${sequel[1]} ${sequel[3]}`)) return true; // «Título II» = 2ª temporada
    if (season !== 1) return false;
    // 1ª temporada: si el nombre acaba en número, tiene que ser parte del
    // propio título («Lupin III») y no la marca de una secuela.
    return sequel ? titleOk(`${sequel[1]} ${sequel[2]}`) : titleOk(text);
  };

  const explicit = name.match(EXPLICIT_EPISODE);
  if (explicit) {
    if (Number(explicit[1]) !== season || !inRange(explicit[2], explicit[3])) return false;
    const before = name.slice(0, explicit.index);
    return findSeasonMarker(before) ? seasonTitleOk(before) : titleOk(before);
  }
  const fansub = name.match(FANSUB_EPISODE);
  if (fansub) return inRange(fansub[2], fansub[3]) && seasonTitleOk(fansub[1]);

  // Sin número de episodio: lote de temporada.
  const marker = findSeasonMarker(name);
  if (marker) {
    if (season < marker.from || season > marker.to) return false;
    // «Título S2 (01-10)»: lote parcial, solo vale si incluye el episodio.
    const partial = name.slice(marker.index + marker.length).match(new RegExp(`^[\\s[(]*${EPISODE_RANGE.source}`));
    return (!partial || inRange(partial[1], partial[2])) && titleOk(name.slice(0, marker.index));
  }
  const range = name.match(new RegExp(`[[(\\s]${EPISODE_RANGE.source}`)); // «Título (01-28)»
  if (range) return inRange(range[1], range[2]) && seasonTitleOk(name.slice(0, range.index));
  // Lote sin temporada ni rango: «[Grupo] Título [BD 1080p]», «Título 1080p BluRay».
  const rest = name.replace(LEADING_TAGS, '');
  if (!PACK_WORDS.test(rest)) return false;
  return seasonTitleOk(rest.slice(0, rest.search(new RegExp(`\\b\\d{3,4}p|${PACK_WORDS.source}`, 'i'))));
}

/** ¿El nombre es de un episodio o de una temporada (y no de una película)? */
function nyaaLooksEpisodic(rawName) {
  const name = String(rawName || '').replace(/_/g, ' ');
  if (EXPLICIT_EPISODE.test(name) || findSeasonMarker(name)) return true;
  const fansub = name.match(FANSUB_EPISODE);
  return Boolean(fansub) && !/^(?:19|20)\d{2}$/.test(fansub[2]); // «Título - 2021» es un año
}

/** Relevancia de un lanzamiento de Nyaa frente a las variantes del título. */
function nyaaIsRelevant(name, resolved, titles) {
  if (isEpisodeRequest(resolved)) {
    return nyaaEpisodeMatches(name, resolved, new Set(titles.map(nyaaKey)));
  }
  if (resolved.mediaType === 'movie') {
    // La serie de la misma franquicia comparte las palabras del título
    // («Título 0» frente a «Título - 05»): fuera episodios y temporadas.
    if (nyaaLooksEpisodic(name)) return false;
    // Fuera también las colecciones: con varias películas en un torrent,
    // Stremio no sabría cuál reproducir.
    if (MOVIE_COLLECTION.test(name) && !titles.some((title) => MOVIE_COLLECTION.test(title))) return false;
  }
  return titles.some((title) => isRelevant({ title: name }, resolved, title));
}

/** "1.4 GiB" / "741.0 MiB" → bytes. */
function parseSize(text) {
  const m = String(text || '').match(/([\d.]+)\s*(bytes?|[kmgt]i?b)/i);
  if (!m) return 0;
  const unit = m[2][0].toLowerCase();
  return Math.round(parseFloat(m[1]) * 1024 ** 'bkmgt'.indexOf(unit)) || 0;
}

function parseNyaa(data) {
  const items = (data && data.data) || [];
  if (!Array.isArray(items)) return [];
  return items
    .map((t) => {
      if (!t || !t.magnet) return null;
      // Solo vídeo: fuera AMV, vídeos promocionales, audio, manga, software…
      const category = String(t.category || '').toLowerCase();
      if (!/^(anime|live action)\b/.test(category) || /music video|promotional/.test(category)) return null;
      const hash = String(t.magnet).match(/urn:btih:([a-f0-9]{40})(?![a-z0-9])/i);
      if (!hash) return null;
      return {
        provider: 'nyaa',
        title: String(t.title || '').trim().slice(0, 300), // Nyaa limita los nombres a 255 caracteres
        infoHash: hash[1].toLowerCase(),
        magnet: t.magnet,
        seeders: Number(t.seeders) || 0,
        peers: Number(t.leechers) || 0,
        size: parseSize(t.size),
      };
    })
    .filter(Boolean);
}

/** 2ª pasada de búsqueda (título original): ver searchStreams. */
function isAltPass(resolved, queryTitle) {
  return Boolean(queryTitle) && queryTitle !== resolved.title;
}

async function searchNyaa(query, resolved, queryTitle) {
  // Todas las variantes del título van ya en la consulta de la 1ª pasada.
  if (isAltPass(resolved, queryTitle)) return { skipped: 'títulos alternativos ya incluidos en la 1ª búsqueda' };
  if (!nyaaEligible(resolved)) return { skipped: 'solo anime y producciones asiáticas' };
  if (isEpisodeRequest(resolved) && !(resolved.season >= 1 && resolved.episode >= 1)) {
    return { skipped: 'los especiales (temporada 0) no se numeran igual en Nyaa' };
  }
  const titles = await nyaaTitles(resolved);
  const nyaaQuery = buildNyaaQuery(resolved, titles);
  if (!nyaaQuery) return { skipped: 'sin título en alfabeto latino' };

  const url = new URL(`${config.nyaaApiUrl}/nyaa`);
  url.searchParams.set('q', nyaaQuery);
  if (resolved.animation != null) url.searchParams.set('category', resolved.animation ? 'anime' : 'live_action');
  url.searchParams.set('sort', 'seeders');
  url.searchParams.set('order', 'desc');
  const data = await fetchJson(url.toString(), { timeoutMs: 9000, headers: PROVIDER_HEADERS });
  if (!data || !Array.isArray(data.data)) throw new Error('respuesta inesperada de la API de Nyaa');
  const hits = parseNyaa(data).map((hit) => ({ ...hit, relevant: nyaaIsRelevant(hit.title, resolved, titles) }));
  return { hits, query: nyaaQuery };
}

// ─────────────────────────────────────────────────────────────────────────────
// YTS (solo películas)
// ─────────────────────────────────────────────────────────────────────────────
// La API no da magnets: se montan con el hash y los trackers que recomienda
// su documentación (https://yts.gg/api).
const YTS_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://open.demonii.com:1337/announce',
  'https://tracker.moeblog.cn:443/announce',
  'udp://open.dstud.io:6969/announce',
  'udp://tracker.srv00.com:6969/announce',
  'https://tracker.zhuqiy.com:443/announce',
  'https://tracker.pmman.tech:443/announce',
];
const YTS_TRACKER_PARAMS = YTS_TRACKERS.map((tracker) => `&tr=${encodeURIComponent(tracker)}`).join('');
const YTS_SOURCES = { bluray: 'BluRay', web: 'WEBRip' };

function parseYts(data) {
  const movies = (data && data.data && data.data.movies) || [];
  if (!Array.isArray(movies)) return [];
  const hits = [];
  for (const movie of movies) {
    if (!movie || !Array.isArray(movie.torrents)) continue;
    const name = movie.title_long || [movie.title, movie.year ? `(${movie.year})` : ''].filter(Boolean).join(' ');
    for (const t of movie.torrents) {
      if (!t || !/^[a-f0-9]{40}$/i.test(String(t.hash || ''))) continue;
      const infoHash = String(t.hash).toLowerCase();
      // YTS no da nombre de release: se compone al estilo de los suyos,
      // «Dune (2021) [1080p] [BluRay] [x264] [5.1]».
      const tags = [
        t.quality,
        YTS_SOURCES[String(t.type || '').toLowerCase()] || t.type,
        t.video_codec,
        String(t.bit_depth) === '10' ? '10bit' : '',
        t.audio_channels,
      ].filter(Boolean).map((tag) => `[${tag}]`);
      hits.push({
        provider: 'yts',
        imdbId: movie.imdb_code || null,
        title: [name, ...tags].join(' '),
        infoHash,
        magnet: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}${YTS_TRACKER_PARAMS}`,
        seeders: Number(t.seeds) || 0,
        peers: Number(t.peers) || 0,
        size: Number(t.size_bytes) || 0,
      });
    }
  }
  return hits;
}

async function searchYts(query, resolved, queryTitle) {
  if (resolved.mediaType !== 'movie') return { skipped: 'solo películas' };
  const { imdbId } = resolved;
  // Por IMDb id el resultado es exacto: no hay nada que reintentar con otro título.
  if (imdbId && isAltPass(resolved, queryTitle)) return { skipped: 'ya consultado por IMDb id' };

  const url = new URL(`${config.ytsApiUrl}/list_movies.json`);
  url.searchParams.set('query_term', imdbId || queryTitle || resolved.title);
  const data = await fetchJson(url.toString(), { timeoutMs: 9000, headers: PROVIDER_HEADERS });
  if (!data || data.status !== 'ok' || !data.data) throw new Error('respuesta inesperada de la API de YTS');
  const hits = parseYts(data);
  if (!imdbId) return hits; // búsqueda por título: se filtra con isRelevant como el resto
  return hits.filter((hit) => hit.imdbId === imdbId).map((hit) => ({ ...hit, relevant: true }));
}

// Cada buscador recibe (query, resolved, queryTitle) y devuelve sus hits:
// un array, o { hits, query } si usa una consulta propia. Un hit puede traer
// `relevant` ya decidido; si no, se filtra con isRelevant. También puede
// devolver { skipped: 'motivo' } cuando el proveedor no aplica al título.
const SEARCHERS = {
  knaben: (query) => searchKnaben(query),
  torlock: (query, resolved) => searchTorlock(query, resolved),
  blackholebay: (query) => searchBlackHoleBay(query),
  nyaa: searchNyaa,
  yts: searchYts,
};

/** Proveedores activos: intersección de la config global y la del usuario. */
function activeProviders(cfg) {
  const global = Array.isArray(config.streamProviders) && config.streamProviders.length
    ? config.streamProviders
    : PROVIDER_KEYS;
  let keys = global.filter((k) => PROVIDER_KEYS.includes(k));
  if (cfg && Array.isArray(cfg.streams)) {
    keys = keys.filter((k) => cfg.streams.includes(k));
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrada principal: /stream/:type/:id.json
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Consulta los proveedores con una query y devuelve los hits relevantes
 * ya deduplicados por infoHash. `report` (opcional) recoge por proveedor
 * cuántos resultados brutos/relevantes hubo, qué error ocurrió o por qué
 * no se consultó.
 */
async function runProviders(keys, query, resolved, queryTitle, report) {
  const settled = await Promise.allSettled(keys.map((k) => SEARCHERS[k](query, resolved, queryTitle)));
  const byHash = new Map();
  settled.forEach((result, i) => {
    const key = keys[i];
    if (result.status !== 'fulfilled') {
      const message = (result.reason && result.reason.message) || 'error desconocido';
      console.error(`[Streams] ${key} falló para "${query}" ->`, message);
      if (report) report[key] = { ok: false, error: message };
      return;
    }
    const found = Array.isArray(result.value) ? { hits: result.value } : result.value || {};
    if (found.skipped) {
      if (report) report[key] = { ok: true, skipped: found.skipped };
      return;
    }
    const hits = found.hits || [];
    let relevant = 0;
    for (const hit of hits) {
      const matches = typeof hit.relevant === 'boolean' ? hit.relevant : isRelevant(hit, resolved, queryTitle);
      if (!hit.infoHash || !matches) continue;
      relevant++;
      const prev = byHash.get(hit.infoHash);
      if (!prev) {
        byHash.set(hit.infoHash, { ...hit, providers: [hit.provider] });
      } else {
        if (!prev.providers.includes(hit.provider)) prev.providers.push(hit.provider);
        prev.seeders = Math.max(prev.seeders, hit.seeders);
        prev.peers = Math.max(prev.peers, hit.peers);
        if (!prev.magnet && hit.magnet) prev.magnet = hit.magnet;
        if (!prev.size && hit.size) prev.size = hit.size;
      }
    }
    if (report) {
      report[key] = { ok: true, raw: hits.length, relevant };
      if (found.query) report[key].query = found.query; // consulta propia del proveedor
    }
  });
  return [...byHash.values()];
}

/**
 * Hits relevantes → lista compacta que se cachea: los más compartidos
 * primero, cada uno ya clasificado (calidad visible y etiquetas de filtro).
 */
function buildPool(hits, resolved) {
  const titles = [resolved.title, resolved.altTitle];
  const limit = Math.max(STREAM_POOL_LIMIT, config.streamMaxResults || 0);
  return hits
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, limit)
    .map((hit) => {
      const { quality, tags } = classify(hit.title, titles);
      return {
        title: hit.title,
        infoHash: hit.infoHash,
        sources: magnetSources(hit.magnet, hit.infoHash),
        seeders: hit.seeders,
        peers: hit.peers,
        size: hit.size,
        quality,
        tags,
      };
    });
}

/** Entrada de la lista → objeto stream de Stremio. */
function toStream(hit) {
  // Sin nombres de proveedores ni de fuentes en pantalla: solo se ve
  // calidad, tamaño y seeders (el proveedor queda para uso interno).
  const details = [
    hit.size ? `💾 ${formatSize(hit.size)}` : '',
    `👤 ${hit.seeders}`,
    hit.peers ? `⬇ ${hit.peers}` : '',
  ].filter(Boolean).join('  ');
  return {
    name: `🧲 ${hit.quality || 'Torrent'}`,
    title: `${hit.title}\n${details}`,
    infoHash: hit.infoHash,
    sources: hit.sources,
    behaviorHints: { bingeGroup: `catalogos-plus-${hit.infoHash.slice(0, 8)}` },
  };
}

async function searchStreams(type, id, cfg, status = {}) {
  const keys = activeProviders(cfg);
  if (!keys.length) return [];

  const resolved = await resolveTitle(type, id);
  if (!resolved) {
    console.error(`[Streams] Sin título resoluble para ${type} ${id} (¿TMDB configurado?)`);
    status.partial = true;
    return [];
  }

  // La clave no incluye los filtros del usuario: se cachea la búsqueda entera.
  const cacheKey = `streams:${keys.join(',')}:${type}:${decodeURIComponent(String(id || ''))}`;
  let pool = cache.get(cacheKey);
  if (!pool) {
    // 1ª pasada con el título en inglés; si ningún proveedor devuelve
    // resultados relevantes, 2ª pasada con el título original.
    const report = {};
    let hits = await runProviders(keys, buildQuery(resolved), resolved, resolved.title, report);
    let failed = Object.values(report).some((entry) => !entry.ok);
    if (!hits.length && resolved.altTitle) {
      const altReport = {};
      hits = await runProviders(
        keys, buildQuery(resolved, resolved.altTitle), resolved, resolved.altTitle, altReport
      );
      failed ||= Object.values(altReport).some((entry) => !entry.ok);
    }
    pool = buildPool(hits, resolved);
    // Un fallo temporal no debe convertir resultados incompletos en caché de una hora.
    if (!failed) cache.set(cacheKey, pool, STREAM_TTL_SECONDS);
    else status.partial = true;
  }

  // Preferencias del usuario (qué ocultar, tamaño máximo, orden) y recorte final.
  const max = config.streamMaxResults || 30;
  return applyPrefs(pool, cfg).slice(0, max).map(toStream);
}

/**
 * Diagnóstico para /internal/streams-test.json: explica, para un id,
 * qué título se resolvió, qué se buscó y qué respondió cada proveedor.
 * Útil cuando Stremio no muestra streams (título no resuelto, proveedor
 * caído/bloqueado o filtro de relevancia demasiado estricto).
 */
async function diagnose(type, id, cfg) {
  const keys = activeProviders(cfg);
  if (!keys.length) {
    return {
      ok: false,
      stage: 'providers',
      message: 'Ningún proveedor de contenido activo (STREAM_PROVIDERS / config de usuario).',
      type, id: String(id || ''), providers: keys,
    };
  }
  const resolved = await resolveTitle(type, id).catch(() => null);
  if (!resolved) {
    return {
      ok: false,
      stage: 'resolveTitle',
      message:
        'No se pudo resolver el título. Revisa TMDB_API_KEY/TMDB_ACCESS_TOKEN; ' +
        'como respaldo se consulta TVMaze (series) y Cinemeta.',
      type, id: String(id || ''), providers: keys,
    };
  }
  const query = buildQuery(resolved);
  const report = {};
  const hits = await runProviders(keys, query, resolved, resolved.title, report);
  const result = {
    ok: hits.length > 0,
    stage: 'search',
    type,
    id: String(id || ''),
    resolved: {
      title: resolved.title,
      altTitle: resolved.altTitle,
      year: resolved.year,
      season: resolved.season,
      episode: resolved.episode,
      imdbId: resolved.imdbId,
      animation: resolved.animation,
      language: resolved.language || resolved.country,
    },
    query,
    providers: report,
    totalStreams: hits.length,
  };
  let found = hits;
  if (!hits.length && resolved.altTitle) {
    const altReport = {};
    const altHits = await runProviders(
      keys, buildQuery(resolved, resolved.altTitle), resolved, resolved.altTitle, altReport
    );
    result.altQuery = buildQuery(resolved, resolved.altTitle);
    result.altProviders = altReport;
    result.totalStreams = altHits.length;
    result.ok = altHits.length > 0;
    found = altHits;
  }
  // Cuántos resultados caen en cada categoría de los filtros de /configure.
  result.categories = {};
  for (const hit of buildPool(found, resolved)) {
    for (const tag of hit.tags) result.categories[tag] = (result.categories[tag] || 0) + 1;
  }
  return result;
}

module.exports = {
  PROVIDERS,
  PROVIDER_KEYS,
  activeProviders,
  searchStreams,
  diagnose,
  resolveTitle,
  // exportados para tests offline
  parseKnaben,
  parseTorlock,
  parseBlackHoleBay,
  parseNyaa,
  parseYts,
  parseStreamId,
  buildQuery,
  buildNyaaQuery,
  isRelevant,
  nyaaIsRelevant,
  formatSize,
};
