#!/usr/bin/env node
/**
 * Cuarta sonda de anime (24-11-2026): páginas de episodio de OtakusTV,
 * AnimeFLV.one y HenaOjara. Se buscan señales de reproductor own-player /
 * HLS en el HTML que recibe un servidor, recortando el contexto de cada
 * marcador para entender el patrón sin ejecutar JavaScript.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractorFor } = require('../lib/extractors');
const { isDirectMedia } = require('../lib/directMedia');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 12_000;

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return '?'; } };
const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 110); }
};

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    return { status: res.status, body: (await res.text()).slice(0, 900 * 1024), type: (res.headers.get('content-type') || '').split(';')[0] };
  } catch (err) {
    return { status: 0, body: '', type: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function links(html, page, pattern) {
  const out = [];
  for (const m of String(html).matchAll(/(?:href|src|data-src|data-url|data-video)\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(String(m[1]).replace(/&amp;/g, '&'), page).href; } catch { continue; }
    if (!pattern.test(url) || out.includes(url)) continue;
    out.push(url);
  }
  return out;
}

function signals(body, page) {
  const markers = /m3u8|mp4|zilla|player|embed|iframe|video|source|poster|\.vtt/gi;
  const hits = [];
  for (const m of body.matchAll(markers)) {
    if (hits.length >= 8) break;
    const from = Math.max(0, m.index - 70);
    const text = body.slice(from, m.index + 110).replace(/\s+/g, ' ');
    if (hits.some((h) => h.includes(text.slice(0, 50)))) continue;
    hits.push(text);
  }
  const urls = [...new Set([...body.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)]
    .map((m) => m[0].replace(/[),;]+$/, ''))
    .filter((url) => /m3u8|mp4|zilla|\/e\/|\/embed|\.vtt|\.mp4/.test(url)))];
  return { hits, urls: urls.slice(0, 8) };
}

function inspect(site, label, res, page) {
  const found = signals(res.body, page);
  const direct = found.urls.filter((url) => isDirectMedia(url));
  row(site, label, res.status, direct.length ? 'MEDIO-DIRECTO' : (res.error || 'sin-medio-directo'),
    `tipo=${res.type} bytes=${res.body.length} · urls=${found.urls.length} directas=${direct.length} · ${found.hits.slice(0, 3).join(' | ').slice(0, 260)}`);
  for (const url of found.urls.slice(0, 4)) {
    row(site, `· ${hostOf(url)}`, '—', extractorFor(url) || isDirectMedia(url) ? 'evaluable' : 'otro', redact(url));
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe/html', { recursive: true });
  fs.mkdirSync('.probe', { recursive: true });

  const cases = [
    {
      site: 'otakustv2.com', base: 'https://otakustv2.com', search: '/?s=one+piece',
      detail: /otakustv2\.com\/anime\/[a-z0-9-]+/i, episode: /otakustv2\.com\/ver\/[a-z0-9-]+/i,
    },
    {
      site: 'animeflv.one', base: 'https://vww.animeflv.one', search: '/?s=one+piece',
      detail: /animeflv\.one\/animes?\/[a-z0-9-]+/i, episode: /animeflv\.one\/(?:anime|ver)\/[^"']*(?:ver|episodio|capitulo)[^"']*/i,
    },
    {
      site: 'henaojara.net', base: 'https://ww1.henaojara.net', search: '/animes?genero=latino&tipo=anime&orden=desc&pag=1',
      detail: /henaojara\.net\/anime\/[a-z0-9-]+/i, episode: /henaojara\.net\/(?:ver|anime)\/[^"']*(?:ver|episodio|\d+x\d+)[^"']*/i,
    },
  ];

  for (const cfg of cases) {
    try {
      const search = await get(`${cfg.base}${cfg.search}`);
      const detailUrl = links(search.body, `${cfg.base}${cfg.search}`, cfg.detail)[0];
      row(cfg.site, 'buscador', search.status, detailUrl ? 'OK' : (search.error || 'sin-ficha'), detailUrl ? redact(detailUrl) : '—');
      if (!detailUrl) continue;
      const detail = await get(detailUrl, { Referer: `${cfg.base}/` });
      fs.writeFileSync(`.probe/html/anime7-${cfg.site}-detail.html`, detail.body);
      const episodeUrl = links(detail.body, detailUrl, cfg.episode)[0];
      row(cfg.site, 'ficha', detail.status, episodeUrl ? 'con-episodio' : 'sin-episodio',
        `${detail.body.length} B · episodio=${episodeUrl ? redact(episodeUrl) : '—'}`);
      if (!episodeUrl) continue;
      const episode = await get(episodeUrl, { Referer: detailUrl });
      fs.writeFileSync(`.probe/html/anime7-${cfg.site}-episode.html`, episode.body);
      inspect(cfg.site, 'episodio', episode, episodeUrl);
    } catch (err) {
      row(cfg.site, 'error', '—', 'error', String(err?.message || err).slice(0, 120));
    }
  }

  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'Cuarta sonda de anime: señales de reproductor en el HTML del servidor, sin segmentos.');
  fs.writeFileSync('.probe/anime-players7.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
