'use strict';
// Experimental: una búsqueda, una API y como máximo un host; no WebView.
const config = require('./config');
const { fetchText, fetchJson } = require('./http');
const { extractFromEmbedHtml } = require('./spinflix');
const BASE = 'https://fs16.lol';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', Cookie: 'fsschal=1; dle_skin=VFV1', 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + '/' };
function normalize(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function findId(html, resolved) {
  const wanted = [resolved.title, resolved.altTitle].filter(Boolean).map(normalize);
  const year = String(resolved.year || '').match(/^(?:19|20)\d{2}/)?.[0];
  if (!year || !wanted.length) return null;
  for (const part of String(html).split(/(?=<div\b[^>]*class=["'][^"']*\bsearch-item\b)/i).slice(0, 31)) {
    const path = /location\.href\s*=\s*['"]\/(\d+)-[^'"/]*\.html['"]/i.exec(part);
    const title = /class=["'][^"']*\bsearch-title\b[^"']*["'][^>]*>([^<]*)/i.exec(part);
    if (!path || !title) continue;
    const name = title[1].replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
    if (!new RegExp(`\\(${year}\\)\\s*$`).test(name)) continue;
    if (wanted.includes(normalize(name.replace(/\s*\(\d{4}\)\s*$/, '')))) return path[1];
  }
  return null;
}
function vidzyUrl(data) {
  const u = data?.players?.vidzy?.default;
  try { const parsed = new URL(u); return parsed.protocol === 'https:' && parsed.hostname === 'vidzy.org' && /^\/embed-[\w-]+\.html$/.test(parsed.pathname) && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; }
}
async function searchFrenchStream(_q, r, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.frenchstreamEnabled === false) return { skipped: 'desactivado por FRENCHSTREAM=off' };
  if (!r || r.mediaType !== 'movie') return { skipped: 'experimental: solo películas' };
  if (queryTitle && queryTitle !== r.title) return { skipped: 'ya buscado con título principal' };
  if (!r.title || !r.year) return { skipped: 'se requiere título y año' };
  const html = await fetchText(BASE + '/engine/ajax/search.php', { timeoutMs, method:'POST', headers: { ...HEADERS, 'Content-Type':'application/x-www-form-urlencoded' }, body: new URLSearchParams({ query:r.title, page:'1' }).toString() });
  const id = findId(html, r);
  if (!id) return { hits: [], query: 'frenchstream búsqueda' };
  const data = await fetchJson(BASE + '/engine/ajax/film_api.php?id=' + id, {timeoutMs, headers:HEADERS});
  const embed = vidzyUrl(data);
  if (!embed) return {hits:[], query:'frenchstream ' + id};
  const player = await fetchText(embed, {timeoutMs, headers:{'User-Agent':HEADERS['User-Agent'], Referer: BASE + '/'}});
  const master = extractFromEmbedHtml(player).hls.find(u => { try { const p = new URL(u); return p.protocol === 'https:' && (p.hostname === 'vidzy.org' || p.hostname.endsWith('.vidzy.org')) && !p.username && !p.password; } catch { return false; } });
  return {query:'frenchstream ' + id, hits: master ? [{provider:'frenchstream', title:`${r.title} FrenchStream`, url:master, referer:embed, expiresAt:Date.now() + 5 * 60 * 1000, seeders:0, peers:0, size:0, relevant:true}] : []};
}
module.exports = { searchFrenchStream, findId, vidzyUrl };
