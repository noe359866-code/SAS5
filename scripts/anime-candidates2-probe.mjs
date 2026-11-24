#!/usr/bin/env node
/**
 * Segunda tanda de candidatas de anime (24-11-2026): sitios que no estaban en
 * la primera sonda (`.probe/anime-candidates.md`) y dominios nuevos de los que
 * ya se descartaron. Solo HTML/JSON público desde GitHub Actions; no se
 * descargan segmentos de vídeo.
 *
 * Para cada sitio se recorre buscador → ficha → episodio y se cuenta lo que
 * un cliente de servidor recibe de verdad: `<iframe src>`, `data-*` con
 * reproductor, `data-post`/`admin-ajax` (Dooplay), vídeo directo y etiquetas
 * de idioma. Un sitio solo entra en el addon si publica un medio directo sin
 * ejecutar JavaScript ni resolver challenges.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 10_000;
const MAX = 600 * 1024;

const CANDIDATES = [
  { site: 'verani.me', base: 'https://verani.me', search: '/?s=one+piece', detail: /https:\/\/verani\.me\/one-piece\/(?!pelicula|descarga)/, episode: /https:\/\/verani\.me\/one-piece\/capitulo-\d+/ },
  { site: 'animeonline.ninja', base: 'https://ww4.animeonline.ninja', search: '/?s=one+piece', detail: /https:\/\/ww4\.animeonline\.ninja\/online\//, episode: /https:\/\/ww4\.animeonline\.ninja\/episodio\// },
  { site: 'otakustv2.com', base: 'https://otakustv2.com', search: '/?s=one+piece', detail: /https:\/\/otakustv2\.com\/(?:anime|series|ver|onepiece)/i },
  { site: 'animeflv.one', base: 'https://vww.animeflv.one', search: '/?s=one+piece', detail: /animeflv\.one\/(?:anime|ver|2026)/i },
  { site: 'henaojara.net', base: 'https://ww1.henaojara.net', search: '/animes?genero=latino&tipo=anime&orden=desc&pag=1', detail: /henaojara\.net\/anime\//i },
  { site: 'anime-jl.net', base: 'https://www.anime-jl.net', search: '/animes?order=created', detail: /anime-jl\.net\/(?:anime|ver)/i },
  { site: 'tioanime.com', base: 'https://tioanime.com', search: '/directorio?genero=&q=one+piece', detail: /tioanime\.com\/ver\//i },
  { site: 'reotaku.vercel.app', base: 'https://reotaku.vercel.app', search: '/#/', detail: /reotaku\.vercel\.app/ },
  { site: 'animefenix.cloud', base: 'https://www.animefenix.cloud', search: '/?s=one+piece', detail: /animefenix\.cloud\/(?:anime|ver|series)/i },
];

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    return { status: res.status, body: (await res.text()).slice(0, MAX), type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, body: '', type: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };
const clean = (raw) => String(raw || '').replace(/&amp;/g, '&');

function links(html, page, pattern) {
  const out = [];
  for (const match of String(html).matchAll(/href=["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(clean(match[1]), page).href; } catch { continue; }
    if (!pattern.test(url) || out.includes(url)) continue;
    out.push(url);
  }
  return out;
}

/** Señales que deja el HTML que recibe un servidor (sin ejecutar JS). */
function inspect(res, page) {
  const body = res.body;
  const frames = [...new Set([...body.matchAll(/<iframe[^<>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => clean(m[1])))];
  const dataPlayers = [...new Set([...body.matchAll(/(?:data-(?:src|video|player|url|file|embed)|["']file["'])\s*[:=]\s*["']([^"']{8,400})["']/gi)].map((m) => clean(m[1])))];
  const media = [...new Set([...body.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi)].map((m) => m[0]))];
  const count = (needle) => (body.match(new RegExp(needle, 'gi')) || []).length;
  return {
    frames,
    dataPlayers,
    media,
    note: `iframe=${frames.length}${frames.length ? ` (${[...new Set(frames.map(hostOf))].slice(0, 4).join(',')})` : ''}`
      + ` data-player=${dataPlayers.length} media=${media.length}`
      + ` data-post=${count('data-post')} admin-ajax=${count('admin-ajax')} doo_player=${count('doo_player')}`
      + ` latino=${count('latino')} sub=${count('subtitulad|sub español')} cast=${count('castellano')}`
      + ` next=${count('__NEXT_DATA__')} challenge=${count('cf-mitigated|just a moment')}`,
  };
}

async function probeSite(cfg) {
  const search = await get(`${cfg.base}${cfg.search}`, { Referer: `${cfg.base}/` });
  const found = links(search.body, `${cfg.base}${cfg.search}`, cfg.detail);
  row(cfg.site, 'buscador', search.status,
    found.length ? 'OK' : (search.error || `${search.type} · sin fichas`),
    `${found.length} enlaces · ${found.slice(0, 2).map((u) => new URL(u).pathname).join(' ')}`);
  if (!found.length) return;

  const detailUrl = found.find((url) => !/descarga|pelicula/i.test(url)) || found[0];
  const detail = await get(detailUrl, { Referer: `${cfg.base}/` });
  const info = inspect(detail, detailUrl);
  row(cfg.site, 'ficha', detail.status, info.frames.length || info.media.length || info.dataPlayers.length ? 'con-visores' : 'sin-visores', `${info.note} · ${new URL(detailUrl).pathname}`);

  // Un episodio real cuando la ficha lo enlaza (los dos sitios Dooplay y
  // VerAnime publican el enlace en el propio HTML de la ficha).
  const episodeLinks = links(detail.body, detailUrl, cfg.episode);
  const episodeUrl = episodeLinks[0];
  if (episodeUrl) {
    const episode = await get(episodeUrl, { Referer: detailUrl });
    const epInfo = inspect(episode, episodeUrl);
    row(cfg.site, 'episodio', episode.status,
      epInfo.frames.length || epInfo.media.length || epInfo.dataPlayers.length ? 'con-visores' : 'sin-visores',
      `${epInfo.note} · ${new URL(episodeUrl).pathname}`);
    const candidates = [...epInfo.media, ...epInfo.frames, ...epInfo.dataPlayers]
      .map((url) => (/^https?:/.test(url) ? url : new URL(url, episodeUrl).href))
      .filter((url) => !/youtube|facebook|doubleclick|google/.test(url))
      .slice(0, 3);
    for (const url of candidates) {
      const kind = extractorFor(url);
      row(cfg.site, `visor ${hostOf(url)}`, '—', kind || 'desconocido', `${kind === 'opaque' ? 'opaco' : kind || 'sin extractor'} · ${url.slice(0, 90)}`);
    }
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  for (const cfg of CANDIDATES) {
    try { await probeSite(cfg); }
    catch (err) { row(cfg.site, 'error', '—', 'error', String(err?.message || err).slice(0, 120)); }
  }
  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'Segunda tanda de candidatas de anime: solo HTML/JSON público, sin segmentos de vídeo.');
  fs.writeFileSync('.probe/anime-candidates2.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
