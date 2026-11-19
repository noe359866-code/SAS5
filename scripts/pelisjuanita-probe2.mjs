#!/usr/bin/env node
/**
 * Sonda 2 de pelisjuanita.org: episodios y reproductor (solo diagnóstico).
 *
 * La sonda 1 dejó claro que:
 *   - la búsqueda es `GET /api/rest/v1/search?q=…` → `{items:[{kind, slug,
 *     title, year, tmdb_id, catalog_item_id, url}], pagination, q}`;
 *   - la ficha es `GET /api/rest/v1/content/<movie|serie>/<slug>` y NO trae
 *     servidores: solo metadatos, `episode_loader` y `features`;
 *   - la página HTML del título apunta al player externo
 *     `https://videoapp.mov/e/movie/<tmdb_id>`.
 *
 * Esta sonda comprueba el resto de la cadena:
 *   1. `episode-seasons` y `episodes` de una serie con catálogo amplio.
 *   2. Qué publica `videoapp.mov/e/…` (iframe, medios, idiomas…).
 *   3. Si la página del episodio repite la misma construcción.
 *
 * Guarda cada respuesta en `.probe/html/` y escribe `.probe/pelisjuanita2.md`.
 * No descarga vídeo ni imprime URLs firmadas completas.
 */

const BASE = 'https://pelisjuanita.org';
const PLAYER = 'https://videoapp.mov';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const MAX = 1024 * 1024;

const redact = (raw) => {
  try {
    const u = new URL(raw, BASE);
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
    return { status: res.status, cf: (res.headers.get('cf-mitigated') || '') || '-', type: (res.headers.get('content-type') || '').split(';')[0], body, final: res.url };
  } catch (err) {
    return { status: 0, cf: '-', type: '-', body: '', error: err.message };
  } finally { clearTimeout(timer); }
}

const iframesOf = (html) => [...new Set([...String(html).matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
const mediaOf = (text) => [...new Set([...String(text).matchAll(/https?:\\?\/\\?\/[^\s"'\\<>]+?(?:\.m3u8|\.mp4|\/e\/|\/embed\/|\/hls\/)[^\s"'\\<>]*/gi)].map((m) => m[0].replace(/\\\//g, '/')))];
const keysOf = (value) => (value && typeof value === 'object' ? Object.keys(value).join(',') : '-');
const jsonOf = (res) => { try { return JSON.parse(res.body); } catch { return null; } };

const SERIE = { slug: 'breaking-bad-2008', itemId: 25228, tmdbId: 1396 };
const MOVIE = { slug: 'spider-man-un-nuevo-dia-2026', tmdbId: 969681 };

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });
  const rows = [];
  const save = (name, body) => { try { fs.writeFileSync(`.probe/html/${name}`, body); } catch { /* diagnóstico */ } };
  const note = (label, url, res, extra = '') => rows.push({ label, url: redact(url || res.final), status: res.status, type: res.type, cf: res.cf, bytes: res.body.length, extra });

  // 1) Temporadas y episodios.
  for (const [label, endpoint] of [
    ['episode-seasons', `episode-seasons?item_id=${SERIE.itemId}`],
    ['episodes s1', `episodes?item_id=${SERIE.itemId}&season=1&limit=30&page=1`],
  ]) {
    const url = `${BASE}/api/rest/v1/${endpoint}`;
    const res = await get(url, `${BASE}/`);
    save(`pj2-${label.replace(/[^a-z0-9]+/gi, '-')}.json`, res.body);
    const payload = jsonOf(res);
    const list = payload?.items || payload?.data?.items || payload?.data || payload?.seasons || payload?.results;
    const arr = Array.isArray(list) ? list : [];
    note(`api ${label}`, url, res, `${arr.length} items · claves ${keysOf(arr[0])} · ejemplo ${JSON.stringify(arr[0] || {}).slice(0, 220)}`);
  }

  // 2) Ficha de la serie por API y su página HTML.
  const serieApi = await get(`${BASE}/api/rest/v1/content/serie/${SERIE.slug}`, `${BASE}/`);
  save('pj2-content-serie.json', serieApi.body);
  note('api content serie', `${BASE}/api/rest/v1/content/serie/${SERIE.slug}`, serieApi,
    `claves ${keysOf((jsonOf(serieApi) || {}).data || jsonOf(serieApi))}`);

  for (const [label, path] of [['serie', `/serie/${SERIE.slug}`], ['episodio', `/serie/${SERIE.slug}/temporada-1/episodio-1`]]) {
    const res = await get(`${BASE}${path}`, `${BASE}/`);
    save(`pj2-page-${label}.html`, res.body);
    const frames = iframesOf(res.body);
    const media = mediaOf(res.body);
    note(`página ${label}`, `${BASE}${path}`, res,
      `${frames.length} iframes [${frames.slice(0, 3).join(' ')}] · ${media.length} medios [${media.slice(0, 4).map((m) => redact(m)).join(' ')}]`);
  }

  // 3) El reproductor externo: película y episodio.
  for (const [label, path] of [
    ['player movie', `/e/movie/${MOVIE.tmdbId}`],
    ['player tv', `/e/tv/${SERIE.tmdbId}/1/1`],
  ]) {
    const res = await get(`${PLAYER}${path}`, `${BASE}/`);
    save(`pj2-player-${label.replace(/[^a-z0-9]+/gi, '-')}.html`, res.body);
    const frames = iframesOf(res.body);
    const media = mediaOf(res.body);
    const langs = [...new Set([...String(res.body).matchAll(/(?:latino|castellano|espa[ñn]ol|subtitulado|sub|spa|lat)\b/gi)].map((m) => m[0].toLowerCase()))];
    note(label, `${PLAYER}${path}`, res,
      `${frames.length} iframes [${frames.slice(0, 3).join(' ')}] · ${media.length} medios [${media.slice(0, 4).map((m) => redact(m)).join(' ')}] · idiomas: ${langs.join('/') || '—'}`);
  }

  // 4) Ficha del episodio por API (el id del episodio puede traer el medio).
  const episodes = jsonOf(await get(`${BASE}/api/rest/v1/episodes?item_id=${SERIE.itemId}&season=1&limit=5&page=1`, `${BASE}/`)) || {};
  const list = episodes.items || episodes.data?.items || episodes.data || [];
  const firstEpisode = Array.isArray(list) ? list[0] : null;
  if (firstEpisode?.id) {
    const res = await get(`${BASE}/api/rest/v1/item?id=${firstEpisode.id}`, `${BASE}/`);
    save('pj2-item-episodio.json', res.body);
    note('api item episodio', `${BASE}/api/rest/v1/item?id=…`, res, `claves ${keysOf((jsonOf(res) || {}).data || jsonOf(res))}`);
  }

  const lines = [
    '# Sonda 2 de pelisjuanita.org (episodios y player)',
    '',
    '| paso | url | estado | tipo | cf | bytes | notas |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | \`${r.url}\` | ${r.status} | ${r.type} | ${r.cf} | ${r.bytes} | ${r.extra || ''} |`),
    '',
    'Sonda de diagnóstico: solo cabeceras y HTML/JSON público; sin tokens ni segmentos.',
  ];
  fs.writeFileSync('.probe/pelisjuanita2.md', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
