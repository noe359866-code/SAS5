'use strict';
// Integración experimental de animeflv.or.at, no animeflv.net.
const config = require('./config');
const { fetchText } = require('./http');
const BASE = 'https://animeflv.or.at';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5)', Referer: BASE + '/' };
function slug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function seriesUrl(html, r) {
  const wanted = new Set([r.title, r.altTitle].map(slug).filter(s => s.length >= 3));
  const found = new Set();
  for (const m of String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], BASE);
      const p = /^\/anime\/([a-z0-9-]+)\/?$/.exec(u.pathname);
      if (u.origin === BASE && !u.search && !u.hash && p && wanted.has(p[1])) found.add(u.href);
    } catch (_) {}
  }
  return found.size === 1 ? [...found][0] : null;
}
function episodeUrl(html, episode, series) {
  const m = /<script\b[^>]*class=["'][^"']*\banimeflv-episodes-data\b[^"']*["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  let entries; try { entries = JSON.parse(m[1]); } catch { return null; }
  if (!Array.isArray(entries)) return null;
  const expected = new URL(series).pathname.split('/')[2];
  const found = new Set();
  for (const e of entries) {
    if (Number(e.number) !== episode) continue;
    try {
      const u = new URL(e.permalink);
      if (u.origin === BASE && !u.search && !u.hash && u.pathname === `/${u.pathname.split('/').slice(1,4).join('/')}/${expected}-episodio-${episode}/` && /^\/\d{4}\/\d{2}\/\d{2}\//.test(u.pathname)) found.add(u.href);
    } catch (_) {}
  }
  return found.size === 1 ? [...found][0] : null;
}
function hlsUrl(html) {
  // Solo la opción rotulada HLS; nunca entregar los demás iframes.
  const re = /<span\b[^>]*class=["'][^"']*\btooltip-text\b[^"']*["'][^>]*>\s*HLS\s*<\/span>\s*<button\b([^>]*)>/gi;
  for (const m of String(html).matchAll(re)) {
    const encoded = /\bdata-src=["']([A-Za-z0-9+/=]+)["']/i.exec(m[1]);
    if (!encoded) continue;
    try {
      const u = new URL(atob(encoded[1]));
      if (u.protocol === 'https:' && u.hostname === 'player.zilla-networks.com' && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/m3u8\/[a-f0-9]{32}$/.test(u.pathname)) return u.href;
    } catch (_) {}
  }
  return null;
}
async function searchAnimeflv(_q, r, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.animeflvEnabled === false) return { skipped:'desactivado por ANIMEFLV=off' };
  if (!r || r.mediaType !== 'series' || r.season !== 1 || !Number.isInteger(r.episode) || r.episode < 1 || !r.title) return { skipped:'experimental: solo primera temporada con episodio definido' };
  const title = queryTitle || r.title;
  const search = await fetchText(BASE + '/?s=' + encodeURIComponent(title), {headers: HEADERS, timeoutMs});
  const series = seriesUrl(search, r);
  if (!series) return {hits:[], query:'animeflv búsqueda exacta'};
  const page = await fetchText(series, {headers:HEADERS, timeoutMs});
  const episode = episodeUrl(page, r.episode, series);
  if (!episode) return {hits:[], query:'animeflv episodio'};
  const source = hlsUrl(await fetchText(episode, {headers:HEADERS, timeoutMs}));
  if (!source) return {hits:[], query:'animeflv HLS'};
  const playlist = await fetchText(source, {headers:{...HEADERS, Referer:episode}, timeoutMs});
  if (!/^\s*#EXTM3U(?:\s|$)/.test(playlist) || !/#EXTINF:|#EXT-X-STREAM-INF:/.test(playlist)) return {hits:[], query:'animeflv HLS inválido'};
  return {query:'animeflv HLS', hits:[{provider:'animeflv', title:`${r.title} · AnimeFLV · Sub ES`, url:source, referer:episode, seeders:0, peers:0, size:0, relevant:true, expiresAt:Date.now()+5*60*1000}]};
}
module.exports = { searchAnimeflv, seriesUrl, episodeUrl, hlsUrl };
