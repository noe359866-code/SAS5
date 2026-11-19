#!/usr/bin/env node
/**
 * Sonda de pelisjuanita.org (solo diagnóstico).
 *
 * El sitio es una SPA «vidapi» (`data-render="react"`, tema `popr`) que se
 * alimenta de su propia API REST. La portada publica `window.siteConfig` con
 * los endpoints y las rutas; de ahí sale todo lo que se prueba aquí:
 *
 *   1. `/api/rest/v1/search?q=…`            → resultados de búsqueda.
 *   2. `/api/rest/v1/content/<kind>/<slug>` → ficha (¿trae servidores?).
 *   3. `/api/rest/v1/episode-seasons` y `/api/rest/v1/episodes`.
 *   4. `/api/play`, `/e/<token>` y el player (`player.base_url`).
 *   5. La ficha HTML (`/pelicula/<slug>`, `/serie/<slug>`) por si el JSON
 *      no basta.
 *
 * Guarda cada JSON en `.probe/html/` para poder usarlo como fixture y escribe
 * `.probe/pelisjuanita.md`. No descarga vídeo ni imprime tokens completos.
 */

const BASE = 'https://pelisjuanita.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const MAX = 1024 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw);
    const names = [...u.searchParams.keys()];
    return `${u.host}${u.pathname}${names.length ? '?' + names.map((n) => `${n}=…`).join('&') : ''}`;
  } catch { return String(raw || '').slice(0, 160); }
};

async function get(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, redirect: 'follow', signal: controller.signal });
    const body = (await res.text()).slice(0, MAX);
    return { status: res.status, cf: (res.headers.get('cf-mitigated') || '') || '-', type: (res.headers.get('content-type') || '').split(';')[0], body };
  } catch (err) {
    return { status: 0, cf: '-', type: '-', body: '', error: err.message };
  } finally { clearTimeout(timer); }
}

