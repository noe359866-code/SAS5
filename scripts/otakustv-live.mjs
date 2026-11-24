#!/usr/bin/env node
/**
 * Validación en vivo del adaptador de OtakusTV con el código del addon
 * (24-11-2026). No ejecuta JS del sitio: solo HTTP, HTML y el extractor Byse.
 * No imprime URLs completas ni segmentos.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { searchOtakusTv } = require('../lib/sites/otakustv');

const RESOLVED = { title: 'One Piece', altTitle: null, year: '1999', mediaType: 'series', season: 1, episode: 1180 };
const rows = [];
const row = (label, state, detail) => {
  rows.push(`| ${label} | ${state} | ${detail} |`);
  console.log(rows[rows.length - 1]);
};
const redact = (raw) => {
  try { const url = new URL(raw); return `${url.hostname}${url.pathname.slice(0, 90)}`; } catch { return '—'; }
};

async function main() {
  const out = await searchOtakusTv('one piece', RESOLVED, RESOLVED.title, 25_000);
  if (out.skipped || out.reason) {
    row('búsqueda', out.skipped || out.reason, `${out.hits?.length || 0} streams`);
  }
  for (const hit of out.hits || []) {
    let manifest = 'sin sondeo';
    try {
      const res = await fetch(hit.url, { headers: { Accept: 'application/vnd.apple.mpegurl' }, signal: AbortSignal.timeout(15_000) });
      const head = (await res.text()).slice(0, 1024);
      manifest = `HTTP ${res.status} ${/^\s*#EXTM3U/.test(head) ? 'HLS válido' : 'sin #EXTM3U'}`;
    } catch (err) { manifest = `sin respuesta (${err?.name || 'error'})`; }
    row(hit.provider, manifest, `audio=${hit.audioLabel} · calidad=${hit.quality} · origen=${hit.playbackOrigin} · ${redact(hit.url)}`);
  }
  const fs = await import('node:fs');
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/otakustv-live.md', ['| Paso | Resultado | Detalle |', '|---|---|---|', ...rows,
    '', 'Cadena real del adaptador: ficha → episodio → `data-dwn` → Byse → manifiesto HLS.', ''].join('\n'));
  if (!(out.hits || []).length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
