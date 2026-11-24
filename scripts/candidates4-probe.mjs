#!/usr/bin/env node
/**
 * Sonda de candidatas, cuarta tanda: sitios con API propia que aún no estaban
 * en el registro (hackstore.mx, allcalidad.cc) y dos proveedores del mismo CMS
 * que el addon ya usa (allcalidad.re) que no se habían medido con sus
 * controles reales.
 *
 * A diferencia de las tandas anteriores, aquí se llama al código del addon:
 * `createVimeosJsonProvider` hace la cadena buscar → ficha → episodio →
 * player → embed → Vimeos con el mismo presupuesto y las mismas reglas que en
 * producción. Un `hits > 0` significa que el proveedor es integrable tal cual.
 *
 * Los casos son los controles habituales de `scripts/sites-live.js`.
 * No se descargan segmentos de vídeo ni se imprimen URLs firmadas.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createVimeosJsonProvider } = require('../lib/sites/vimeosJson');
const { providerHttp } = require('../lib/providerHttp');
const { extractorFor } = require('../lib/extractors');
const { resolveVimeosEmbed, allowedVideoUrl } = require('../lib/vimeos');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 12_000;

const CASES = [
  { label: 'película La Odisea', resolved: { mediaType: 'movie', title: 'La Odisea', altTitle: 'The Odyssey', year: '2025' } },
  { label: 'serie The Pitt 1x01', resolved: { mediaType: 'series', title: 'The Pitt', altTitle: null, year: '2025', season: 1, episode: 1 } },
  { label: 'serie Breaking Bad 1x01', resolved: { mediaType: 'series', title: 'Breaking Bad', altTitle: null, year: '2008', season: 1, episode: 1 } },
];

const rows = [];
const row = (site, control, result) => {
  rows.push({ site, control, ...result });
  console.log(`| ${site} | ${control} | ${result.http ?? '—'} | ${result.state} | ${result.detail || '—'} |`);
};

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    return { status: res.status, text: (await res.text()).slice(0, 700 * 1024), type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, text: '', type: '', error: err?.name || String(err).slice(0, 40) };
  } finally {
    clearTimeout(timer);
  }
}

const json = (res) => { try { return JSON.parse(res.text); } catch { return null; } };
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return '?'; } };

/** Cadena del CMS `/wp-api/v1` y de `/api/rest`: se ejecuta con el código real. */
async function probeJsonProvider(site, provider) {
  for (const { label, resolved } of CASES) {
    const out = await provider.search('', resolved, resolved.title, 11_000).catch((err) => ({ hits: [], reason: `error:${String(err?.message || err).slice(0, 40)}` }));
    const hosts = [...new Set((out.hits || []).map((h) => hostOf(h.url)))];
    row(site, label, {
      state: out.hits?.length ? 'OK' : (out.reason || 'sin-resultado'),
      detail: out.hits?.length ? `hits=${out.hits.length} · audio=${[...new Set(out.hits.map((h) => h.audioLabel))].join('/')} · ${hosts.join(',')}`
        : `${out.skipped ? `omitido:${out.skipped}` : ''}${out.notes ? ` · ${JSON.stringify(out.notes)}` : ''}`,
    });
  }
}

