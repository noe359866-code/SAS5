#!/usr/bin/env node
/**
 * Sonda de candidatas, tercera tanda: la familia `/wp-api/v1` y `la.movie`.
 *
 * La segunda tanda dejó cuatro sitios con API JSON que responde desde el
 * runner (allpeliculas.la, lamovie.org, allcalidad.re y hackstore2.com) y sus
 * reproductores devolvieron `embeds` con `lang`/`quality`. Aquí se recorre la
 * cadena completa con identificadores reales:
 *
 *   buscar → ficha/episodio → /player → embed → ¿hay medio directo?
 *
 * Si el embed sirve `.mp4`/`.m3u8` con audio declarado, el sitio entra en el
 * addon con una sola petición de búsqueda y otra de reproductor.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 12_000;
const MAX = 700 * 1024;

const rows = [];
const row = (site, step, status, bytes, note) => {
  rows.push({ site, step, status, bytes, note });
  console.log(`| ${site} | ${step} | ${status} | ${bytes} | ${note} |`);
};

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return '?'; } };
const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.hostname}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 70); }
};

function classify(url) {
  const kind = extractorFor(url);
  if (kind && kind !== 'opaque') return `extraíble(${kind})`;
  if (kind === 'opaque') return 'opaco';
  if (/vimeos\./.test(String(url))) return 'vimeos';
  if (/la\.movie/.test(String(url))) return 'la.movie';
  return '—';
}

async function get(url, { headers = {}, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    const text = (await res.text()).slice(0, MAX);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, body: '', type: '', error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const json = (res) => { try { return JSON.parse(res.body); } catch { return null; } };

/** Inspecciona una página de embed: medios literales, iframes y clasificación. */
async function inspectEmbed(site, label, url, referer) {
  if (!url || !/^https?:/.test(url)) return;
  const res = await get(url, { headers: { Referer: referer, Accept: 'text/html,*/*;q=0.8' } });
  const media = [...new Set([...res.body.matchAll(/https?:[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi)].map((m) => m[0]))];
  const frames = [...new Set([...res.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => { try { return new URL(m[1], url).hostname; } catch { return '?'; } }))].filter((h) => !/google|facebook|youtube|doubleclick/.test(h));
  const marks = ['#EXTM3U', 'playlist', 'source', 'video', 'data-video', 'packed'].map((m) => `${m}=${(res.body.match(new RegExp(m, 'gi')) || []).length}`).join(' ');
  row(site, `· ${label}`, res.status, res.body.length,
    `${classify(url)} · medios=${media.length}${media.length ? ` (${[...new Set(media.map(hostOf))].slice(0, 3).join(',')})` : ''}${frames.length ? ` · iframes=${frames.slice(0, 3).join(',')}` : ''} · ${marks}`);
  for (const frame of [...new Set([...res.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))].slice(0, 2)) {
    const child = new URL(frame, url).href;
    if (/google|facebook|youtube|doubleclick/.test(child)) continue;
    await inspectEmbed(site, `└ iframe ${hostOf(child)}`, child, url);
  }
}

/** Extrae la lista de `embeds` de las respuestas de player de cada CMS. */
function embedsOf(data) {
  if (!data) return [];
  const bag = data.data && typeof data.data === 'object' ? data.data : data;
  const list = bag.embeds || bag.servers || bag.links || bag.videos || [];
  if (Array.isArray(list) && list.length) {
    return list.map((e) => (typeof e === 'string' ? { url: e } : e)).filter((e) => e && (e.url || e.file || e.link));
  }
  return [];
}

const embedUrl = (e) => e.url || e.file || e.link || '';

async function wpApiFamily() {
  const casos = [
    { site: 'allpeliculas.la', base: 'https://allpeliculas.la', tipo: 'serie', q: 'the pitt' },
    { site: 'lamovie.org', base: 'https://lamovie.org', tipo: 'serie', q: 'the pitt' },
    { site: 'lamovie.cc', base: 'https://lamovie.cc', tipo: 'pelicula', q: 'la odisea' },
  ];
  for (const { site, base, tipo, q } of casos) {
    const search = await get(`${base}/wp-api/v1/search?q=${encodeURIComponent(q)}&postType=any&postsPerPage=5`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
    const posts = (json(search)?.data?.posts) || [];
    row(site, `wp-api buscar «${q}»`, search.status, search.body.length,
      posts.length ? `posts=${posts.length} · ${posts.map((p) => `${p.type}:${p._id}`).slice(0, 3).join(' ')}` : search.error || 'sin posts');
    const post = posts.find((p) => (tipo === 'serie' ? p.type !== 'movies' : p.type === 'movies')) || posts[0];
    if (!post) continue;

    const ficha = await get(`${base}/wp-api/v1/single/${post.type || 'movies'}?_id=${post._id}`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
    row(site, `wp-api ficha ${post.type}`, ficha.status, ficha.body.length, ficha.status === 200 ? `claves=${Object.keys(json(ficha)?.data || {}).slice(0, 7).join(',')}` : 'sin ficha');

    // Series: hay que bajar al episodio.
    let playerId = post._id;
    if (tipo === 'serie') {
      const eps = await get(`${base}/wp-api/v1/single/episodes/list?_id=${post._id}&season=1&page=1&postsPerPage=200`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
      const list = (json(eps)?.data?.posts) || [];
      const first = list.find((e) => Number(e.episode_number) === 1) || list[0];
      row(site, 'wp-api episodios', eps.status, eps.body.length, list.length ? `episodios=${list.length} · ep1=${first && first._id}` : 'sin episodios');
      if (first) playerId = first._id;
    }

    const player = await get(`${base}/wp-api/v1/player?postId=${playerId}&demo=0`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
    const embeds = embedsOf(json(player));
    row(site, 'wp-api player', player.status, player.body.length,
      `embeds=${embeds.length}${embeds.length ? ` · ${embeds.slice(0, 4).map((e) => `${classify(embedUrl(e))}/${e.lang || '?'}/${e.quality || '?'}`).join(' ')}` : player.error || '—'}`);
    for (const embed of embeds.slice(0, 3)) {
      const url = embedUrl(embed);
      const abs = /^https?:/.test(url) ? url : url.startsWith('//') ? `https:${url}` : new URL(url, base).href;
      await inspectEmbed(site, `${redact(abs)}`, abs, `${base}/`);
    }
  }
}

async function allcalidad() {
  const base = 'https://allcalidad.re';
  const search = await get(`${base}/api/rest/search?post_type=movies%2Ctvshows&query=la%20odisea&posts_per_page=4`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
  const posts = json(search)?.data?.posts || json(search)?.posts || [];
  row('allcalidad.re', 'API buscar', search.status, search.body.length,
    posts.length ? posts.map((p) => `${p.type || p.post_type}:${p._id}`).slice(0, 3).join(' ') : 'sin posts');
  const post = posts.find((p) => /movie/i.test(String(p.type || p.post_type))) || posts[0];
  if (!post) return;
  for (const ruta of [`${base}/api/rest/player?post_id=${post._id}&_any=1`, `${base}/api/rest/player?post_id=${post._id}`]) {
    const player = await get(ruta, { headers: { Accept: 'application/json', Referer: `${base}/`, 'X-Requested-With': 'XMLHttpRequest' } });
    const embeds = embedsOf(json(player));
    row('allcalidad.re', 'API player', player.status, player.body.length,
      `embeds=${embeds.length}${embeds.length ? ` · ${embeds.slice(0, 4).map((e) => `${classify(embedUrl(e))}/${e.lang || '?'}`).join(' ')}` : (player.body.slice(0, 70).replace(/\s+/g, ' ') || '—')}`);
    for (const embed of embeds.slice(0, 3)) {
      const url = embedUrl(embed);
      const abs = /^https?:/.test(url) ? url : new URL(url, base).href;
      await inspectEmbed('allcalidad.re', redact(abs), abs, `${base}/`);
    }
    if (embeds.length) break;
  }
}

async function hackstore() {
  const base = 'https://hackstore2.com';
  const single = await get(`${base}/api/rest/single?post_name=la-odisea&post_type=movies`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
  const data = json(single)?.data || {};
  row('hackstore2.com', 'API ficha', single.status, single.body.length, data._id ? `_id=${data._id} · «${String(data.title || '').slice(0, 30)}»` : 'sin ficha');
  if (!data._id) return;
  const player = await get(`${base}/api/rest/player?post_id=${data._id}`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
  const embeds = embedsOf(json(player));
  row('hackstore2.com', 'API player', player.status, player.body.length,
    `embeds=${embeds.length}${embeds.length ? ` · ${embeds.slice(0, 4).map((e) => `${classify(embedUrl(e))}/${e.lang || '?'}`).join(' ')}` : (player.body.slice(0, 70).replace(/\s+/g, ' ') || '—')}`);
  for (const embed of embeds.slice(0, 3)) {
    const url = embedUrl(embed);
    const abs = /^https?:/.test(url) ? url : new URL(url, base).href;
    await inspectEmbed('hackstore2.com', redact(abs), abs, `${base}/`);
  }
}

/** `la.movie`: host al que apuntan los embeds de allpeliculas y lamovie. */
async function laMovie() {
  for (const path of ['/', '/e/the-pitt-1x1', '/embed/the-pitt-1x1']) {
    const res = await get(`https://la.movie${path}`, { headers: { Referer: 'https://allpeliculas.la/' } });
    const media = (res.body.match(/\.(?:m3u8|mp4)/g) || []).length;
    row('la.movie', path, res.status, res.body.length,
      `${res.type} · medios=${media} · ${['iframe', 'data-video', 'video', 'packed'].map((m) => `${m}=${(res.body.match(new RegExp(m, 'gi')) || []).length}`).join(' ')}${res.error ? ` · ${res.error}` : ''}`);
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  const seccion = async (name, fn) => {
    try { await fn(); } catch (err) { rows.push({ site: name, step: 'error', status: '—', bytes: '—', note: String(err?.message || err).slice(0, 120) }); }
  };
  await seccion('wp-api', wpApiFamily);
  await seccion('allcalidad.re', allcalidad);
  await seccion('hackstore2.com', hackstore);
  await seccion('la.movie', laMovie);

  const md = ['| Sitio | Paso | HTTP | Bytes | Nota |', '|---|---|---|---:|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.status} | ${r.bytes} | ${r.note} |`);
  md.push('', 'Tercera tanda: cadena completa buscar → player → embed en las APIs latinas.');
  fs.writeFileSync('.probe/candidates3.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
