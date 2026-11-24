#!/usr/bin/env node
/**
 * Segunda tanda de doramas (24-11-2026): ficha → episodio → reproductor.
 * Prueba los patrones DooPlay, los visores propios y los datos embebidos.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const QUERY = 'the blue road';

const SITES = [
  { name: 'doramaslat.com', base: 'https://doramaslat.com', search: '/?s=the+blue+road' },
  { name: 'doramedplay.net', base: 'https://doramedplay.net', search: '/?s=the+blue+road' },
  { name: 'kdramasplay.com', base: 'https://kdramasplay.com', search: '/?s=the+blue+road' },
  { name: 'yandispoiler.net', base: 'https://yandispoiler.net', search: '/?s=the+blue+road' },
  { name: 'seriesbl.net', base: 'https://seriesbl.net', search: '/?s=the+blue+road' },
  { name: 'doramasub.com', base: 'https://www.doramasub.com', search: '/search/label/the%20blue%20road' },
  { name: 'tudorama.com', base: 'https://tudorama.com', search: '/?s=the+blue+road' },
  { name: 'pandrama.tv', base: 'https://www.pandrama.tv', search: '/search/the%20blue%20road' },
  { name: 'doramasflix.in', base: 'https://doramasflix.in', search: '/doramas-online/the-blue-road' },
];

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try {
    const u = new URL(String(raw));
    return `${u.hostname}${u.pathname.slice(0, 78)}${u.search ? `?(${u.search.length} B)` : ''}`;
  } catch { return String(raw || '').slice(0, 100); }
};

async function get(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...(options.headers || {}) }, method: options.method || 'GET', body: options.body });
    return { status: res.status, url: res.url, body: (await res.text()).slice(0, 1_200_000) };
  } catch (err) {
    return { status: 0, url, body: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function sameHost(url, base) {
  try { return new URL(url).hostname === new URL(base).hostname; } catch { return false; }
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

function dooOptions(html) {
  const out = [];
  for (const m of html.matchAll(/<li[^>]*dooplay_player_option[^>]*>/gi)) {
    const tag = m[0];
    out.push({
      post: /data-post=["']([^"']+)["']/i.exec(tag)?.[1] || '',
      nume: /data-nume=["']([^"']+)["']/i.exec(tag)?.[1] || '',
      type: /data-type=["']([^"']+)["']/i.exec(tag)?.[1] || 'tv',
    });
  }
  return out;
}

function mediaSignals(html) {
  const urls = [...new Set([...html.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)]
    .map((m) => m[0].replace(/[),;]+$/, ''))
    .filter((url) => /m3u8|\.mp4|embed|\/e\/|player|stream|video/i.test(url)))];
  const iframes = [...html.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const data = [...html.matchAll(/\bdata-(?:src|url|video|iframe|embed)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const words = ['latino', 'castellano', 'sub español', 'subtitulado', 'bootstrapData', '__NEXT_DATA__', 'application/ld+json', 'admin-ajax']
    .filter((word) => new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(html));
  return { urls: urls.slice(0, 6), iframes: iframes.slice(0, 4), data: data.slice(0, 4), words };
}

async function probe(site) {
  const search = await get(`${site.base}${site.search}`);
  row(site.name, 'buscador', search.status, search.body.length > 2000 ? 'HTML' : (search.error || 'corto'), `${search.body.length} B`);
  if (search.status !== 200) return;
  fs.writeFileSync(`.probe/html/dorama2-${site.name}.html`, search.body);

  const detailLinks = links(search.body, search.url).filter((url) => sameHost(url, site.base)
    && /\/(?:tvshows?|series?|doramas?|doramas-online|titulo|serie|anime)\/[a-z0-9-]+/i.test(url)
    && !/tag|genero|genre|actor|reparto|page|video|episod/i.test(url));
  const detailUrl = detailLinks[0] || (site.search.includes('the-blue-road') ? `${site.base}${site.search}` : null);
  row(site.name, 'ficha', detailUrl ? '—' : '—', detailUrl ? 'seleccionada' : 'sin-ficha', detailUrl ? redact(detailUrl) : '—');
  if (!detailUrl) return;

  const detail = detailUrl.startsWith(site.base) ? (detailUrl === `${site.base}${site.search}` ? search : await get(detailUrl)) : await get(detailUrl);
  row(site.name, 'ficha HTTP', detail.status, `${detail.body.length} B`, `título=${(/<title[^>]*>([^<]+)</i.exec(detail.body) || [])[1]?.slice(0, 80) || '—'}`);
  const allLinks = links(detail.body, detail.url);
  const episodes = [...new Set(allLinks.filter((url) => sameHost(url, site.base)
    && /\/(?:episodes?|episodios?|capitulos?|ver)\/[a-z0-9-]*\d+x\d+|\/(?:episodes?|episodios?|capitulos?|ver)\/[a-z0-9-]+/i.test(url)))].slice(0, 3);
  row(site.name, 'episodios', '—', `${episodes.length}`, episodes.map(redact).join(' ') || '—');
  const epUrl = episodes.find((url) => /1x1|-1x1|-episodio-1\b|\/1\/?$/.test(url)) || episodes[0];
  if (!epUrl) return;

  const ep = await get(epUrl);
  const options = dooOptions(ep.body);
  row(site.name, 'episodio', ep.status, `dooplay=${options.length}`, redact(ep.url));
  if (options.length) {
    const opt = options[0];
    const body = new URLSearchParams({ action: 'doo_player_ajax', post: opt.post, nume: opt.nume, type: opt.type }).toString();
    const ajax = await get(`${site.base}/wp-admin/admin-ajax.php`, { method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: ep.url } });
    let embed = '';
    try { embed = JSON.parse(ajax.body)?.embed_url || ''; } catch { /* no JSON */ }
    row(site.name, 'ajax', ajax.status, embed ? 'embed' : (ajax.error || 'sin-embed'), redact(embed || ajax.body.slice(0, 60)));
    if (embed) {
      const embedHtml = await get(embed.startsWith('//') ? `https:${embed}` : embed, { headers: { Referer: ep.url } });
      const media = mediaSignals(embedHtml.body);
      row(site.name, 'visor', embedHtml.status, `${media.urls.length} urls`, `${media.words.join(',') || '—'} · ${media.urls.slice(0, 2).map(redact).join(' ')}`);
    }
  } else {
    const media = mediaSignals(ep.body);
    row(site.name, 'señales', ep.status, `${media.urls.length} urls`, `${media.words.join(',') || '—'} · ${[...media.iframes, ...media.data, ...media.urls].slice(0, 3).map(redact).join(' ')}`);
  }
}

async function main() {
  fs.mkdirSync('.probe/html', { recursive: true });
  for (const site of SITES) {
    try { await probe(site); }
    catch (err) { row(site.name, 'error', '—', 'error', String(err?.message || err).slice(0, 120)); }
  }
  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', `Consulta usada: «${QUERY}». Sin segmentos ni URLs firmadas en claro.`, '');
  fs.writeFileSync('.probe/dorama-players.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
