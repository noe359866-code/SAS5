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
function hlsOptions(html) {
  // Solo opciones rotuladas HLS y origen permitido; no presentar iframes.
  const re = /<span\b[^>]*class=["'][^"']*\btooltip-text\b[^"']*["'][^>]*>\s*HLS\s*<\/span>\s*<button\b([^>]*)>([^<]*)<\/button>/gi;
  const candidates = new Map();
  for (const m of String(html).matchAll(re)) {
    const encoded = /\bdata-src=["']([A-Za-z0-9+/=]+)["']/i.exec(m[1]);
    if (!encoded) continue;
    try {
      const u = new URL(atob(encoded[1]));
      if (u.protocol !== 'https:' || u.hostname !== 'player.zilla-networks.com' || u.port || u.username || u.password || u.search || u.hash || !/^\/m3u8\/[a-f0-9]{32}$/.test(u.pathname)) continue;
      const app = /\bapp_type=["']([^"']+)["']/i.exec(m[1])?.[1];
      const label = m[2].trim();
      // Dub por sí solo no especifica el idioma. LAT junto con Dub sí.
      const audioLabel = /^dub$/i.test(app || '') && /^LAT(?:\s+\d+)?$/i.test(label) ? 'Latino' : '';
      const display = audioLabel || (/^sub$/i.test(app || '') ? 'Sub ES' : 'Audio desconocido');
      if (candidates.has(u.href) && candidates.get(u.href).audioLabel !== audioLabel) candidates.set(u.href, {url:u.href, audioLabel:'', display:'Audio desconocido'});
      else if (!candidates.has(u.href)) candidates.set(u.href, {url:u.href, audioLabel, display});
    } catch (_) {}
    if (candidates.size >= 2) break;
  }
  return [...candidates.values()];
}
function hlsUrl(html) { return hlsOptions(html)[0]?.url || null; }
// Comprobar el fragmento de inicialización sin descargar el vídeo completo.
// El proveedor observado usa fMP4 en /segs/<id>/init.html; no aceptar HTML
// genérico ni hosts arbitrarios que aparezcan dentro de una playlist.
async function verifyInit(playlist, source, episode, timeoutMs) {
  const match = /#EXT-X-MAP:[^\r\n]*\bURI="([^"]+)"/i.exec(playlist);
  if (!match || !/#EXTINF:/.test(playlist)) return false;
  let target;
  try {
    target = new URL(match[1], source);
    const id = new URL(source).pathname.split('/').pop();
    if (target.origin !== 'https://player.zilla-networks.com' || target.pathname !== `/segs/${id}/init.html` || target.search || target.hash || target.username || target.password) return false;
  } catch (_) { return false; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target.href, {headers:{...HEADERS, Referer:episode, Range:'bytes=0-1023'}, redirect:'error', signal:controller.signal});
    if (!res.ok || (res.headers.get('cf-mitigated') || '').toLowerCase() === 'challenge' || !res.body) {
      if (res.body) await res.body.cancel().catch(() => {});
      return false;
    }
    const reader = res.body.getReader();
    const bytes = new Uint8Array(8); let size = 0;
    try {
      while (size < 8) {
        const chunk = await reader.read(); if (chunk.done) break;
        const n = Math.min(8 - size, chunk.value.length); bytes.set(chunk.value.subarray(0, n), size); size += n;
      }
    } finally { await reader.cancel().catch(() => {}); }
    return size === 8 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
  } catch (_) { return false; } finally { clearTimeout(timer); }
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
  const options = hlsOptions(await fetchText(episode, {headers:HEADERS, timeoutMs}));
  const checked = await Promise.allSettled(options.map(async option => {
    const playlist = await fetchText(option.url, {headers:{...HEADERS, Referer:episode}, timeoutMs});
    if (!/^\s*#EXTM3U(?:\s|$)/.test(playlist) || !await verifyInit(playlist, option.url, episode, timeoutMs)) return null;
    return {provider:'animeflv', title:`${r.title} · AnimeFLV · ${option.display}`, url:option.url, ...(option.audioLabel ? {audioLabel:option.audioLabel} : {}), referer:episode, seeders:0, peers:0, size:0, relevant:true, expiresAt:Date.now()+5*60*1000};
  }));
  if (checked.length && checked.every(x => x.status === 'rejected')) throw checked[0].reason;
  return {query:'animeflv HLS', hits:checked.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value)};
}
module.exports = { searchAnimeflv, seriesUrl, episodeUrl, hlsUrl, hlsOptions, verifyInit };
