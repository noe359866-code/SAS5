#!/usr/bin/env node
/**
 * Primera tanda de proveedores de doramas (24-11-2026): acceso desde servidor,
 * buscador, ficha y episodio. Solo HTML; se cuentan señales de vídeo y audio.
 * No se imprimen URLs firmadas.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const QUERY = 'the blue road';

const SITES = [
  { name: 'doramasflix.in', base: 'https://doramasflix.in', search: '/search?query=the%20blue%20road' },
  { name: 'doramasyt.com', base: 'https://www.doramasyt.com', search: '/?s=the+blue+road' },
  { name: 'doramasmp4.io', base: 'https://doramasmp4.io', search: '/?s=the+blue+road' },
  { name: 'pandrama.io', base: 'https://pandrama.io', search: '/?s=the+blue+road' },
  { name: 'pandrama.com', base: 'https://pandrama.com', search: '/?s=the+blue+road' },
  { name: 'doramasflix.co', base: 'https://doramasflix.co', search: '/?s=the+blue+road' },
  { name: 'doramasflix.io', base: 'https://doramasflix.io', search: '/?s=the+blue+road' },
  { name: 'doramastv.to', base: 'https://doramastv.to', search: '/?s=the+blue+road' },
  { name: 'doramasqueen.com', base: 'https://doramasqueen.com', search: '/?s=the+blue+road' },
  { name: 'doramedplay.com', base: 'https://doramedplay.com', search: '/?s=the+blue+road' },
  { name: 'comamosramen.org', base: 'https://comamosramen.org', search: '/?s=the+blue+road' },
  { name: 'doramasvip.org', base: 'https://doramasvip.org', search: '/?s=the+blue+road' },
];

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try {
    const url = new URL(String(raw));
    return `${url.hostname}${url.pathname.slice(0, 80)}${url.search ? `?(${url.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 90); }
};

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: HEADERS });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_200_000) };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function links(body, page) {
  const out = [];
  for (const m of body.matchAll(/(?:href|src|data-src|data-url|data-video|data-href)\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(String(m[1]).replace(/&amp;/g, '&'), page).href; } catch { continue; }
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function signals(body) {
  const text = String(body || '');
  const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)]
    .map((m) => m[0].replace(/[),;]+$/, ''))
    .filter((url) => /m3u8|mp4|\/e\/|\/embed|\.vtt|player|stream|video/i.test(url)))];
  const iframes = [...text.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const dataAttrs = [...text.matchAll(/\bdata-[a-z-]+\s*=\s*["']([^"']*(?:m3u8|mp4|embed|player|video)[^"']*)["']/gi)].map((m) => m[1]);
  const words = {
    latino: /audio\s+latino|\blatino\b|espa[ñn]ol\s+latino/i.test(text),
    castellano: /castellano/i.test(text),
    sub: /sub\s*espa[ñn]ol|subtitulad|\bsub\b/i.test(text),
    hls: /m3u8|EXTM3U/i.test(text),
    mp4: /\.mp4\b/i.test(text),
    ajax: /admin-ajax|doo_player_ajax/i.test(text),
    jsonld: /application\/ld\+json/i.test(text),
    nextData: /__NEXT_DATA__|self\.__next_f/i.test(text),
  };
  return { urls: urls.slice(0, 8), iframes: iframes.slice(0, 6), dataAttrs: dataAttrs.slice(0, 6), words };
}

function describe(res) {
  const found = signals(res.body);
  const flags = Object.entries(found.words).filter(([, value]) => value).map(([key]) => key).join(',') || '—';
  return `${found.urls.length} urls, ${found.iframes.length} iframes, ${found.dataAttrs.length} data-*, señales=${flags}`;
}

async function main() {
  fs.mkdirSync('.probe/html', { recursive: true });
  for (const site of SITES) {
    try {
      const home = await get(site.base);
      row(site.name, 'portada', home.status, home.status === 200 ? 'OK' : (home.error || 'sin-portada'), describe(home));
      if (home.status !== 200) continue;
      const search = await get(`${site.base}${site.search}`);
      const found = signals(search.body);
      row(site.name, 'buscador', search.status, search.body.length > 10_000 ? 'HTML' : (search.error || 'corto'), describe(search));
      const allLinks = links(search.body, search.url).concat(links(home.body, home.url));
      const candidates = [...new Set(allLinks.filter((url) => {
        try { return new URL(url).hostname === new URL(site.base).hostname; } catch { return false; }
      }).filter((url) => /blue-road|the-blue-road|camino-azul|resident-playbook|emperatriz/i.test(url)))].slice(0, 3);
      row(site.name, 'fichas', '—', `${candidates.length}`, candidates.map(redact).join(' ') || '—');
      const episodes = [...new Set(links(search.body, search.url).filter((url) => {
        try { return new URL(url).hostname === new URL(site.base).hostname; } catch { return false; }
      }).filter((url) => /\/episodio|\/episodes?|\/ver\/|\/capitulo|\/capitulos?|\d+x\d+/i.test(url)))].slice(0, 2);
      row(site.name, 'episodios', '—', `${episodes.length}`, episodes.map(redact).join(' ') || '—');
      fs.writeFileSync(`.probe/html/dorama-${site.name}.html`, search.body);
      if (!episodes.length) continue;
      const episode = await get(episodes[0]);
      row(site.name, 'episodio', episode.status, describe(episode), redact(episode.url));
      const ep = signals(episode.body);
      for (const url of [...ep.iframes, ...ep.dataAttrs, ...ep.urls].slice(0, 3)) {
        row(site.name, '· visor', '—', 'señal', redact(url));
      }
      fs.writeFileSync(`.probe/html/dorama-${site.name}-episode.html`, episode.body);
    } catch (err) {
      row(site.name, 'error', '—', 'error', String(err?.message || err).slice(0, 120));
    }
  }
  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', `Consulta usada: «${QUERY}». Solo acceso HTTP y HTML; una señal no prueba reproducción.`, '');
  fs.writeFileSync('.probe/dorama-candidates.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
