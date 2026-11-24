#!/usr/bin/env node
/** DoramasYT: botones data-player → /reproductor?video= → iframe → extractor. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { extractEmbed, extractorFor } = require('../lib/extractors');
const { isDirectMedia } = require('../lib/directMedia');

const BASE = 'https://www.doramasyt.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const TIMEOUT = 15_000;
const EPISODES = [
  '/ver/whats-wrong-with-secretary-kim-latino-episodio-16',
  '/ver/our-sticky-love-episodio-12',
];

const rows = [];
const row = (site, step, http, state, detail) => {
  rows.push({ site, step, http, state, detail });
  console.log(`| ${site} | ${step} | ${http} | ${state} | ${detail} |`);
};
const redact = (raw) => {
  try { const u = new URL(String(raw)); return `${u.hostname}${u.pathname.slice(0, 72)}${u.search ? `?(${u.search.length} B)` : ''}`; } catch { return String(raw || '').slice(0, 90); }
};

async function get(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, signal: controller.signal });
    return { status: res.status, body: (await res.text()).slice(0, 900 * 1024) };
  } catch (err) { return { status: 0, body: '', error: err?.name || String(err).slice(0, 40) }; }
  finally { clearTimeout(timer); }
}

async function main() {
  fs.mkdirSync('.probe', { recursive: true });
  for (const path of EPISODES) {
    const site = path.split('/').pop();
    const ep = await get(`${BASE}${path}`);
    const title = (/<title[^>]*>([^<]+)</i.exec(ep.body) || [])[1]?.trim() || '';
    const year = /\b(19|20)\d{2}\b/.exec(ep.body.replace(/<[^>]+>/g, ' '))?.[0] || '';
    const tokens = [...new Set([...ep.body.matchAll(/data-player=["']([^"']+)["']/gi)].map((m) => m[1]))];
    row(site, 'episodio', ep.status, `jugadores=${tokens.length}`, `título="${title.slice(0, 80)}" año=${year || '—'}`);
    for (const token of tokens.slice(0, 5)) {
      const player = await get(`${BASE}/reproductor?video=${encodeURIComponent(token)}`, `${BASE}${path}`);
      const iframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(player.body)?.[1] || '';
      const embed = iframe.startsWith('//') ? `https:${iframe}` : iframe;
      if (!embed) { row(site, `token ${token.slice(0, 8)}`, player.status, 'sin-iframe', `${player.body.length} B`); continue; }
      const kind = extractorFor(embed);
      row(site, `token ${token.slice(0, 8)}`, player.status, kind || 'sin-extractor', redact(embed));
      if (!kind || kind === 'opaque') continue;
      const extracted = await extractEmbed(embed, { timeoutMs: 12_000, referer: `${BASE}${path}` }).catch((err) => ({ ok: false, sources: [], reason: String(err?.message || err).slice(0, 40) }));
      if (!extracted.ok) { row(site, ' visor', '—', extracted.reason || 'sin-medio', kind); continue; }
      for (const source of extracted.sources.slice(0, 2)) {
        const direct = isDirectMedia(source.url);
        const media = direct ? await get(source.url, embed) : { status: 0, body: '' };
        row(site, ' medio', media.status, `${/^\s*#EXTM3U/.test(media.body) ? 'HLS' : 'otro'} · ${source.kind}`, redact(source.url));
      }
    }
  }
  const md = ['| Episodio | Paso | HTTP | Resultado | Detalle |', '|---|---|---|---|---|'];
  for (const r of rows) md.push(`| ${r.site} | ${r.step} | ${r.http} | ${r.state} | ${r.detail} |`);
  md.push('', 'DoramasYT con los extractores del addon; sin URLs firmadas en claro.', '');
  fs.writeFileSync('.probe/doramasyt.md', `${md.join('\n')}\n`);
  console.log(`\n${md.join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
