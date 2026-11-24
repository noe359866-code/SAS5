'use strict';

/**
 * Proveedor de canales de deportes en vivo vía listas públicas de iptv-org
 * (https://iptv-org.github.io/iptv). Son playlists M3U mantenidas por la
 * comunidad con señales HLS públicas; se descargan una vez por isolate y se
 * cachean 12 h (se actualizan a diario).
 *
 * Barra de calidad del addon: solo entran señales sin marcas [Geo-blocked] /
 * [Not 24/7] y con verificación real en la sonda (ver .probe/sports-lists.md).
 * Cada URL se sirve tal cual a Stremio: sin cookies ni Referer obligatorio.
 */

const config = require('./config');
const cache = require('./cache');

const LISTS = [
  'https://iptv-org.github.io/iptv/categories/sports.m3u',
  'https://iptv-org.github.io/iptv/countries/ar.m3u',
  'https://iptv-org.github.io/iptv/countries/mx.m3u',
  'https://iptv-org.github.io/iptv/countries/co.m3u',
  'https://iptv-org.github.io/iptv/countries/cl.m3u',
  'https://iptv-org.github.io/iptv/countries/pe.m3u',
];

const CACHE_KEY = 'iptvorg:sports-lists:v1';
const CACHE_TTL_SECONDS = 12 * 3600;
const SKIP_MARKER = /\[(?:Geo-blocked|Not 24\/7|Offline)\]/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Parsea una playlist M3U → [{ name, logo, group, url }]. */
function parseM3U(text) {
  const entries = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;
    const name = (line.split(',').pop() || '').trim();
    const logo = (/tvg-logo="([^"]+)"/.exec(line) || [])[1] || '';
    let url = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const l = lines[j].trim();
      if (l && !l.startsWith('#')) { url = l; break; }
    }
    if (name && /^https?:\/\//i.test(url)) entries.push({ name, logo, url });
  }
  return entries;
}

/**
 * Descarga y cachea las listas. Devuelve entradas planas; nunca lanza.
 * Las entradas con marca [Geo-blocked]/[Not 24/7] se descartan aquí: para el
 * usuario (Latinoamérica) fallarían.
 */
async function loadEntries(timeoutMs = config.streamProviderTimeoutMs) {
  const cached = cache.get(CACHE_KEY);
  if (cached !== undefined) return cached;
  const loaded = await cache.coalesce(CACHE_KEY, async () => {
    const results = await Promise.allSettled(
      LISTS.map((url) => fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        signal: AbortSignal.timeout(Math.max(timeoutMs, 4000)),
      }).then((res) => (res.ok ? res.text() : '')))
    );
    const entries = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      entries.push(...parseM3U(r.value));
    }
    const clean = entries.filter((e) => !SKIP_MARKER.test(e.name));
    return { entries: clean, at: Date.now() };
  });
  // Guardar con TTL largo solo si trajimos algo útil; un fallo de red se
  // olvida enseguida para reintentar pronto.
  cache.set(CACHE_KEY, loaded, loaded.entries.length ? CACHE_TTL_SECONDS : 120);
  return loaded;
}

/**
 * Resuelve un canal (definición de lib/sportsChannels) → hits de stream.
 * Orden: coincidencias en la lista viva, y al final el fallback verificado
 * (si no apareció ya). Nunca lanza.
 */
/**
 * Cruza las entradas de las listas con la definición del canal (puro y
 * testeable): coincidencias vivas primero, fallback verificado al final,
 * dedupe por URL base.
 */
function hitsFor(channel, entries) {
  const hits = [];
  const seen = new Set();
  for (const e of entries || []) {
    if (SKIP_MARKER.test(e.name) || !channel.match.test(e.name)) continue;
    const base = e.url.split('?')[0];
    if (seen.has(base)) continue;
    seen.add(base);
    const quality = /\((\d{3,4})p\)/.exec(e.name)?.[1];
    hits.push({
      url: e.url,
      title: e.name,
      quality: quality ? `${quality}p` : undefined,
      provider: 'iptvorg',
      audioLabel: channel.lang,
      channelKey: channel.key,
    });
  }
  if (channel.fallback && !seen.has(channel.fallback.split('?')[0])) {
    hits.push({
      url: channel.fallback,
      title: `${channel.name} (verificada)`,
      provider: 'iptvorg',
      audioLabel: channel.lang,
      channelKey: channel.key,
    });
  }
  return hits;
}

async function resolveChannel(channel, timeoutMs = config.streamProviderTimeoutMs) {
  let entries = [];
  try {
    ({ entries } = await loadEntries(timeoutMs));
  } catch (_) { /* la lista no cargó: queda el fallback */ }
  return hitsFor(channel, entries);
}

module.exports = { loadEntries, resolveChannel, hitsFor, parseM3U, CACHE_KEY };
