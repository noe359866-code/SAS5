#!/usr/bin/env node
// Sonda acotada: no imprime URLs firmadas ni cookies. No modifica fuentes.
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
async function request(label, url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, headers: { 'User-Agent': ua, ...(opts.headers || {}) }, signal: AbortSignal.timeout(12000) });
    const content = await r.text();
    console.log(`${label}: HTTP ${r.status}, ${content.length} caracteres`);
    return { response: r, content };
  } catch (e) { console.log(`${label}: error ${e.name}`); return null; }
}
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { searchDeVideoSrc } = require('../lib/devideosrc');
  const r = await searchDeVideoSrc('', { mediaType:'movie', imdbId:'tt0133093', title:'The Matrix' }, 'The Matrix', 12000);
  console.log(`DeVideoSRC Matrix: ${r.hits?.length || 0} URLs directas; ${r.skipped || 'consulta completada'}`);
} catch (e) { console.log(`DeVideoSRC Matrix: ${e.message}`); }

const fr = await request('FrenchStream búsqueda POST Matrix', 'https://fs16.lol/engine/ajax/search.php', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Cookie: 'fsschal=1; dle_skin=VFV1', Referer: 'https://fs16.lol/' }, body: new URLSearchParams({ query: 'Matrix', page: '1' }),
});
if (fr) {
  const text = fr.content;
  const names = [...text.matchAll(/class=["'][^"']*search-title[^"']*["'][^>]*>([^<]*)/gi)].slice(0, 5).map(x => x[1].trim());
  const ids = [...text.matchAll(/newsid(?:=|%3[dD])(\d+)/g)].map(x => x[1]);
  console.log(`  títulos: ${names.join(' | ') || '(sin coincidencias parseables)'}; ids newsid: ${ids.length}`);
  const paths = [...text.matchAll(/onclick=["']([^"']*(?:[\s\S]*?))(?=\sclass=|>)/gi)].slice(0, 3).map(x => x[1].slice(0, 160));
  console.log(`  onclick: ${paths.join(' | ') || 'no encontrado'}`);
}
for (const [label, url, headers] of [
  ['MStream watch con Referer', 'https://moflix-stream.xyz/api/v1/watch/1625240', { Referer: 'https://moflix-stream.xyz/', Accept: 'application/json' }],
  ['JKAnime episodio', 'https://jkanime.net/one-piece/1/', {}],
]) {
  const out = await request(label, url, { headers });
  if (!out) continue;
  if (label.startsWith('MStream')) {
    try { const j = JSON.parse(out.content); console.log(`  alternative_videos: ${Array.isArray(j.alternative_videos) ? j.alternative_videos.length : 'no presente'}`); } catch { console.log('  respuesta no JSON'); }
  } else {
    console.log(`  var servers: ${/var\s+servers\s*=/.test(out.content)}; iframe scripts: ${(out.content.match(/video_iframe/gi) || []).length}`);
  }
}
