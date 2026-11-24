#!/usr/bin/env node
/** Estructura de ficha y episodio de OtakusTV para el adaptador (24-11-2026). */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { load } = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://otakustv2.com';
const out = [];

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9' }, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.text() };
}

async function main() {
  for (const path of ['/anime/one-piece', '/ver/one-piece-1180', '/animes?genero=espanol-latino&tipo=serie&orden=desc&pag=1']) {
    const res = await get(path);
    const $ = load(res.body);
    out.push(`=== ${path} HTTP ${res.status} (${res.body.length} B)`);
    out.push(`TITLE ${$('title').first().text().trim()}`);
    for (const selector of ['h1', 'h2', '.ep-ti', '#epdata', '.opt', '.dat', '.info', '.anime-info', '.btn', '.ep-btn', 'article', '.serie']) {
      const node = $(selector).first();
      if (!node.length) continue;
      out.push(`${selector} ${node.toString().replace(/\s+/g, ' ').slice(0, 600)}`);
    }
    const episodes = [...new Set($('a[href^="/ver/"]').map((_, el) => $(el).attr('href')).get())];
    out.push(`EPISODIOS ${episodes.length} ${episodes.slice(0, 3).join(' ')}`);
    const details = [...new Set($('a[href^="/anime/"]').map((_, el) => $(el).attr('href')).get())];
    out.push(`FICHAS ${details.length} ${details.slice(0, 5).join(' ')}`);
    for (const meta of $('meta[property^="og:"], meta[name="description"]').toArray()) {
      out.push(`META ${$(meta).attr('property') || $(meta).attr('name')} ${String($(meta).attr('content') || '').slice(0, 160)}`);
    }
  }
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/otakustv-structure.md', `${out.join('\n')}\n`);
  console.log(out.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
