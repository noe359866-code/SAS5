#!/usr/bin/env node
/** ¿Cómo busca DoramasYT? El adaptador dio «no-match» en vivo (25-11-2026):
 *  hay que ver el HTML real del buscador y dónde enlaza a las fichas. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');

const BASE = 'https://www.doramasyt.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };

const rows = [];
const row = (...cols) => { rows.push(cols); console.log(`| ${cols.join(' | ')} |`); };

async function get(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    const body = (await res.text()).slice(0, 2 * 1024 * 1024);
    return { status: res.status, body, type: res.headers.get('content-type') || '' };
  } catch (err) { return { status: 0, body: '', error: err?.name || 'error' }; }
}

async function main() {
  fs.mkdirSync('.probe', { recursive: true });
  const q = 'secretary kim';
  // 1) Buscador WordPress clásico
  const search = await get(`${BASE}/?s=${encodeURIComponent(q)}`);
  row('GET /?s=', search.status, `${search.body.length} B`, search.type.slice(0, 40));
  const hrefs = [...new Set([...search.body.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))]
    .filter((h) => h.startsWith(BASE) || h.startsWith('/'))
    .filter((h) => !/\.(css|js|png|jpe?g|webp|svg|ico|woff)/i.test(h));
  row('enlaces en resultados', '—', `${hrefs.length}`, hrefs.slice(0, 25).map((h) => h.replace(BASE, '')).join(' · ').slice(0, 900));
  // 2) API REST de WordPress
  const wp = await get(`${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(q)}&per_page=10`);
  row('GET /wp-json/wp/v2/search', wp.status, `${wp.body.length} B`, wp.body.slice(0, 400).replace(/\|/g, '¦'));
  // 3) Una ficha conocida (del episodio medido): ¿existe /doramas/<slug>/?
  for (const path of ['/doramas/whats-wrong-with-secretary-kim-latino/', '/dorama/whats-wrong-with-secretary-kim-latino/', '/whats-wrong-with-secretary-kim-latino/']) {
    const page = await get(`${BASE}${path}`);
    const title = (/<title[^>]*>([^<]+)</i.exec(page.body) || [])[1] || '';
    const verLinks = [...new Set([...page.body.matchAll(/href=["']([^"']*\/ver\/[^"']+)["']/gi)].map((m) => m[1]))];
    row(`GET ${path}`, page.status, `${page.body.length} B · ${verLinks.length} enlaces /ver/`, `"${title.slice(0, 70)}" ${verLinks.slice(0, 3).map((u) => u.replace(BASE, '')).join(' · ')}`);
  }
  const md = ['| Paso | HTTP | Tamaño | Detalle |', '|---|---|---|---|', ...rows.map((r) => `| ${r.join(' | ')} |`),
    '', 'Sonda del buscador de DoramasYT; solo HTML/JSON del sitio.', ''];
  fs.writeFileSync('.probe/doramasyt-search.md', `${md.join('\n')}\n`);
  console.log('\n.probe/doramasyt-search.md');
}

main().catch((err) => { console.error(err); process.exit(1); });