const json = (res) => { try { return JSON.parse(res.body); } catch { return null; } };
const keysOf = (value) => (value && typeof value === 'object' ? Object.keys(value).join(',') : '-');
const iframesOf = (html) => [...new Set([...String(html).matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
const mediaOf = (text) => [...new Set([...String(text).matchAll(/https?:\\?\/\\?\/[^\s"'\\<>]+?(?:\.m3u8|\.mp4|\/e\/|\/embed\/)[^\s"'\\<>]*/gi)].map((m) => m[0].replace(/\\\//g, '/')))];
const firstOf = (payload) => {
  const list = payload?.data?.items || payload?.data?.results || payload?.items || payload?.results || payload?.data;
  return Array.isArray(list) ? list[0] : null;
};
const itemUrl = (item) => item?.url || item?.permalink || item?.path || (item?.slug ? `/pelicula/${item.slug}` : null);

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });
  const rows = [];
  const save = (name, body) => { try { fs.writeFileSync(`.probe/html/${name}.json`, body); } catch { /* diagnóstico */ } };
  const note = (label, url, res, extra = '') => {
    rows.push({ label, url: redact(url), status: res.status, type: res.type, cf: res.cf, bytes: res.body.length, extra });
  };

  // 1) Búsqueda: dos títulos recientes y uno de catálogo.
  const queries = ['spider-man', 'la odisea', 'breaking bad'];
  let firstMovie = null;
  let firstSerie = null;
  for (const q of queries) {
    const url = `${BASE}/api/rest/v1/search?q=${encodeURIComponent(q)}`;
    const res = await get(url, `${BASE}/`);
    save(`pj-search-${q.replace(/[^a-z0-9]+/gi, '-')}`, res.body);
    const payload = json(res);
    const list = payload?.data?.items || payload?.data?.results || payload?.data || payload?.results || payload?.items;
    const items = Array.isArray(list) ? list : [];
    const movie = items.find((it) => /movie|pelicula/i.test(String(it.kind || it.type || it.media_type || '')));
    const serie = items.find((it) => /serie|tv|show/i.test(String(it.kind || it.type || it.media_type || '')));
    if (!firstMovie && movie) firstMovie = { ...movie, url: itemUrl(movie) };
    if (!firstSerie && serie) firstSerie = { ...serie, url: itemUrl(serie) };
    note(`search «${q}»`, url, res, `${items.length} items · claves ${keysOf(items[0])} · kinds ${[...new Set(items.map((it) => it.kind || it.type || '?'))].join('/')}`);
  }

  // 2) Ficha por API del primer resultado de cada tipo.
  const details = [];
  for (const [label, entry] of [['película', firstMovie], ['serie', firstSerie]]) {
    if (!entry) { rows.push({ label: `ficha ${label}`, url: '-', status: 0, extra: 'sin resultado en la búsqueda' }); continue; }
    const kind = /serie|tv|show/i.test(String(entry.kind || entry.type || '')) ? 'serie' : 'movie';
    const slug = entry.slug || String(entry.url || '').split('/').filter(Boolean).pop();
    for (const kindPath of [...new Set([kind, 'movie', 'serie'])]) {
      const url = `${BASE}/api/rest/v1/content/${kindPath}/${encodeURIComponent(slug)}`;
      const res = await get(url, `${BASE}/`);
      const payload = json(res);
      save(`pj-content-${kindPath}-${slug}`, res.body);
      const data = payload?.data || payload;
      const keys = keysOf(data);
      const looksPlayable = /server|player|embed|source|stream|video|option|reproduc/i.test(JSON.stringify(data).slice(0, 4000));
      note(`content ${kindPath}/${slug}`, url, res, `claves ${keys}${looksPlayable ? ' · menciona reproductores' : ''}`);
      if (res.status === 200) { details.push({ kindPath, slug, data, res }); break; }
    }
  }

  // 3) Temporadas y episodios del primer contenido que traiga `id`.
  const withId = details.find((entry) => entry.data?.id || entry.data?.item_id);
  const itemId = withId ? (withId.data.id || withId.data.item_id) : null;
  if (itemId) {
    for (const endpoint of [`episode-seasons?item_id=${itemId}`, `episodes?item_id=${itemId}&season=1&limit=30&page=1`]) {
      const url = `${BASE}/api/rest/v1/${endpoint}`;
      const res = await get(url, `${BASE}/`);
      save(`pj-${endpoint.split('?')[0].replace(/[^a-z0-9]+/gi, '-')}-${itemId}`, res.body);
      const payload = json(res);
      const list = payload?.data?.items || payload?.data || payload?.items || payload?.results;
      const items = Array.isArray(list) ? list : [];
      note(`api ${endpoint.split('?')[0]}`, url, res, `${items.length} items · claves ${keysOf(items[0])}`);
    }
  }

  // 4) Reproducción: qué responde `/api/play` y qué hay en la ficha HTML.
  if (firstMovie?.url) {
    const watch = await get(`${BASE}${firstMovie.url}`, `${BASE}/`);
    save(`pj-page-pelicula-${String(firstMovie.slug || 'x').replace(/[^a-z0-9-]+/gi, '-')}`, watch.body);
    const frames = iframesOf(watch.body);
    const media = mediaOf(watch.body);
    note('ficha HTML película', `${BASE}${firstMovie.url}`, watch,
      `${frames.length} iframes [${frames.slice(0, 3).join(' ')}] · ${media.length} medios [${media.slice(0, 3).map(redact).join(' ')}]`);
  }
  for (const [label, url] of [
    ['api play (GET)', `${BASE}/api/play`],
    ['api play (POST vacío)', `${BASE}/api/play`],
    ['ruta /e/', `${BASE}/e/`],
  ]) {
    if (label.includes('POST')) continue;
    const res = await get(url, `${BASE}/`);
    save(`pj-${label.replace(/[^a-z0-9]+/gi, '-')}`, res.body);
    note(label, url, res, res.body.slice(0, 120).replace(/\s+/g, ' '));
  }

  const lines = [
    '# Sonda de pelisjuanita.org',
    '',
    '| paso | url | estado | tipo | cf | bytes | notas |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | \`${r.url}\` | ${r.status} | ${r.type} | ${r.cf} | ${r.bytes} | ${r.extra || ''} |`),
    '',
    'Sonda de diagnóstico: solo cabeceras y JSON público; sin tokens ni segmentos.',
  ];
  fs.writeFileSync('.probe/pelisjuanita.md', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
