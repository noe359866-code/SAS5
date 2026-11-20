#!/usr/bin/env node
/**
 * Sonda de anime, segunda vuelta: los visores de verdad.
 *
 * La primera vuelta (`scripts/anime-candidates-probe.mjs`) encontró que casi
 * todos estos sitios no publican los visores como `<iframe>`, sino dentro de
 * JavaScript. Leyendo los complementos latinos de Nuvio se supo dónde mirar:
 *
 *   tioanime   `/ver/<slug>-<n>`  -> `var videos = [ … ]`
 *   latanime   `/ver/<slug>-episodio-<n>` -> `data-player="<base64>"`
 *   monoschinos `/anime/<slug>/episodio-<n>` -> `data-player` + `data-encrypt`
 *   animeav1   `/media/<slug>/<n>` -> `embeds: { SUB: [...], DUB: [...] }`
 *
 * Aquí se recorre la cadena con un anime conocido y se clasifica cada visor con
 * `lib/extractors.js`; a los extraíbles se les pide el medio de verdad. Los que
 * declaran `DUB` valen como latino y los `SUB` como subtitulado.
 *
 * No se descargan segmentos ni se imprimen URLs firmadas.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor, extractEmbed } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 15_000;
const MAX = 1500 * 1024;
const QUERY = 'solo leveling';

const rows = [];
const row = (site, step, note) => { rows.push({ site, step, note }); console.log(`| ${site} | ${step} | ${note} |`); };

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };
const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.hostname}${u.pathname.slice(0, 40)}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 60); }
};

async function req(url, { method = 'GET', body, headers = {}, referer } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, redirect: 'follow', signal: controller.signal,
      headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}), ...headers } });
    const text = method === 'HEAD' ? '' : (await res.text()).slice(0, MAX);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, body: '', type: '', error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const b64 = (raw) => {
  try { return Buffer.from(String(raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
};

function classify(url) {
  const kind = extractorFor(url);
  if (kind && kind !== 'opaque') return `extraíble(${kind})`;
  if (kind === 'opaque') return 'opaco';
  if (/vimeos\./.test(url)) return 'vimeos';
  return '—';
}

/** Prueba un visor: clasificación, extracción y forma del medio. */
async function testPlayer(site, url, referer, label = '') {
  const kind = extractorFor(url) || (/vimeos\./.test(url) ? 'vimeos' : '');
  const head = `${label ? `${label} · ` : ''}${hostOf(url)}=${kind || 'desconocido'}`;
  if (!kind || kind === 'opaque') { row(site, 'visor', `${head} (no se abre)`); return; }
  if (kind === 'vimeos') {
    const { resolveVimeosEmbed } = require('../lib/vimeos');
    const { providerHttp } = require('../lib/providerHttp');
    try {
      const media = await resolveVimeosEmbed(url, referer, providerHttp(12_000, 4));
      row(site, 'visor', `${head} → ${media ? 'HLS ✓' : 'sin medio'}`);
    } catch (err) { row(site, 'visor', `${head} → error ${String(err?.message || err).slice(0, 40)}`); }
    return;
  }
  try {
    const out = await extractEmbed(url, { timeoutMs: 12_000, referer });
    const kinds = [...new Set((out.sources || []).map((s) => s.kind))].join('/');
    row(site, 'visor', `${head} → ok=${out.ok} fuentes=${out.sources?.length || 0}${kinds ? ` (${kinds})` : ''}${out.reason ? ` · ${out.reason}` : ''}`);
  } catch (err) { row(site, 'visor', `${head} → error ${String(err?.message || err).slice(0, 40)}`); }
}

/* tioanime ---------------------------------------------------------------- */

