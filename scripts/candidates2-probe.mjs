#!/usr/bin/env node
/**
 * Sonda de candidatas, segunda tanda: los sitios que usan los complementos
 * latinos de Nuvio (`Droydr13/pluggin-latino`).
 *
 * Se prueban tres familias:
 *
 *   A. Sitios con API JSON propia (allcalidad, hackstore×2, pelisgo): si el
 *      buscador y el reproductor responden sin sesión, son baratos y estables.
 *   B. `embed69.org`, que se direcciona por IMDb (`/f/<tt>[-SxEE]`): si sirve
 *      el medio sin captcha, un solo host daría catálogo completo sin buscador.
 *   C. Sitios WordPress con visores de terceros: se mira qué host sirve y si
 *      el addon ya lo sabe resolver (Vimeos, Byse, Streamtape, Mixdrop,
 *      Videohel) o es de los opacos.
 *
 * Solo se piden páginas y JSON; no se descargan segmentos ni se imprimen URLs
 * firmadas.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 12_000;
const MAX = 900 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw, 'https://x.invalid');
    const names = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 90); }
};

async function get(url, { headers = {}, method = 'GET', body, max = MAX } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, body, redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    if (method === 'HEAD') { clearTimeout(timer); return { status: res.status, body: '', type: (res.headers.get('content-type') || '').split(';')[0] }; }
    const text = (await res.text()).slice(0, max);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, body: '', type: '', error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const hostsOf = (body, base) => [...new Set([...String(body).matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
  .map((m) => { try { return new URL(m[1], base).hostname; } catch { return null; } })
  .filter(Boolean))];

/** Clasifica un host con lo que ya sabe el addon. */
function classify(host) {
  const fake = `https://${host}/embed`;
  const kind = extractorFor(fake);
  if (kind && kind !== 'opaque') return `extraíble(${kind})`;
  if (kind === 'opaque') return 'opaco';
  if (/vimeos\./.test(host)) return 'vimeos';
  return '—';
}

const rows = [];
const row = (site, step, res, note) => {
  rows.push({ site, step, status: res?.status ?? '—', bytes: res?.body?.length ?? '—', note });
  console.log(`| ${site} | ${step} | ${res?.status ?? '—'} | ${res?.body?.length ?? '—'} | ${note} |`);
};

/* A. APIs JSON ------------------------------------------------------------ */

async function jsonApi(site, base, steps) {
  for (const step of steps) {
    const res = await get(step.url);
    let note = res.error || `${res.type}`;
    if (res.status === 200 && res.body) {
      let data = null;
      try { data = JSON.parse(res.body); } catch { /* no JSON */ }
      if (data) {
        const bag = data.data && typeof data.data === 'object' ? { ...data, ...data.data } : data;
        const list = bag.posts || bag.results || bag.items || bag.servers || bag.links || [];
        const count = Array.isArray(list) ? list.length : Array.isArray(bag.data) ? bag.data.length : 0;
        const first = Array.isArray(list) && list[0] && typeof list[0] === 'object' ? list[0] : null;
        const id = first && (first._id || first.id || first.post_id || first.postId || '');
        const slug = first && (first.post_name || first.slug || first.title || '');
        const hosts = [...new Set(JSON.stringify(bag).match(/https?:\/\/[a-z0-9.-]+/gi) || [])]
          .map((u) => { try { return new URL(u).hostname; } catch { return null; } })
          .filter((h) => h && !/themoviedb|imdb|google|gstatic|w3\.org/.test(h));
        note = `claves=${Object.keys(bag).slice(0, 6).join(',')} · lista=${count}${id ? ` · id=${String(id).slice(0, 24)}` : ''}${slug ? ` · «${String(slug).slice(0, 34)}»` : ''}${hosts.length ? ` · hosts=${hosts.slice(0, 5).map((h) => `${h}=${classify(h)}`).join(' ')}` : ''}`;
      } else {
        const media = (res.body.match(/\.(?:m3u8|mp4)/g) || []).length;
        note = `no JSON · ${res.body.slice(0, 60).replace(/\s+/g, ' ')}${media ? ` · medios=${media}` : ''}`;
      }
    }
    row(site, step.label, res, note);
  }
}

/* B. embed69 por IMDb ---------------------------------------------------- */