/** allcalidad.cc: `/api/rest/v1/search` → `content` → `player_url` → vídeo. */
async function probeAllcalidadCc() {
  const base = 'https://allcalidad.cc';
  const api = `${base}/api/rest/v1`;
  const search = await get(`${api}/search?q=${encodeURIComponent('la odisea')}&page=1`, { Accept: 'application/json', Referer: `${base}/` });
  const results = json(search)?.items || [];
  row('allcalidad.cc', 'API /search', {
    http: search.status,
    state: results.length ? 'OK' : (search.error || 'sin-resultados'),
    detail: results.length ? `items=${results.length} · ${results.slice(0, 3).map((i) => `${i.title || i.name || '?'}:${i.catalog_item_id || i._id || i.id || '?'}`).join(' ')}` : `${search.type} · ${search.text.slice(0, 60).replace(/\s+/g, ' ')}`,
  });
  const item = results[0];
  if (!item) return;
  const content = await get(`${api}/content/${encodeURIComponent(item.type || 'movies')}/${encodeURIComponent(item.slug || '')}`, { Accept: 'application/json', Referer: `${base}/` });
  const playerUrl = json(content)?.item?.player_url || item.player_url || '';
  row('allcalidad.cc', 'API /content', {
    http: content.status,
    state: playerUrl ? 'OK' : 'sin-player',
    detail: playerUrl ? hostOf(playerUrl) : content.text.slice(0, 60).replace(/\s+/g, ' '),
  });
  if (!playerUrl) return;
  const player = await get(playerUrl, { Referer: `${base}/` });
  const frames = [...new Set([...player.text.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  row('allcalidad.cc', 'página del reproductor', {
    http: player.status,
    state: frames.length ? 'OK' : 'sin-iframe',
    detail: frames.length ? frames.slice(0, 2).map(hostOf).join(',') : `${player.type} · ${player.text.slice(0, 60).replace(/\s+/g, ' ')}`,
  });
  const http = providerHttp(20_000, 12);
  for (const frame of frames.slice(0, 2)) {
    const url = new URL(frame, playerUrl).href;
    const kind = extractorFor(url);
    const media = /vimeos\./.test(hostOf(url))
      ? await resolveVimeosEmbed(url, `${base}/`, http).catch(() => null)
      : null;
    const direct = media?.master || (kind && kind !== 'opaque' ? `extraíble(${kind})` : '');
    row('allcalidad.cc', `embed ${hostOf(url)}`, {
      state: direct ? 'OK' : (kind || 'opaco'),
      detail: direct ? `${allowedVideoUrl(media?.master || '') ? 'HLS-Vimeos' : direct}` : 'sin medio directo',
    });
  }
}

/** Cinemitas: Dooplay clásico con buscador GET y visor de Cvid. */
async function probeCinemitas() {
  const base = 'https://cinemitas.org';
  const search = await get(`${base}/?dooplay=search&post_type=movies&s=${encodeURIComponent('la odisea')}`);
  const links = [...new Set([...search.text.matchAll(/href="(https:\/\/cinemitas\.org\/(?:movies|tvshows)\/[a-z0-9-]+\/?)"/gi)].map((m) => m[1]))];
  row('cinemitas.org', 'buscador', {
    http: search.status,
    state: links.length ? 'OK' : 'sin-fichas',
    detail: links.length ? links.slice(0, 3).map((u) => new URL(u).pathname).join(' ') : `${search.type} · ${search.text.slice(0, 60).replace(/\s+/g, ' ')}`,
  });
  if (!links.length) return;
  const ficha = await get(links[0]);
  const posts = [...new Set([...ficha.text.matchAll(/data-post=["'](\d+)["']/gi)].map((m) => m[1]))];
  row('cinemitas.org', 'ficha', {
    http: ficha.status,
    state: posts.length ? 'OK' : 'sin-servidores',
    detail: `data-post=${posts.length} · doo_player=${/doo_player_ajax|admin-ajax/.test(ficha.text)} · cvid=${/cvid/.test(ficha.text)}`,
  });
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });

  const sites = [
    ['hackstore.mx', createVimeosJsonProvider({ key: 'hackstore', name: 'HackStore', base: 'https://hackstore.mx', api: 'https://hackstore.mx/wp-api/v1', dialect: 'wpa', maxRequests: 12 })],
    ['allcalidad.re', createVimeosJsonProvider({ key: 'allcalidad', name: 'AllCalidad', base: 'https://allcalidad.re', api: 'https://allcalidad.re/api/rest', dialect: 'rest', maxRequests: 12 })],
  ];
  for (const [site, provider] of sites) {
    try { await probeJsonProvider(site, provider); }
    catch (err) { row(site, 'error', { state: 'error', detail: String(err?.message || err).slice(0, 100) }); }
  }
  for (const [site, fn] of [['allcalidad.cc', probeAllcalidadCc], ['cinemitas.org', probeCinemitas]]) {
    try { await fn(); }
    catch (err) { row(site, 'error', { state: 'error', detail: String(err?.message || err).slice(0, 100) }); }
  }

  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.control} | ${r.http ?? '—'} | ${r.state} | ${r.detail || '—'} |`);
  md.push('', 'Cuarta tanda: proveedores nuevos medidos con el código del addon. No se descargan segmentos.');
  fs.writeFileSync('.probe/candidates4.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
