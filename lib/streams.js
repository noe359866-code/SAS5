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

async function resolveTitle(type, id) {
  const { baseId, season, episode } = parseStreamId(type, id);
  const mediaType = type === 'series' ? 'series' : 'movie';
  let title = null;
  let year = '';

  if (baseId.startsWith('tt')) {
    const found = await tmdb.findByImdbId(baseId, 'en');
    const item = mediaType === 'movie' ? found.movie : found.tv;
    const fallback = mediaType === 'movie' ? found.tv : found.movie;
    const hit = item || fallback;
    if (hit) {
      title = hit.original_title || hit.original_name || hit.title || hit.name;
      year = String(hit.release_date || hit.first_air_date || '').slice(0, 4);
    }
    if (!title && mediaType === 'series') {
      const show = await tvmaze.showLookupByImdb(baseId);
      if (show) {
        title = show.name;
        year = show.premiered ? show.premiered.slice(0, 4) : '';
      }
    }
  } else if (baseId.startsWith('tmdb:')) {
    const numId = baseId.split(':').pop();
    if (/^\d+$/.test(numId)) {
      const data = await tmdb.tmdbGet(
        `/${tmdb.tmdbMediaType(mediaType)}/${numId}`, {}, 24 * 3600, 'en'
      );
      if (data) {
        title = data.original_title || data.original_name || data.title || data.name;
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
  return { title, year, season, episode, mediaType };
}

function buildQuery(resolved) {
  const { title, year, season, episode, mediaType } = resolved;
  if (mediaType === 'series' && season != null && episode != null) {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');
    return `${title} S${s}E${e}`;
  }
  return year ? `${title} ${year}` : title;
}

/** Filtro de relevancia: evita secuelas/episodios equivocados. */
function isRelevant(hit, resolved) {
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
  const tokens = normalizeText(resolved.title).split(' ').filter((t) => t.length > 1);
  if (tokens.length && !tokens.every((t) => name.split(' ').includes(t))) return false;
  if (resolved.year && resolved.mediaType === 'movie') {
    // Si el torrent declara un año distinto, casi seguro es otra película.
    const years = name.match(/\b(19|20)\d{2}\b/g) || [];
    if (years.length && !years.includes(resolved.year)) return false;
  }
  return true;
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
  const data = await fetchJson(url.toString(), { timeoutMs: 9000 });
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
  const xml = await fetchText(url.toString(), { timeoutMs: 9000 });
  return parseTorlock(xml);
}

async function searchBlackHoleBay(query) {
  const url = new URL('https://theblackholebay.lol/api/search');
  url.searchParams.set('q', query);
  url.searchParams.set('category', '200'); // 200 = Vídeo (películas y series)
  const data = await fetchJson(url.toString(), { timeoutMs: 9000 });
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
async function searchStreams(type, id, cfg) {
  const keys = activeProviders(cfg);
  if (!keys.length) return [];

  const resolved = await resolveTitle(type, id);
  if (!resolved) return [];
  const query = buildQuery(resolved);

  const cacheKey = `streams:${keys.join(',')}:${type}:${decodeURIComponent(String(id || ''))}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const settled = await Promise.allSettled(keys.map((k) => SEARCHERS[k](query, resolved)));
  const byHash = new Map();
  settled.forEach((result, i) => {
    if (result.status !== 'fulfilled') {
      console.error(`[Streams] ${keys[i]} falló para "${query}" ->`, result.reason && result.reason.message);
      return;
    }
    for (const hit of result.value) {
      if (!hit.infoHash || !isRelevant(hit, resolved)) continue;
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
  });

  const max = config.streamMaxResults || 30;
  const streams = [...byHash.values()]
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, max)
    .map((hit) => {
      const providerLabel = hit.providers.map((k) => PROVIDER_NAMES[k] || k).join(' + ');
      const quality = qualityOf(hit.title);
      const details = [
        hit.size ? `💾 ${formatSize(hit.size)}` : '',
        `👤 ${hit.seeders}`,
        hit.peers ? `⬇ ${hit.peers}` : '',
        `⚙ ${providerLabel}`,
      ].filter(Boolean).join('  ');
      return {
        name: `🧲 ${providerLabel}${quality ? `\n${quality}` : ''}`,
        title: `${hit.title}\n${details}`,
        infoHash: hit.infoHash,
        sources: magnetSources(hit.magnet, hit.infoHash),
        behaviorHints: { bingeGroup: `catalogos-plus-${hit.infoHash.slice(0, 8)}` },
      };
    });

  cache.set(cacheKey, streams, STREAM_TTL_SECONDS);
  return streams;
}

module.exports = {
  PROVIDERS,
  PROVIDER_KEYS,
  activeProviders,
  searchStreams,
  // exportados para tests offline
  parseKnaben,
  parseTorlock,
  parseBlackHoleBay,
  parseStreamId,
  buildQuery,
  isRelevant,
  formatSize,
};
