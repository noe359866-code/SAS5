#!/usr/bin/env node
/** Validación en vivo de los adaptadores de doramas con el código del addon. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { searchSeriesBl } = require('../lib/sites/seriesbl');
const { searchDoramasYt } = require('../lib/sites/doramasyt');

const CONTROLS = [
  { provider: 'seriesbl', search: searchSeriesBl, resolved: { title: 'ABO Desire', altTitle: null, year: '2025', mediaType: 'series', season: 1, episode: 1 } },
  { provider: 'doramasyt', search: searchDoramasYt, resolved: { title: "What's Wrong with Secretary Kim", altTitle: null, year: '2018', mediaType: 'series', season: 1, episode: 16 } },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const rows = [];
const row = (site, state, detail) => {
  rows.push(`| ${site} | ${state} | ${detail} |`);
  console.log(rows[rows.length - 1]);
};
const redact = (raw) => {
  try { const u = new URL(raw); return `${u.hostname}${u.pathname.slice(0, 80)}`; } catch { return '—'; }
};

async function main() {
  for (const cfg of CONTROLS) {
    const out = await cfg.search('control', cfg.resolved, cfg.resolved.title, 25_000);
    if (!out.hits?.length) { row(cfg.provider, out.skipped || out.reason || 'sin-streams', '0 streams'); continue; }
    for (const hit of out.hits.slice(0, 2)) {
      let manifest = 'sin-sondeo';
      try {
        const res = await fetch(hit.url, { headers: { Accept: 'application/vnd.apple.mpegurl', 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
        const body = (await res.text()).slice(0, 1024);
        manifest = `HTTP ${res.status} ${/^\s*#EXTM3U/.test(body) ? 'HLS válido' : 'sin #EXTM3U'}`;
      } catch (err) { manifest = `sin respuesta (${err?.name || 'error'})`; }
      row(cfg.provider, manifest, `audio=${hit.audioLabel} · ${hit.quality} · origen=${hit.playbackOrigin} · ${redact(hit.url)}`);
    }
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/dorama-adapters-live.md', ['| Proveedor | Resultado | Detalle |', '|---|---|---|', ...rows,
    '', 'Búsqueda real de los adaptadores contra el sitio, sin JS ni retos.', ''].join('\n'));
  if (!rows.some((r) => /HLS válido/.test(r))) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