async function tioanime() {
  const base = 'https://tioanime.com';
  const search = await req(`${base}/api/search`, {
    method: 'POST', body: `value=${encodeURIComponent(QUERY)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    referer: `${base}/`,
  });
  let slug = '';
  try { slug = (JSON.parse(search.body)[0] || {}).slug || ''; } catch { /* no JSON */ }
  row('tioanime', 'API /api/search', `${search.status} · ${slug || search.error || 'sin resultado'}`);
  if (!slug) return;
  const page = await req(`${base}/ver/${slug}-1`, { referer: `${base}/` });
  const block = (page.body.match(/var videos = (\[[\s\S]*?\]);/) || [])[1] || '';
  let urls = [];
  try { urls = JSON.parse(block).map((entry) => entry.server || entry.url || entry).filter((u) => typeof u === 'string'); } catch { /* bloque raro */ }
  row('tioanime', 'episodio 1', `${page.status} · videos=${urls.length}${urls.length ? ` · ${[...new Set(urls.map(hostOf))].slice(0, 5).join(',')}` : ''}`);
  for (const url of urls.slice(0, 4)) await testPlayer('tioanime', url, `${base}/`);
}

/* latanime ---------------------------------------------------------------- */

async function latanime() {
  const base = 'https://latanime.org';
  const search = await req(`${base}/?s=${encodeURIComponent(QUERY)}`, { referer: `${base}/` });
  const anime = (search.body.match(/href="([^"]*\/anime\/[^"]+)"/) || [])[1] || '';
  row('latanime', 'buscar', `${search.status} · ${anime ? redact(anime) : 'sin ficha'}`);
  if (!anime) return;
  const detail = await req(anime, { referer: `${base}/` });
  const ep = (detail.body.match(/href="([^"]*\/ver\/[^"]*episodio-?1\/?)"/) || [])[1] || `${anime.replace('/anime/', '/ver/').replace(/\/+$/, '')}-episodio-1`;
  const episode = await req(ep, { referer: anime });
  const players = [...episode.body.matchAll(/data-player=["']([^"']+)["']/gi)].map((m) => b64(m[1]))
    .map((url) => url
      .replace(/^https?:\/\/monoschinos2\.com\/reproductor\?url=/, '')
      .replace(/^https?:\/\/mojon\.latanime\.org\/aqua\/fn\?url=/, ''))
    .map((url) => { try { return /%3A/.test(url) ? decodeURIComponent(url) : url; } catch { return url; } })
    .filter((url) => /^https?:/.test(url));
  row('latanime', 'episodio 1', `${episode.status} · players=${players.length}${players.length ? ` · ${[...new Set(players.map(hostOf))].slice(0, 5).join(',')}` : ''}`);
  for (const url of [...new Set(players)].slice(0, 4)) await testPlayer('latanime', url, ep, 'latino');
}

/* animeav1 ---------------------------------------------------------------- */

async function animeav1() {
  const base = 'https://animeav1.com';
  const search = await req(`${base}/catalogo?q=${encodeURIComponent(QUERY)}`, { referer: `${base}/` });
  const media = (search.body.match(/href="([^"]*\/media\/[^"/]+)"/) || [])[1] || '';
  row('animeav1', 'buscar', `${search.status} · ${media ? redact(media) : 'sin ficha'}`);
  if (!media) return;
  const episodeUrl = `${media.replace(/\/+$/, '')}/1`;
  const page = await req(episodeUrl, { referer: media });
  const zone = page.body.slice(page.body.indexOf('embeds:'), page.body.indexOf('embeds:') + 20000);
  const groups = [...zone.matchAll(/(SUB|DUB)\s*:\s*\[([\s\S]*?)\]/g)];
  const urls = [];
  for (const group of groups) {
    const audio = group[1] === 'DUB' ? 'latino' : 'subtitulado';
    for (const m of group[2].matchAll(/url\s*:\s*"((?:[^"\\]|\\.)+)"/g)) {
      let url = m[1].replace(/\\(.)/g, '$1');
      if (/^https?:/.test(url)) urls.push({ url, audio });
    }
  }
  row('animeav1', 'episodio 1', `${page.status} · embeds=${urls.length}${urls.length ? ` · ${urls.slice(0, 5).map((u) => `${hostOf(u.url)}/${u.audio}`).join(' ')}` : ''}`);
  for (const entry of urls.slice(0, 4)) await testPlayer('animeav1', entry.url, episodeUrl, entry.audio);
}

/* monoschinos ------------------------------------------------------------- */

async function monoschinos() {
  const base = 'https://monoschinos.st';
  const search = await req(`${base}/buscar?q=${encodeURIComponent(QUERY)}`, { referer: `${base}/` });
  const anime = (search.body.match(/href="([^"]*\/anime\/[^"]+)"/) || [])[1] || '';
  row('monoschinos', 'buscar', `${search.status} · ${anime ? redact(anime) : 'sin ficha'}`);
  if (!anime) return;
  const detail = await req(anime, { referer: `${base}/` });
  const ep = (detail.body.match(/href="([^"]*\/ver\/[^"]*episodio-?1\/?)"/) || [])[1] || '';
  if (!ep) { row('monoschinos', 'episodio 1', 'sin enlace'); return; }
  const episode = await req(ep, { referer: anime });
  const players = [...episode.body.matchAll(/data-player=["']([^"']+)["']/gi)]
    .map((m) => b64(m[1]).replace(/^https?:\/\/monoschinos2\.com\/reproductor\?url=/, ''))
    .filter((url) => /^https?:/.test(url));
  row('monoschinos', 'episodio 1', `${episode.status} · players=${players.length}${players.length ? ` · ${[...new Set(players.map(hostOf))].slice(0, 5).join(',')}` : ''}`);
  for (const url of [...new Set(players)].slice(0, 4)) await testPlayer('monoschinos', url, ep);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const seccion = async (name, fn) => {
    try { await fn(); } catch (err) { row(name, 'error', String(err?.message || err).slice(0, 100)); }
  };
  await seccion('tioanime', tioanime);
  await seccion('latanime', latanime);
  await seccion('animeav1', animeav1);
  await seccion('monoschinos', monoschinos);

  const md = ['| Sitio | Paso | Resultado |', '|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.note.replace(/\|/g, '/')} |`);
  md.push('', 'Visores de anime: clasificación y, en los extraíbles, el medio real.');
  fs.writeFileSync('.probe/anime-players.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
