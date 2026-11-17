'use strict';
// Vumeto experimental: usa solo MovieBox MP4, no entrega el reproductor HTML.
const config=require('./config');
const {fetchText,fetchJson}=require('./http');
const BASE='https://vumeto.xyz';
const UA='Mozilla/5.0 (compatible; CatalogosPlus/1.5)';
function sessionFromPage(html) {
  const token=/<meta\s+name=["']vumeto-session["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
  return token && /^[A-Za-z0-9._~-]{8,2048}$/.test(token) ? token : null;
}
function candidates(data,r) {
  const t=data?.target;const type=r.mediaType==='movie'?'movie':'tv';
  if (!t || t.type!==type || Number(t.tmdbId)!==Number(r.tmdbId)) return [];
  if (type==='tv' && (Number(t.season)!==r.season || Number(t.episode)!==r.episode)) return [];
  const result=[];const seen=new Set();
  for(const source of (Array.isArray(data.sources)?data.sources:[])) {
    if (source.provider!=='moviebox-0930' || source.type!=='video/mp4' || !/(?:^|,)\s*english\s*(?:,|$)/i.test(String(source.language||''))) continue;
    try {
      const u=new URL(source.directUrl);
      if(u.protocol!=='https:' || u.hostname!=='macdn.hakunaymatata.com' || u.username || u.password || u.port || u.hash || !u.pathname.startsWith('/resource/') || !/\.mp4$/i.test(u.pathname) || seen.has(u.href)) continue;
      const quality=/^(?:360|480|720|1080|2160)p$/.test(source.quality)?source.quality:'';
      seen.add(u.href);result.push({url:u.href,quality});
    } catch (_) {}
    if(result.length>=2) break;
  }
  return result;
}
async function verifyMp4(url,timeoutMs) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const r=await fetch(url,{headers:{'User-Agent':UA,Referer:BASE+'/',Range:'bytes=0-1023'},redirect:'error',signal:controller.signal});
    if(!r.ok || (r.headers.get('cf-mitigated')||'').toLowerCase()==='challenge' || !r.body) {if(r.body) await r.body.cancel().catch(()=>{});return false;}
    const reader=r.body.getReader();const bytes=new Uint8Array(8);let size=0;
    try {while(size<8){const chunk=await reader.read();if(chunk.done)break;const n=Math.min(8-size,chunk.value.length);bytes.set(chunk.value.subarray(0,n),size);size+=n;}} finally {await reader.cancel().catch(()=>{});}
    return size===8 && String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
  } catch (_) {return false;} finally {clearTimeout(timer);}
}
async function searchVumeto(_q,r,queryTitle,timeoutMs=config.streamProviderTimeoutMs) {
  if(config.vumetoEnabled===false) return {skipped:'desactivado por VUMETO=off'};
  if (!r || !Number.isSafeInteger(Number(r.tmdbId)) || Number(r.tmdbId)<1 || !['movie','series'].includes(r.mediaType) || (r.mediaType==='series' && (!Number.isInteger(r.season) || r.season<1 || !Number.isInteger(r.episode) || r.episode<1))) return {skipped:'requiere TMDB y episodio válido'};
  if(queryTitle && queryTitle!==r.title) return {skipped:'ya buscado por TMDB'};
  const type=r.mediaType==='movie'?'movie':'tv';const id=Number(r.tmdbId);
  const path=type==='movie'?`/embed/movie/${id}`:`/embed/tv/${id}/${r.season}/${r.episode}`;
  const page=await fetchText(BASE+path,{headers:{'User-Agent':UA},timeoutMs});const session=sessionFromPage(page);
  if(!session) return {hits:[],query:'vumeto sin sesión de reproductor'};
  const q=new URLSearchParams({type,id:String(id),provider:'moviebox-0930'});if(type==='tv'){q.set('season',r.season);q.set('episode',r.episode);}
  const data=await fetchJson(BASE+'/_player/resolve?'+q,{headers:{'User-Agent':UA,Referer:BASE+path,'X-Vumeto-Session':session},timeoutMs});
  const options=candidates(data,r);
  const checked=await Promise.all(options.map(async o=>await verifyMp4(o.url,timeoutMs)?o:null));
  return {query:'vumeto MP4',hits:checked.filter(Boolean).map(o=>({provider:'vumeto',title:`${r.title} · Vumeto · English ${o.quality} · MP4`,audioLabel:'English',url:o.url,referer:BASE+'/',seeders:0,peers:0,size:0,relevant:true,expiresAt:Date.now()+120000}))};
}
module.exports={searchVumeto,sessionFromPage,candidates,verifyMp4};