async function embed69() {
  for (const path of ['/f/tt0111161', '/f/tt0903747-1x01']) {
    const res = await get(`https://embed69.org${path}`, { headers: { Referer: 'https://embed69.org/' } });
    const media = (res.body.match(/\.(?:m3u8|mp4)/g) || []).length;
    const marks = ['captcha', 'challenge', 'playback', '/embed/', 'iframe'].map((m) => `${m}=${(res.body.match(new RegExp(m, 'gi')) || []).length}`).join(' ');
    row('embed69.org', path, res, `${marks} · medios=${media} · hosts=${hostsOf(res.body, 'https://embed69.org').filter((h) => !/embed69|google|cloudflare/.test(h)).slice(0, 4).join(',') || '—'}`);
  }
}

/* C. WordPress con visores de terceros ----------------------------------- */

const WP = [
  ['allpeliculas.la', 'https://allpeliculas.la'],
  ['areshd.com', 'https://areshd.com'],
  ['cinecalidad.vg', 'https://www.cinecalidad.vg'],
  ['entrepeliculasyseries.nz', 'https://entrepeliculasyseries.nz'],
  ['gnula.life', 'https://gnula.life'],
  ['homecine.to', 'https://www3.homecine.to'],
  ['pelispedia.mov', 'https://pelispedia.mov'],
  ['seriesmetro.net', 'https://www3.seriesmetro.net'],
  ['sololatino.net', 'https://sololatino.net'],
  ['tioplus.app', 'https://tioplus.app'],
  ['vimeus.com', 'https://vimeus.com'],
  ['vitaminagg.vip', 'https://vitaminagg.vip'],
  ['cuevana3.eu', 'https://wv3.cuevana3.eu'],
];

