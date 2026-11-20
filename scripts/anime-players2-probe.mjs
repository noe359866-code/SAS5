#!/usr/bin/env node
/**
 * Sonda de anime, tercera vuelta: AnimeAV1 y TioAnime con las rutas correctas.
 *
 * La segunda vuelta falló en los dos por la ruta, no por el sitio:
 *   · animeav1 busca en `/catalogo?search=` (no `?q=`) y el episodio es
 *     `/media/<slug>/<n>`, que respondió lento y quedó en `status 0`.
 *   · tioanime responde `/api/search` con una lista vacía al runner, así que se
 *     va por slug directo a `/ver/<slug>-<n>`.
 *
 * Aquí se prueban esas rutas con más plazo y, si el bloque de visores aparece,
 * se clasifica cada uno y se pide el medio a los extraíbles. AnimeAV1 es
 * interesante porque declara `DUB` (latino) y `SUB` por separado.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor, extractEmbed } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 25_000;
const MAX = 2 * 1024 * 1024;

const rows = [];
const row = (site, step, note) => { rows.push({ site, step, note }); console.log(`| ${site} | ${step} | ${note} |`); };
const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };
const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname.slice(0, 36)}`;
  } catch { return String(raw || '').slice(0, 50); }
};

async function req(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) } });
    const text = (await res.text()).slice(0, MAX);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0], ms: Date.now() - started, url: res.url || url };
  } catch (err) {
    return { status: 0, body: '', type: '', ms: Date.now() - started, error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function classify(url) {
  const kind = extractorFor(url);
  if (kind && kind !== 'opaque') return `extraíble(${kind})`;
  if (kind === 'opaque') return 'opaco';
  if (/vimeos\./.test(url)) return 'vimeos';
  return '—';
}

async function testPlayer(site, url, referer, label = '') {
  const kind = extractorFor(url) || (/vimeos\./.test(url) ? 'vimeos' : '');
  const head = `${label ? `${label} · ` : ''}${hostOf(url)}=${kind || 'desconocido'}`;
  if (!kind || kind === 'opaque') { row(site, 'visor', `${head} (no se abre)`); return; }
  if (kind === 'vimeos') {
    const { resolveVimeosEmbed } = require('../lib/vimeos');
    const { providerHttp } = require('../lib/providerHttp');
    try {
      const media = await resolveVimeosEmbed(url, referer, providerHttp(15_000, 4));
      row(site, 'visor', `${head} → ${media ? 'HLS ✓' : 'sin medio'}`);
    } catch (err) { row(site, 'visor', `${head} → error ${String(err?.message || err).slice(0, 40)}`); }
    return;
  }
  try {
    const out = await extractEmbed(url, { timeoutMs: 15_000, referer });
    const kinds = [...new Set((out.sources || []).map((s) => s.kind))].join('/');
    row(site, 'visor', `${head} → ok=${out.ok} fuentes=${out.sources?.length || 0}${kinds ? ` (${kinds})` : ''}${out.reason ? ` · ${out.reason}` : ''}`);
  } catch (err) { row(site, 'visor', `${head} → error ${String(err?.message || err).slice(0, 40)}`); }
}

async function animeav1() {
  const base = 'https://animeav1.com';
  const search = await req(`${base}/catalogo?search=${encodeURIComponent('solo leveling')}`, `${base}/`);
  const media = (search.body.match(/href="([^"]*\/media\/[^"/]+)"/) || [])[1] || '';
  row('animeav1', 'buscar /catalogo?search=', `${search.status} ${search.ms}ms · ${media ? redact(media) : 'sin ficha'}`);
  if (!media) return;
  const mediaUrl = new URL(media, base).href;
  const detail = await req(mediaUrl, `${base}/`);
  const epLinks = [...new Set([...detail.body.matchAll(/href="([^"]*\/media\/[^"]+\/\d+)"/g)].map((m) => m[1]))];
  row('animeav1', 'ficha', `${detail.status} ${detail.ms}ms · episodios=${epLinks.length}${epLinks[0] ? ` · ${redact(epLinks[0])}` : ''}`);
  const episodeUrl = epLinks[0] ? new URL(epLinks[0], base).href : `${mediaUrl.replace(/\/+$/, '')}/1`;
  const episode = await req(episodeUrl, mediaUrl);
  const at = episode.body.indexOf('embeds:');
  row('animeav1', 'episodio', `${episode.status} ${episode.ms}ms bytes=${episode.body.length} · embeds:${at >= 0 ? ` en ${at}` : ' ausente'}`);
  if (at < 0) return;
  const zone = episode.body.slice(at, at + 30000);
  const found = [];
  for (const group of zone.matchAll(/(SUB|DUB)\s*:\s*\[([\s\S]*?)\]/g)) {
    const audio = group[1] === 'DUB' ? 'latino' : 'subtitulado';
    for (const m of group[2].matchAll(/url\s*:\s*"((?:[^"\\]|\\.)+)"/g)) {
      const url = m[1].replace(/\\(.)/g, '$1');
      if (/^https?:/.test(url)) found.push({ url, audio });
    }
  }
  row('animeav1', 'embeds', `total=${found.length}${found.length ? ` · ${found.slice(0, 6).map((e) => `${hostOf(e.url)}/${e.audio}`).join(' ')}` : ` · muestra: ${zone.slice(0, 160).replace(/\s+/g, ' ').replace(/</g, '‹')}`}`);
  for (const entry of found.slice(0, 5)) await testPlayer('animeav1', entry.url, episodeUrl, entry.audio);
}

async function tioanime() {
  const base = 'https://tioanime.com';
  for (const slug of ['solo-leveling', 'solo-leveling-ore-dake-level-up-na-ken']) {
    const page = await req(`${base}/ver/${slug}-1`, `${base}/`);
    if (page.status !== 200) { row('tioanime', `ver/${slug}-1`, `${page.status} ${page.ms}ms ${page.error || ''}`); continue; }
    const block = (page.body.match(/var videos = (\[[\s\S]*?\]);/) || [])[1] || '';
    let urls = [];
    try { urls = JSON.parse(block).map((e) => (typeof e === 'string' ? e : e.server || e.url)) .filter((u) => typeof u === 'string'); } catch { /* bloque raro */ }
    row('tioanime', `ver/${slug}-1`, `${page.status} ${page.ms}ms bytes=${page.body.length} · videos=${urls.length}${urls.length ? ` · ${[...new Set(urls.map(hostOf))].slice(0, 5).join(',')}` : ''}`);
    for (const url of urls.slice(0, 4)) await testPlayer('tioanime', url, `${base}/`);
    if (urls.length) return;
  }
  // Respaldo: la ficha y su listado de episodios.
  const anime = await req(`${base}/anime/solo-leveling`, `${base}/`);
  row('tioanime', 'anime/solo-leveling', `${anime.status} ${anime.ms}ms bytes=${anime.body.length}${anime.error ? ` · ${anime.error}` : ''}`);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const seccion = async (name, fn) => {
    try { await fn(); } catch (err) { row(name, 'error', String(err?.message || err).slice(0, 100)); }
  };
  await seccion('animeav1', animeav1);
  await seccion('tioanime', tioanime);

  const md = ['| Sitio | Paso | Resultado |', '|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.note.replace(/\|/g, '/')} |`);
  md.push('', 'AnimeAV1 y TioAnime con las rutas correctas y más plazo.');
  fs.writeFileSync('.probe/anime-players2.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
