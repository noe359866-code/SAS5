#!/usr/bin/env node
/**
 * Quinta sonda de anime (24-11-2026): ¿los visores Byse que publica OtakusTV
 * son extraíbles con el código del addon? Byse es uno de los pocos hosts que
 * `lib/extractors.js` sabe resolver sin ejecutar JavaScript.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractEmbed, extractorFor } = require('../lib/extractors');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 12_000;

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
  } catch { return String(raw || '').slice(0, 120); }
};

async function get(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { ...HEADERS, ...headers } });
    return { status: res.status, body: (await res.text()).slice(0, 900 * 1024) };
  } catch (err) {
    return { status: 0, body: '', error: err?.name || String(err).slice(0, 40) };
  } finally { clearTimeout(timer); }
}

function candidates(html, page) {
  const text = String(html).replace(/&quot;/g, '"').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const found = new Set();
  // Contextos con el nombre del host y una URL cerca (data-* o JSON embebido).
  for (const marker of text.matchAll(/byse|bysesukior|bysisukior/gi)) {
    const chunk = text.slice(Math.max(0, marker.index - 320), marker.index + 320);
    for (const m of chunk.matchAll(/https?:\/\/[^\s"'<>,)\\]+/gi)) {
      const url = m[0].replace(/\\+$/, '');
      if (!/^https?:\/\//.test(url) || !/\S/.test(url)) continue;
      try { new URL(url); } catch { continue; }
      found.add(url);
    }
  }
  return [...found].filter((url) => !/youtube|facebook|google|otakustv|animeflv/i.test(url));
}

async function probe(site, page) {
  const res = await get(page, { Referer: new URL(page).origin + '/' });
  const urls = candidates(res.body, page);
  row(site, 'episodio', res.status, `candidatos=${urls.length}`, `${res.body.length} B · ${urls.slice(0, 4).map(redact).join(' ')}`);
  for (const url of urls.slice(0, 4)) {
    const kind = extractorFor(url);
    if (!kind || kind === 'opaque') {
      row(site, `visor ${redact(url)}`, '—', kind || 'sin-extractor', 'no se abre');
      continue;
    }
    const out = await extractEmbed(url, { referer: page, timeoutMs: 15_000 }).catch((err) => ({ ok: false, sources: [], reason: String(err?.message || err).slice(0, 40) }));
    row(site, `visor ${redact(url)}`, '—', out.ok ? 'MEDIO-DIRECTO' : (out.reason || 'sin-medio'),
      `${kind} · fuentes=${out.sources.length} · ${out.sources.slice(0, 2).map((s) => `${s.kind} ${new URL(s.url).hostname}`).join(' ')}`);
  }
}

async function main() {
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  await probe('otakustv2.com', 'https://otakustv2.com/ver/one-piece-1180');
  await probe('animeflv.one', 'https://vww.animeflv.one/anime/one-piece-episodio-de-merry-la-historia-de-un-amigo-mas');
  const md = ['| Sitio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'Quinta sonda de anime: extracción con el código del addon, sin segmentos de vídeo.');
  fs.writeFileSync('.probe/anime-players8.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
