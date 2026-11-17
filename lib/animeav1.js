'use strict';
// AnimeAV1: solo series en primera temporada; MP4Upload directo, no iframes.
const config = require('./config');
const { fetchText } = require('./http');
const BASE = 'https://animeav1.com';
const MP4 = 'https://www.mp4upload.com';
const UA = 'Mozilla/5.0 (compatible; CatalogosPlus/1.5)';
function normalize(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&amp;/g,' and ').replace(/[^a-z0-9]+/g,' ').trim(); }
function findSeries(html, resolved) {
  const names = new Set([resolved.title, resolved.altTitle].map(normalize).filter(x => x.length >= 3));
  const matches = new Set();
  for (const m of String(html).matchAll(/<article\b[\s\S]*?<\/article>/gi)) {
    const h = /<h3\b[^>]*>([^<]+)<\/h3>/i.exec(m[0]);
    const link = /href=["'](\/media\/[a-z0-9-]+)["']/i.exec(m[0]);
    const kind = /class=["'][^"']*\btext-subs\b[^"']*["'][^>]*>\s*([^<]+)/i.exec(m[0]);
    if (h && link && kind && /^TV Anime$/i.test(kind[1].trim()) && names.has(normalize(h[1]))) matches.add(BASE + link[1]);
  }
  return matches.size === 1 ? [...matches][0] : null;
}
function hasEpisode(html, episode) {
  return [...String(html).matchAll(/\{\s*id:\s*\d+\s*,\s*number:\s*(\d+)\s*\}/g)].some(m => Number(m[1]) === episode);
}
function subEmbed(html) {
  // Nunca leer descargas ni DUB; el idioma del audio de SUB no se deduce.
  const part = /\bembeds\s*:\s*\{\s*SUB\s*:\s*\[([^\]]*)\]/i.exec(html)?.[1];
  if (!part) return null;
  const m = /\bserver\s*:\s*["']MP4Upload["']\s*,\s*url\s*:\s*["']([^"']+)["']/i.exec(part);
  if (!m) return null;
  try { const u = new URL(m[1]); return u.origin === MP4 && !u.username && !u.password && !u.search && !u.hash && /^\/embed-[a-z0-9]+\.html$/i.test(u.pathname) ? u.href : null; } catch { return null; }
}
function directMp4(html) {
  const m = /\bsrc\s*:\s*["'](https:\/\/[^"']+)["']/i.exec(html);
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && (u.hostname === 'mp4upload.com' || u.hostname.endsWith('.mp4upload.com')) && /\.mp4$/i.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
async function verifyMp4(url, timeoutMs) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {headers:{'User-Agent':UA, Referer:MP4+'/', Range:'bytes=0-1023'}, redirect:'error', signal:controller.signal});
    if (!r.ok || (r.headers.get('cf-mitigated') || '').toLowerCase() === 'challenge' || !r.body) { if (r.body) await r.body.cancel().catch(()=>{}); return false; }
    const reader = r.body.getReader(); let size=0; const bytes=new Uint8Array(8);
    try { while(size<8) { const chunk=await reader.read(); if(chunk.done) break; const n=Math.min(8-size,chunk.value.length); bytes.set(chunk.value.subarray(0,n),size); size+=n; } } finally { await reader.cancel().catch(()=>{}); }
    return size === 8 && String.fromCharCode(...bytes.subarray(4,8)) === 'ftyp';
  } catch { return false; } finally { clearTimeout(timer); }
}
async function searchAnimeav1(_q, r, queryTitle, timeoutMs=config.streamProviderTimeoutMs) {
  if (config.animeav1Enabled === false) return {skipped:'desactivado por ANIMEAV1=off'};
  if (!r || r.mediaType !== 'series' || r.season !== 1 || !Number.isInteger(r.episode) || r.episode < 1 || !r.title) return {skipped:'experimental: solo primera temporada con episodio definido'};
  const headers={'User-Agent':UA, Referer:BASE+'/'};
  const catalog = await fetchText(BASE+'/catalogo?search='+encodeURIComponent(queryTitle || r.title)+'&page=1',{headers,timeoutMs});
  const series = findSeries(catalog,r); if(!series) return {hits:[],query:'animeav1 búsqueda exacta'};
  const page = await fetchText(series,{headers,timeoutMs}); if(!hasEpisode(page,r.episode)) return {hits:[],query:'animeav1 episodio'};
  const episode = series+'/'+r.episode; const embed = subEmbed(await fetchText(episode,{headers,timeoutMs})); if(!embed) return {hits:[],query:'animeav1 sin MP4Upload'};
  const direct=directMp4(await fetchText(embed,{headers:{'User-Agent':UA,Referer:MP4+'/'},timeoutMs}));
  if(!direct || !await verifyMp4(direct,timeoutMs)) return {hits:[],query:'animeav1 MP4 inaccesible'};
  return {query:'animeav1 MP4',hits:[{provider:'animeav1',title:`${r.title} · AnimeAV1 · Sub ES · MP4`,url:direct,referer:MP4+'/',seeders:0,peers:0,size:0,relevant:true,expiresAt:Date.now()+5*60*1000}]};
}
module.exports={searchAnimeav1,findSeries,hasEpisode,subEmbed,directMp4,verifyMp4};
