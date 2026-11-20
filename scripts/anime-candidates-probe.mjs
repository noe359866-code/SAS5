#!/usr/bin/env node
/**
 * Sonda de candidatas de anime (20-11-2026).
 *
 * El addon solo tiene una fuente de anime: `animeflv.or.at`, subtitulada. Aquí
 * se mide el resto de sitios que usan los complementos latinos de Nuvio
 * (`Droydr13/pluggin-latino`) desde el mismo runner que después ejecuta el
 * Worker, para ver cuál publica un medio que el addon sepa resolver:
 *
 *   1. Portada: estado, motor y enlaces de ficha que se ven en el HTML.
 *   2. Buscador: se prueban los patrones conocidos y se queda el que responde.
 *   3. Ficha/episodio: iframes, medios literales y atributos `data-*`.
 *   4. Cada visor se clasifica con `lib/extractors.js`: extraíble, Vimeos,
 *      opaco o desconocido. Un sitio cuyos visores son todos opacos no aporta
 *      nada aunque responda 200.
 *
 * Solo se piden páginas HTML; no se descargan segmentos ni se imprimen URLs
 * firmadas.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.6' };
const TIMEOUT = 12_000;
const MAX = 1200 * 1024;

const SITES = [
  { key: 'jkanime', base: 'https://jkanime.net', search: ['/buscar/{q}/'], detail: /\/(?:[a-z0-9-]+)\/\d+\/?$|\/anime\// },
  { key: 'monoschinos2', base: 'https://monoschinos2.com', search: ['/buscar?q={q}'], detail: /\/(?:anime|ver)\// },
  { key: 'monoschinos', base: 'https://monoschinos.com', search: ['/buscar?q={q}'], detail: /\/(?:anime|ver)\// },
  { key: 'tioanime', base: 'https://tioanime.com', search: ['/directorio?q={q}', '/buscar?q={q}'], detail: /\/ver\// },
  { key: 'latanime', base: 'https://latanime.org', search: ['/?s={q}', '/busqueda?q={q}'], detail: /\/(?:ver|anime)\// },
  { key: 'katanime', base: 'https://katanime.net', search: ['/?s={q}', '/buscar?q={q}'], detail: /\/(?:ver|anime|episodio)\// },
  { key: 'animeav1', base: 'https://animeav1.com', search: ['/catalogo?q={q}', '/buscar?q={q}'], detail: /\/(?:anime|media)\// },
  { key: 'animejl', base: 'https://www.anime-jl.net', search: ['/anime?search={q}', '/buscar?q={q}'], detail: /\/(?:anime|ver)\// },
  { key: 'henaojara', base: 'https://henaojara.com', search: ['/?s={q}'], detail: /\/(?:anime|serie|ver)\// },
  { key: 'donghualife', base: 'https://donghualife.com', search: ['/?s={q}', '/buscar?q={q}'], detail: /\/(?:serie|anime|ver)\// },
  { key: 'danimados', base: 'https://danimados.cc', search: ['/?s={q}'], detail: /\/serie\// },
];

const QUERY = 'solo leveling';

const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.hostname}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 80); }
};

async function get(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal,
      headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) } });
    const text = (await res.text()).slice(0, MAX);
    return { status: res.status, body: text, type: (res.headers.get('content-type') || '').split(';')[0], url: res.url || url };
  } catch (err) {
    return { status: 0, body: '', type: '', error: String(err?.name || err?.message || err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };

function classify(url) {
  const kind = extractorFor(url);
  if (kind && kind !== 'opaque') return `extraíble(${kind})`;
  if (kind === 'opaque') return 'opaco';
  if (/vimeos\./.test(String(url))) return 'vimeos';
  return '—';
}

/** Marcas del motor, para saber con qué nos enfrentamos. */
function engine(html) {
  return [
    ['wordpress', /wp-content/i], ['animeflv', /animeflv/i], ['dooplay', /dooplay|doo_player/i],
    ['jkplayer', /jkplayer/i], ['next', /__NEXT_DATA__/], ['nuxt', /__NUXT__/],
    ['laravel-api', /\/api\/(?:v1|rest)/i], ['vue', /v-(?:if|for|bind)="/],
  ].filter(([, re]) => re.test(html)).map(([name]) => name).join(',') || '—';
}

/** Página de ficha/episodio: lo que publica de verdad. */
async function inspectPage(site, url, referer) {
  const res = await get(url, referer);
  if (!res.body) return { status: res.status, note: res.error || 'sin cuerpo' };
  const frames = [...new Set([...res.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  const dataUrls = [...new Set([...res.body.matchAll(/data-(?:src|url|video|player|file)=["']([^"']+)["']/gi)].map((m) => m[1]))];
  const media = [...new Set([...res.body.matchAll(/https?:[^\s"'<>\\]+?\.(?:m3u8|mp4)/gi)].map((m) => m[0]))];
  const videos = (res.body.match(/<video/gi) || []).length;
  const players = [
    ...frames.map((f) => ({ raw: f, how: 'iframe' })),
    ...dataUrls.filter((u) => /^https?:|^\/\//.test(u)).map((u) => ({ raw: u, how: 'data-*' })),
  ];
  const graded = players.slice(0, 6).map((p) => {
    let abs = p.raw;
    try { abs = new URL(p.raw, url).href; } catch { /* ruta rara */ }
    return `${p.how}:${hostOf(abs)}=${classify(abs)}`;
  });
  return {
    status: res.status,
    note: `iframes=${frames.length} data=${dataUrls.length} video=${videos} medios=${media.length}${media.length ? ` (${[...new Set(media.map(hostOf))].slice(0, 3).join(',')})` : ''}${graded.length ? ` · ${graded.join(' ')}` : ''} · motor=${engine(res.body)}`,
    best: players.map((p) => { try { return new URL(p.raw, url).href; } catch { return null; } }).filter(Boolean),
  };
}

const rows = [];
const row = (site, step, status, bytes, note) => {
  rows.push({ site, step, status, bytes, note });
  console.log(`| ${site} | ${step} | ${status} | ${bytes} | ${note} |`);
};

async function probeSite(site) {
  const home = await get(`${site.base}/`);
  const links = [...new Set([...home.body.matchAll(/href=["']([^"']+)["']/gi)]
    .map((m) => { try { return new URL(m[1], site.base).href; } catch { return null; } })
    .filter((u) => u && site.detail.test(new URL(u).pathname)))].slice(0, 3);
  row(site.key, 'portada', home.status, home.body.length,
    `${home.error || ''} motor=${engine(home.body)} fichas=${links.length}${links[0] ? ` · ${redact(links[0])}` : ''}`);

  // Buscador: el primero que responda 200 con enlaces de ficha.
  let found = null;
  for (const pattern of site.search) {
    const url = new URL(pattern.replace('{q}', encodeURIComponent(QUERY)), site.base).href;
    const res = await get(url, `${site.base}/`);
    const hits = [...new Set([...res.body.matchAll(/href=["']([^"']+)["']/gi)]
      .map((m) => { try { return new URL(m[1], site.base).href; } catch { return null; } })
      .filter((u) => u && site.detail.test(new URL(u).pathname)))];
    row(site.key, `buscar ${pattern.split('?')[0]}`, res.status, res.body.length,
      `${res.error || ''} fichas=${hits.length}${hits[0] ? ` · ${redact(hits[0])}` : ''}`);
    if (!found && res.status === 200 && hits.length) found = hits[0];
    if (found) break;
  }

  const target = found || links[0];
  if (!target) { row(site.key, 'ficha', '—', '—', 'sin enlace que abrir'); return; }
  const detail = await inspectPage(site.key, target, `${site.base}/`);
  row(site.key, 'ficha', detail.status, '—', detail.note);
  if (!detail.best?.length) return;

  // Un nivel más: el primer visor que no sea ya un extractor conocido.
  const next = detail.best.find((u) => !/youtube|facebook|google/.test(u));
  if (!next) return;
  const child = await inspectPage(site.key, next, target);
  row(site.key, `· visor ${hostOf(next)}`, child.status, '—', child.note);
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  for (const site of SITES) {
    try { await probeSite(site); } catch (err) { row(site.key, 'error', '—', '—', String(err?.message || err).slice(0, 90)); }
  }
  const md = ['| Sitio | Paso | HTTP | Bytes | Nota |', '|---|---|---|---:|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.status} | ${r.bytes} | ${r.note.replace(/\|/g, '/')} |`);
  md.push('', 'Candidatas de anime: solo HTML público, sin segmentos de vídeo.');
  fs.writeFileSync('.probe/anime-candidates.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
