#!/usr/bin/env node
// Sonda de estructura; no registra URLs de vídeo ni parámetros firmados.
const base = 'https://animeflv.or.at';
const ua = 'Mozilla/5.0 (compatible; CatalogosPlus/1.5)';
for (const path of ['/?s=one+piece','/anime/one-piece/','/2026/11/17/sora-wa-akai-kawa-no-hotori-episodio-20/']) {
  try {
    const res = await fetch(base + path, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(12000) });
    const html = await res.text();
    console.log(`${path}: HTTP ${res.status}; bytes=${html.length}; challenge=${res.headers.get('cf-mitigated') === 'challenge'}`);
    if (path.includes('?')) {
      const m = html.indexOf('/anime/one-piece/');
      if (m >= 0) console.log('  muestra búsqueda: '+html.slice(Math.max(0,m-100),m+200).replace(/\s+/g,' '));
    }
    if (path === '/anime/one-piece/') {
      const m = html.indexOf('animeflv-episodes-data');
      if (m >= 0) console.log('  muestra episodio: '+html.slice(Math.max(0,m-100),m+120).replace(/\s+/g,' '));
    }
    if (path.startsWith('/2026/')) {
      for (const line of html.split('\n').filter(s => /m3u8|iframe|data-video|data-src|data-url|hls|source src/i.test(s)).slice(0, 12)) {
        const safe = line.replace(/https?:[^\s"'<>]+/g, '[URL]').replace(/\s+/g,' ').slice(0,300);
        console.log('  ' + safe);
      }
    } else {
      for (const m of [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].filter(m => path.includes('?') ? /\/anime\//.test(m[1]) : /episodio-\d+/.test(m[1])).slice(0,2)) console.log('  link: ' + m[1]);
    }
  } catch (e) { console.log(`${path}: ${e.name}`); }
}

try {
 const r = await fetch('https://player.zilla-networks.com/m3u8/d162842f22067dde8e52a91b2c3695e6', {headers:{'User-Agent':ua,Referer:base+'/'},signal:AbortSignal.timeout(12000)});
 const t = await r.text();
 const duration = [...t.matchAll(/#EXTINF:([0-9.]+)/g)].reduce((s,m) => s + Number(m[1]),0);
 console.log(`HLS: HTTP ${r.status}; tipo=${r.headers.get('content-type')}; m3u=${t.startsWith('#EXTM3U')}; duración=${Math.round(duration)}s`);
} catch(e) { console.log('HLS: '+e.name); }

try {
 const { searchAnimeflv } = await import('../lib/animeflv.js');
 const r = await searchAnimeflv('', {title:'Sora wa Akai Kawa no Hotori', mediaType:'series', season:1, episode:20}, 'Sora wa Akai Kawa no Hotori', 12000);
 console.log('Adaptador real: resultados='+ (r.hits || []).length + '; fase=' + (r.query || r.skipped));
} catch(e) { console.log('Adaptador real: error='+e.message); }

try {
 const url='https://animeflv.or.at/2026/07/28/kimetsu-no-yaiba-movie-1-mugenjou-hen-akaza-sairai-episodio-1/';
 const r=await fetch(url,{headers:{'User-Agent':ua},signal:AbortSignal.timeout(12000)}); const text=await r.text();
 const buttons=[...text.matchAll(/<span\b[^>]*class=["'][^"']*\btooltip-text\b[^"']*["'][^>]*>\s*HLS\s*<\/span>\s*<button\b([^>]*)>([^<]*)/gi)].map(m=>({app: /app_type=["']([^"']+)/i.exec(m[1])?.[1], label:m[2].trim(), host:(()=>{try{return new URL(atob(/data-src=["']([^"']+)/i.exec(m[1])[1])).hostname}catch{return 'invalid'}})()}));
 console.log('Botones HLS película: '+JSON.stringify(buttons));
} catch(e) {console.log('Botones: '+e.name)}
for(const path of ['init.html','000.html']) {
 try {const r=await fetch('https://player.zilla-networks.com/segs/d162842f22067dde8e52a91b2c3695e6/'+path,{headers:{'User-Agent':ua,Referer:base+'/'},signal:AbortSignal.timeout(12000)});const reader=r.body?.getReader();const part=reader?await reader.read():{};const bytes=part.value || new Uint8Array();if(reader)await reader.cancel(); console.log(`Segmento ${path}: HTTP ${r.status}; tipo=${r.headers.get('content-type')}; marca=${String.fromCharCode(...bytes.slice(4,8))}; bytes iniciales=${bytes.length}`);}catch(e){console.log('Segmento '+path+': '+e.name)}
}
