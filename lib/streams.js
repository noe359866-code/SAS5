'use strict';

/**
 * Proveedores de contenido (streams torrent) para Stremio.
 *
 * Tres indexadores públicos, sin clave ni registro:
 *  - Knaben        → https://knaben.org/api/v2/        (API JSON v2)
 *  - Torlock       → https://www.torlock.com/apis.html (feed Torznab XML)
 *  - BlackHoleBay  → https://theblackholebay.lol/api   (API JSON)
 *
 * Flujo: Stremio pide /stream/:type/:id.json con un IMDb id
 * (tt…, tt…:temporada:episodio en series). Resolvemos título+año con
 * TMDB (o TVMaze en series), buscamos en los proveedores activos en
 * paralelo, deduplicamos por infoHash y devolvemos streams magnet
 * ordenados por seeders. Cada proveedor es independiente: si uno
 * falla o tarda, los demás siguen respondiendo.
 *
 * Selección de proveedores:
 *  - Global: variable STREAM_PROVIDERS="knaben,torlock,blackholebay"
 *  - Por usuario: campo `streams` de la config de /configure.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson, fetchText } = require('./http');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');

const PROVIDERS = [
  { key: 'knaben', name: 'Knaben', url: 'https://knaben.org/api/v2/' },
  { key: 'torlock', name: 'Torlock', url: 'https://www.torlock.com/apis.html' },
  { key: 'blackholebay', name: 'BlackHoleBay', url: 'https://theblackholebay.lol/api' },
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

function qualityOf(title) {
  const m = String(title || '').match(/\b(2160p|1440p|1080p|720p|576p|480p|360p|4k|uhd)\b/i);
  if (!m) return '';
  const q = m[1].toLowerCase();
  return q === '4k' || q === 'uhd' ? '2160p' : q;
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

async function resolveTitle(type, id) {
  const { baseId, season, episode } = parseStreamId(type, id);
  const mediaType = type === 'series' ? 'series' : 'movie';
  let title = null;    // título en inglés (el que usan los indexadores)
  let altTitle = null; // título original, por si el inglés no da resultados
  let year = '';

  if (baseId.startsWith('tt')) {
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
    }
    if (!title && mediaType === 'series') {
      const show = await tvmaze.showLookupByImdb(baseId);
      if (show) {
        title = show.name;
        year = show.premiered ? show.premiered.slice(0, 4) : '';
      }
    }
    if (!title) {
      const meta = await cinemetaLookup(mediaType, baseId);
      if (meta && meta.name) {
        title = meta.name;
        year = String(meta.releaseInfo || meta.year || '').slice(0, 4);
      }
    }
  } else if (baseId.startsWith('tmdb:')) {
    const numId = baseId.split(':').pop();
    if (/^\d+$/.test(numId)) {
      const data = await tmdb.tmdbGet(
        `/${tmdb.tmdbMediaType(mediaType)}/${numId}`, {}, 24 * 3600, 'en'
      );
      if (data) {
        title = data.title || data.name || data.original_title || data.original_name;
        altTitle = data.original_title || data.original_name || null;
        year = String(data.release_date || data.first_air_date || '').slice(0, 4);
      }
    }
  } else if (baseId.startsWith('tvmaze:')) {
    const numId = baseId.split(':').pop();
    if (/^\d+$/.test(numId)) {
      const show = await tvmaze.showById(numId);
      if (show) {
        title = show.name;
        year = show.premiered ? show.premiered.slice(0, 4) : '';
      }
    }
  }

  if (!title) return null;
  if (altTitle === title) altTitle = null;
  return { title, altTitle, year, season, episode, mediaType };
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

const SEARCHERS = {
  knaben: (query) => searchKnaben(query),
  torlock: (query, resolved) => searchTorlock(query, resolved),
  blackholebay: (query) => searchBlackHoleBay(query),
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
 * cuántos resultados brutos/relevantes hubo o qué error ocurrió.
 */
async function runProviders(keys, query, resolved, queryTitle, report) {
  const settled = await Promise.allSettled(keys.map((k) => SEARCHERS[k](query, resolved)));
  const byHash = new Map();
  settled.forEach((result, i) => {
    const key = keys[i];
    if (result.status !== 'fulfilled') {
      const message = (result.reason && result.reason.message) || 'error desconocido';
      console.error(`[Streams] ${key} falló para "${query}" ->`, message);
      if (report) report[key] = { ok: false, error: message };
      return;
    }
    let relevant = 0;
    for (const hit of result.value) {
      if (!hit.infoHash || !isRelevant(hit, resolved, queryTitle)) continue;
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
    if (report) report[key] = { ok: true, raw: result.value.length, relevant };
  });
  return [...byHash.values()];
}

async function searchStreams(type, id, cfg) {
  const keys = activeProviders(cfg);
  if (!keys.length) return [];

  const resolved = await resolveTitle(type, id);
  if (!resolved) {
    console.error(`[Streams] Sin título resoluble para ${type} ${id} (¿TMDB configurado?)`);
    return [];
  }

  const cacheKey = `streams:${keys.join(',')}:${type}:${decodeURIComponent(String(id || ''))}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // 1ª pasada con el título en inglés; si ningún proveedor devuelve
  // resultados relevantes, 2ª pasada con el título original.
  let hits = await runProviders(keys, buildQuery(resolved), resolved, resolved.title);
  if (!hits.length && resolved.altTitle) {
    hits = await runProviders(
      keys, buildQuery(resolved, resolved.altTitle), resolved, resolved.altTitle
    );
  }

  const max = config.streamMaxResults || 30;
  const streams = hits
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, max)
    .map((hit) => {
      // Sin nombres de proveedores ni de fuentes en pantalla: solo se ve
      // calidad, tamaño y seeders (el proveedor queda para uso interno).
      const quality = qualityOf(hit.title);
      const details = [
        hit.size ? `💾 ${formatSize(hit.size)}` : '',
        `👤 ${hit.seeders}`,
        hit.peers ? `⬇ ${hit.peers}` : '',
      ].filter(Boolean).join('  ');
      return {
        name: `🧲 ${quality || 'Torrent'}`,
        title: `${hit.title}\n${details}`,
        infoHash: hit.infoHash,
        sources: magnetSources(hit.magnet, hit.infoHash),
        behaviorHints: { bingeGroup: `catalogos-plus-${hit.infoHash.slice(0, 8)}` },
      };
    });

  cache.set(cacheKey, streams, STREAM_TTL_SECONDS);
  return streams;
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
    },
    query,
    providers: report,
    totalStreams: hits.length,
  };
  if (!hits.length && resolved.altTitle) {
    const altReport = {};
    const altHits = await runProviders(
      keys, buildQuery(resolved, resolved.altTitle), resolved, resolved.altTitle, altReport
    );
    result.altQuery = buildQuery(resolved, resolved.altTitle);
    result.altProviders = altReport;
    result.totalStreams = altHits.length;
    result.ok = altHits.length > 0;
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
  parseStreamId,
  buildQuery,
  isRelevant,
  formatSize,
};
