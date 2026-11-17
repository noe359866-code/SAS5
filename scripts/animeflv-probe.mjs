#!/usr/bin/env node
// Sonda de estructura; no registra URLs de vídeo ni parámetros firmados.
const base = 'https://animeflv.or.at';
const ua = 'Mozilla/5.0 (compatible; CatalogosPlus/1.5)';
for (const path of ['/?s=one+piece','/anime/one-piece/','/2026/11/17/sora-wa-akai-kawa-no-hotori-episodio-20/']) {
  try {
    const res = await fetch(base + path, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(12000) });
    const html = await res.text();
    console.log(`${path}: HTTP ${res.status}; bytes=${html.length}; challenge=${res.headers.get('cf-mitigated') === 'challenge'}`);
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