/** CMS `/wp-api/v1` (lamovie, hackstore.mx y familia): buscador y player JSON. */
async function wpApi(site, base) {
  const search = await get(`${base}/wp-api/v1/search?q=the+pitt&postType=any&postsPerPage=6`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
  let data = null;
  try { data = JSON.parse(search.body); } catch { /* no JSON */ }
  const posts = (data && data.data && data.data.posts) || [];
  row(site, 'wp-api /search', search, posts.length
    ? `posts=${posts.length} · ${posts[0].type} «${String(posts[0].title).slice(0, 30)}» id=${String(posts[0]._id).slice(0, 20)}`
    : search.error || `${search.type} · sin posts`);
  if (!posts.length) return false;
  const player = await get(`${base}/wp-api/v1/player?postId=${posts[0]._id}&demo=0`, { headers: { Accept: 'application/json', Referer: `${base}/` } });
  let play = null;
  try { play = JSON.parse(player.body); } catch { /* no JSON */ }
  const embeds = (play && play.data && play.data.embeds) || [];
  const hosts = [...new Set(embeds.map((e) => { try { return new URL(e.url).hostname; } catch { return '?'; } }))];
  const langs = [...new Set(embeds.map((e) => e.lang).filter(Boolean))].slice(0, 5);
  row(site, 'wp-api /player', player, `embeds=${embeds.length}${langs.length ? ` · lang=${langs.join('/')}` : ''}${hosts.length ? ` · ${hosts.slice(0, 5).map((h) => `${h}=${classify(h)}`).join(' ')}` : ''}`);
  return true;
}

/** vimeus.com: embed por TMDb con `view_key` fijo y JSON `#data`. */
async function vimeus() {
  const key = 'ttapaNFkp2YbIFMawxmnqCPcs0pRVzbjrI5r1-da5M4';
  const rutas = [
    ['película tmdb=13', `https://vimeus.com/e/movie?tmdb=13&view_key=${key}`],
    ['serie tmdb=1396', `https://vimeus.com/e/serie?tmdb=1396&se=1&ep=1&view_key=${key}`],
  ];
  for (const [label, url] of rutas) {
    const res = await get(url, { headers: { Referer: 'https://vimeus.com/' } });
    const match = res.body.match(/<script\s+type=["']text\/json["']\s+id=["']data["']>\s*(\{[\s\S]*?\})\s*<\/script>/i);
    let note = res.error || res.type;
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const embeds = data.servers || data.embeds || data.videos || (data.data && (data.data.servers || data.data.embeds)) || (Array.isArray(data) ? data : []);
        const list = Array.isArray(embeds) ? embeds : [];
        const hosts = [...new Set(list.map((e) => { try { return new URL(String(e.url || e.file || '')).hostname; } catch { return '?'; } }))];
        const langs = [...new Set(list.map((e) => e.lang || e.language || e.audio).filter(Boolean))].slice(0, 5);
        note = `JSON #data · claves=${Object.keys(data).slice(0, 6).join(',')} · servidores=${list.length}${langs.length ? ` · lang=${langs.join('/')}` : ''}${hosts.length ? ` · ${hosts.slice(0, 5).map((h) => `${h}=${classify(h)}`).join(' ')}` : ''}`;
      } catch (err) { note = `JSON #data ilegible (${String(err.message).slice(0, 30)})`; }
    }
    row('vimeus.com', label, res, note);
  }
}

async function wordpress() {
  for (const [site, base] of WP) {
    if (await wpApi(site, base)) continue;
    const search = await get(`${base}/?s=the+pitt`);
    const alt = search.status !== 200 || (search.body.match(/<article/gi) || []).length === 0
      ? await get(`${base}/search?q=the+pitt`) : null;
    const used = alt && alt.status === 200 ? alt : search;
    const links = [...new Set([...used.body.matchAll(/href=["']([^"']*\/(?:pelicula|serie|movie|series|tv|ver-pelicula)\/[^"']+)["']/gi)]
      .map((m) => m[1]).filter((h) => !/\/(?:pelicula|serie|movie|series|tv)s?\/?$/.test(h)))].slice(0, 3);
    const hits = (used.body.match(/<article/gi) || []).length;
    row(site, `buscar${alt && alt.status === 200 ? ' (/search)' : ' (/?s=)'}`, used, `resultados=${hits} · fichas=${links.length}${links[0] ? ` · ${redact(new URL(links[0], base).href)}` : ''}`);
    if (!links[0]) continue;

    const detailUrl = new URL(links[0], base).href;
    const detail = await get(detailUrl);
    const iframes = [...new Set([...detail.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))]
      .map((u) => { try { return new URL(u, detailUrl).hostname; } catch { return '?'; } });
    const graded = [...new Set(iframes)].slice(0, 5).map((h) => `${h}=${classify(h)}`);
    const media = (detail.body.match(/\.(?:m3u8|mp4)/g) || []).length;
    row(site, '· ficha', detail, `iframes=${iframes.length}${graded.length ? ` · ${graded.join(' ')}` : ''} · medios=${media}`);
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });

  const seccion = async (name, fn) => {
    try { await fn(); } catch (err) { rows.push({ site: name, step: 'error', status: '—', bytes: '—', note: String(err?.message || err).slice(0, 120) }); }
  };

  await seccion('allcalidad.re', () => jsonApi('allcalidad.re', 'https://allcalidad.re', [
    { label: 'API /search', url: 'https://allcalidad.re/api/rest/search?post_type=movies%2Ctvshows&query=odisea&posts_per_page=4' },
    { label: 'API /player', url: 'https://allcalidad.re/api/rest/player?post_id=1&_any=1' },
  ]));
  await seccion('hackstore2.com', () => jsonApi('hackstore2.com', 'https://hackstore2.com', [
    { label: 'API /single', url: 'https://hackstore2.com/api/rest/single?post_name=la-odisea&post_type=movies' },
    { label: 'API /player', url: 'https://hackstore2.com/api/rest/player?post_id=1' },
  ]));
  await seccion('hackstore.mx', () => jsonApi('hackstore.mx', 'https://hackstore.mx', [
    { label: 'API /single', url: 'https://hackstore.mx/wp-api/v1/single/movies?slug=la-odisea&postType=movies' },
    { label: 'API /player', url: 'https://hackstore.mx/wp-api/v1/player?postId=1' },
  ]));
  await seccion('lamovie.org', () => wpApi('lamovie.org', 'https://lamovie.org'));
  await seccion('lamovie.cc', () => wpApi('lamovie.cc', 'https://lamovie.cc'));
  await seccion('pelisgo.online', () => jsonApi('pelisgo.online', 'https://pelisgo.online', [
    { label: 'API /search', url: 'https://pelisgo.online/api/search?q=odisea&limit=4' },
  ]));

  await seccion('embed69.org', embed69);
  await seccion('vimeus.com', vimeus);
  await seccion('WordPress', wordpress);

  const md = ['| Sitio | Paso | HTTP | Bytes | Nota |', '|---|---|---|---:|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.status} | ${r.bytes} | ${r.note} |`);
  md.push('', 'Segunda tanda de candidatas (complementos latinos de Nuvio): solo HTML y JSON público.');
  fs.writeFileSync('.probe/candidates2.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
