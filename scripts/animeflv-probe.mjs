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
      const m = html.indexOf('one-piece-episodio-1180');
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
