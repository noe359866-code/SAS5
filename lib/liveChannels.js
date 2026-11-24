'use strict';

/**
 * Canales de TV en vivo por categorías (tipo `tv` de Stremio): entretenimiento,
 * cine, infantil, anime, música, noticias, documentales…
 *
 * A diferencia del catálogo curado de deportes (lib/sportsChannels.js), estos
 * canales salen de listas públicas mantenidas por la comunidad:
 *  - Magma TV  (repo JMigue85/IPTV-SV)
 *  - IPTVSV    (mismo repo)
 *
 * Semilla: `lib/data/liveChannelsSeed.json` contiene los canales que la sonda
 * del 24-11-2026 (`.probe/live-lists.md`) verificó con HLS real. El catálogo
 * siempre se renderiza desde la semilla (estable) y la resolución intenta
 * refrescar la URL desde la lista viva (cacheada 12 h); si el canal ya no
 * está en la lista, se usa la URL de la semilla.
 *
 * Los ids son `rlch:lv:<categoría>:<slug>` (prefijo `rlch:` ya declarado).
 * Las entradas pueden declarar su propio User-Agent (#EXTVLCOPT): se pasa a
 * Stremio vía behaviorHints.proxyHeaders.
 */

const config = require('./config');
const cache = require('./cache');
const seed = require('./data/liveChannelsSeed.json');

const LIVE_ID_PREFIX = 'rlch:lv:';

/** Listas vivas que alimentan las categorías (se cachean 12 h por isolate). */
const LIVE_LISTS = [
  'https://raw.githubusercontent.com/JMigue85/IPTV-SV/main/Magma%20TV%20-Titan2022_XD.m3u',
  'https://raw.githubusercontent.com/JMigue85/IPTV-SV/main/IPTVSV.m3u',
];

/** Categorías con catálogo propio, en orden de aparición. */
const LIVE_CATEGORIES = [
  { key: 'entretenimiento', name: '📺 Entretenimiento en vivo' },
  { key: 'cine', name: '🎬 Cine en vivo' },
  { key: 'infantil', name: '🧸 Infantil en vivo' },
  { key: 'anime', name: '🎌 Anime en vivo' },
  { key: 'musica', name: '🎵 Música en vivo' },
  { key: 'noticias', name: '📰 Noticias en vivo' },
  { key: 'documentales', name: '🌍 Documentales en vivo' },
];

const UA_GENERIC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Semilla indexada por categoría → slug → canal. */
const seedByCategory = new Map();
for (const ch of seed) {
  if (!seedByCategory.has(ch.category)) seedByCategory.set(ch.category, new Map());
  seedByCategory.get(ch.category).set(ch.slug, ch);
}

/** Categorías que tienen al menos un canal verificado en la semilla. */
function activeCategories() {
  return LIVE_CATEGORIES.filter((c) => (seedByCategory.get(c.key)?.size || 0) > 0);
}

/** Meta de Stremio para un canal en vivo. */
function liveMeta(ch) {
  return {
    id: `${LIVE_ID_PREFIX}${ch.category}:${ch.slug}`,
    type: 'tv',
    name: ch.name,
    description: `${ch.name} en vivo. Señal pública verificada por el addon (sonda 24-11-2026).`,
    genres: ['TV en vivo'],
    poster: ch.logo || undefined,
    posterShape: 'square',
    logo: ch.logo || undefined,
    background: ch.logo || undefined,
  };
}

/** Metas de una categoría, siempre desde la semilla (catálogo estable). */
function liveMetas(category) {
  const bySlug = seedByCategory.get(category);
  if (!bySlug) return [];
  return [...bySlug.values()].map(liveMeta);
}

/** Parsea `rlch:lv:<categoría>:<slug>` → canal de la semilla o null. */
function liveChannelById(id) {
  const raw = String(id || '');
  if (!raw.startsWith(LIVE_ID_PREFIX)) return null;
  const rest = raw.slice(LIVE_ID_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 1) return null;
  const category = rest.slice(0, sep);
  const slug = rest.slice(sep + 1);
  return seedByCategory.get(category)?.get(slug) || null;
}

function parseM3U(text) {
  const entries = [];
  const lines = String(text || '').split('\n');
  let pendingUa = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTVLCOPT:http-user-agent=')) { pendingUa = line.slice(28).trim(); continue; }
    if (!line.startsWith('#EXTINF')) continue;
    const name = (line.split(',').pop() || '').trim();
    const logo = (/tvg-logo="([^"]+)"/.exec(line) || [])[1] || '';
    const group = (/group-title="([^"]+)"/.exec(line) || [])[1] || '';
    let url = '', ua = pendingUa;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith('#EXTVLCOPT:http-user-agent=')) { ua = l.slice(28).trim(); continue; }
      if (l.startsWith('#')) continue;
      url = l;
      break;
    }
    pendingUa = '';
    if (name && /^https?:\/\//i.test(url)) entries.push({ name, logo, group, url, ua });
  }
  return entries;
}

const LISTS_CACHE_KEY = 'livelists:v1';

/** Descarga y cachea las listas vivas. Nunca lanza. */
async function loadLiveEntries(timeoutMs = config.streamProviderTimeoutMs) {
  const cached = cache.get(LISTS_CACHE_KEY);
  if (cached !== undefined) return cached;
  const loaded = await cache.coalesce(LISTS_CACHE_KEY, async () => {
    const results = await Promise.allSettled(
      LIVE_LISTS.map((url) => fetch(url, {
        headers: { 'User-Agent': UA_GENERIC, Accept: '*/*' },
        signal: AbortSignal.timeout(Math.max(timeoutMs, 4000)),
      }).then((res) => (res.ok ? res.text() : '')))
    );
    const entries = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      entries.push(...parseM3U(r.value));
    }
    return { entries, at: Date.now() };
  });
  cache.set(LISTS_CACHE_KEY, loaded, loaded.entries.length ? 12 * 3600 : 120);
  return loaded;
}

const slugOf = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * Resuelve un canal de la semilla → hits de stream.
 * Primero la URL viva (si el canal sigue en las listas), luego la semilla.
 * Cada hit lleva `userAgent` cuando la lista lo declara. Nunca lanza.
 */
async function resolveLiveChannel(channel, timeoutMs = config.streamProviderTimeoutMs) {
  const hits = [];
  const seen = new Set();
  try {
    const { entries } = await loadLiveEntries(timeoutMs);
    for (const e of entries) {
      if (slugOf(e.name) !== channel.slug) continue;
      const base = e.url.split('?')[0];
      if (seen.has(base)) continue;
      seen.add(base);
      hits.push({
        url: e.url,
        title: e.name,
        provider: 'livelists',
        audioLabel: 'En vivo',
        channelKey: `${channel.category}:${channel.slug}`,
        userAgent: e.ua || '',
      });
    }
  } catch (_) { /* la lista no cargó: queda la semilla */ }
  if (channel.url && !seen.has(channel.url.split('?')[0])) {
    hits.push({
      url: channel.url,
      title: `${channel.name} (verificada)`,
      provider: 'livelists',
      audioLabel: 'En vivo',
      channelKey: `${channel.category}:${channel.slug}`,
      userAgent: channel.ua || '',
    });
  }
  return hits;
}

module.exports = {
  LIVE_ID_PREFIX,
  LIVE_CATEGORIES,
  activeCategories,
  liveMeta,
  liveMetas,
  liveChannelById,
  resolveLiveChannel,
  loadLiveEntries,
  parseM3U,
  slugOf,
};
