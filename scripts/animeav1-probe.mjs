#!/usr/bin/env node
/**
 * Sonda de AnimeAV1 para escribir el adaptador con el marcado real.
 *
 * Ya se sabe lo importante (`.probe/anime-players3.md`): el episodio publica
 * `embeds: { SUB: [...], DUB: [...] }` y el player propio
 * `player.zilla-networks.com/play/<hex>` sirve manifiesto en `/m3u8/<hex>`.
 *
 * Falta el marcado: cómo se listan las fichas del buscador, dónde va el título
 * de la ficha, cómo se enlazan los episodios y qué forma tiene cada entrada de
 * `embeds` (campo `url`, `server`, idioma…). Eso es lo que imprime esta sonda,
 * recortado y sin valores de consulta.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 25_000;
const BASE = 'https://animeav1.com';

const rows = [];
const row = (step, note) => { rows.push({ step, note }); console.log(`| ${step} | ${note} |`); };

const clean = (html, limit = 600) => String(html || '')
  .replace(/https?:\/\/[^\s"'<>]+/g, (raw) => { try { const u = new URL(raw); return `«${u.hostname}${u.pathname}»`; } catch { return '«url»'; } })
  .replace(/[a-f0-9]{24,}/gi, '«hex»')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

async function req(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) } });
    const text = (await res.text()).slice(0, 2 * 1024 * 1024);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0], ms: Date.now() - started };
  } catch (err) {
    return { status: 0, body: '', type: '', ms: Date.now() - started, error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const tag = (html, name) => (new RegExp(`<${name}[^>]*>([\\s\\S]{0,200}?)</${name}>`, 'i').exec(html) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
const meta = (html, prop) => (new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html) || [])[1] || '';

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });

  /* 1. Buscador -------------------------------------------------------- */
  for (const q of ['solo leveling', 'ore dake level up na ken']) {
    const res = await req(`${BASE}/catalogo?search=${encodeURIComponent(q)}`, `${BASE}/`);
    const articles = res.body.split(/<article/i).slice(1);
    row(`buscar «${q}»`, `${res.status} ${res.ms}ms ${res.body.length}B · articles=${articles.length}`);
    if (articles[0]) row(`  artículo[0] ${q}`, clean(`<article${articles[0].slice(0, 1200)}`, 700));
  }

  /* 2. Ficha ------------------------------------------------------------ */
  const search = await req(`${BASE}/catalogo?search=${encodeURIComponent('solo leveling')}`, `${BASE}/`);
  const media = (search.body.match(/href="([^"]*\/media\/[^"/]+)"/) || [])[1] || '';
  if (!media) { row('ficha', 'sin enlace'); return finish(); }
  const mediaUrl = new URL(media, BASE).href;
  const detail = await req(mediaUrl, `${BASE}/`);
  const eps = [...new Set([...detail.body.matchAll(/href="([^"]*\/media\/[^"]+\/\d+)"/g)].map((m) => m[1]))];
  row('ficha', `${detail.status} ${detail.ms}ms ${detail.body.length}B`);
  row('  título ficha', `h1=«${clean(tag(detail.body, 'h1'), 120)}» · og=«${clean(meta(detail.body, 'og:title'), 120)}» · title=«${clean(tag(detail.body, 'title'), 120)}»`);
  row('  episodios', `${eps.length} · ${eps.slice(0, 3).map((e) => e.replace(/^.*\/media\//, '')).join(' ')}`);
  // ¿Hay JSON de episodios embebido, como en AnimeFLV?
  row('  JSON episodios', /episodes/i.test(detail.body) ? `sí (${(detail.body.match(/episodes/gi) || []).length} marcas)` : 'no');

  /* 3. Episodio --------------------------------------------------------- */
  const episodeUrl = `${mediaUrl.replace(/\/+$/, '')}/1`;
  const episode = await req(episodeUrl, mediaUrl);
  row('episodio', `${episode.status} ${episode.ms}ms ${episode.body.length}B · title=«${clean(tag(episode.body, 'title'), 110)}»`);
  const at = episode.body.indexOf('embeds:');
  if (at < 0) { row('  embeds', 'no aparecen'); return finish(); }
  const zone = episode.body.slice(at, at + 4000);
  row('  zona embeds', clean(zone, 800));

  // ¿Qué campos lleva cada entrada? Se listan las claves de los objetos.
  const keys = [...new Set([...zone.matchAll(/(\w+)\s*:/g)].map((m) => m[1]))].slice(0, 12);
  row('  claves', keys.join(','));

  // Cada grupo: cuántos, qué hosts y si el player propio da manifiesto.
  for (const group of zone.matchAll(/(SUB|DUB)\s*:\s*\[([\s\S]*?)\]/g)) {
    const urls = [...group[2].matchAll(/url\s*:\s*"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
    const hosts = [...new Set(urls.map((u) => { try { return new URL(u).hostname; } catch { return '?'; } }))];
    row(`  ${group[1]}`, `${urls.length} · ${hosts.join(',')}`);
    const own = urls.find((u) => /zilla-networks\.com\/play\//.test(u));
    if (own) {
      const hash = (own.match(/\/play\/([a-z0-9]+)/i) || [])[1];
      const manifest = await req(`https://player.zilla-networks.com/m3u8/${hash}`, episodeUrl);
      const variants = (manifest.body.match(/#EXT-X-STREAM-INF[^\n]*RESOLUTION=(\d+x\d+)/g) || []).map((l) => (l.match(/RESOLUTION=(\d+x\d+)/) || [])[1]);
      const audio = (manifest.body.match(/#EXT-X-MEDIA[^\n]*TYPE=AUDIO[^\n]*/g) || []).length;
      row(`  ${group[1]} player propio`, `m3u8 ${manifest.status} ${manifest.type} ${manifest.body.length}B · variantes=${variants.join(' ') || '—'} · pistasAudio=${audio}`);
    }
  }

  finish();
}

let written = false;
function finish() {
  if (written) return;
  written = true;
  const fs = require('node:fs');
  const md = ['| Paso | Resultado |', '|---|---|'];
  for (const r of rows) md.push(`| ${r.step} | ${String(r.note).replace(/\|/g, '/')} |`);
  md.push('', 'AnimeAV1: marcado del buscador, la ficha y el episodio.');
  fs.writeFileSync('.probe/animeav1.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { row('error', String(err?.message || err).slice(0, 200)); finish(); });
