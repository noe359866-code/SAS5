#!/usr/bin/env node
'use strict';

/**
 * Sonda en vivo de los adaptadores nuevos (solo diagnóstico).
 *
 * Ejecuta `lib/sites/*` con peticiones reales desde el runner de GitHub
 * Actions y resume, por título y por fuente, qué devolvió: aceptados, motivo
 * del descarte y peticiones gastadas. No imprime URLs firmadas ni descarga
 * segmentos de vídeo (solo la ficha y el embed).
 *
 * Uso:
 *   node scripts/sites-live.js                       # los cuatro adaptadores
 *   node scripts/sites-live.js tubeonline ultra      # solo esos
 *   node scripts/sites-live.js --json                # escribe .probe/sites-live.json
 */

const fs = require('node:fs');
const streams = require('../lib/streams');
const sites = {
  tubeonline: require('../lib/sites/tubeonline'),
  mirandogratis: require('../lib/sites/mirandogratis'),
  gnulaone: require('../lib/sites/gnulaone'),
  ultra: require('../lib/sites/ultra'),
};

const CONTROLS = [
  { type: 'movie', id: 'tt33033798', fallback: { title: 'Spider-Man: Un nuevo día', year: '2026' } },
  { type: 'movie', id: 'tt1375666', fallback: { title: 'El Origen', year: '2010' } },
  { type: 'series', id: 'tt0903747:1:1', fallback: { title: 'Breaking Bad', year: '2008', season: 1, episode: 1 } },
];

// ── Diagnóstico: qué URLs probó cada adaptador y qué devolvió la última ──
const trace = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const response = await originalFetch(url, options);
  let snippet = '';
  if (String(options.method || 'GET') === 'GET') {
    try { snippet = (await response.clone().text()).replace(/\s+/g, ' ').slice(0, 400); } catch (_) { /* cuerpo no legible */ }
  }
  trace.push({ url: String(url).slice(0, 140), status: response.status, location: response.headers.get('location') || '',
    title: /<title[^>]*>([^<]{0,60})/i.exec(snippet)?.[1] || '', h1: /<h1[^>]*>([\s\S]{0,80}?)<\/h1>/i.exec(snippet)?.[1]?.replace(/<[^>]+>/g, '').trim() || '',
    forms: /player-option-[a-z0-9-]+/gi.exec(snippet)?.[0] || '', kind: /content-type"?:?\s*"?([\w/+.-]+)/i.exec(String(JSON.stringify([...response.headers])))?.[1] || '' });
  return response;
};

const redact = (raw) => {
  try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return '—'; }
};

const SEARCHERS = {
  tubeonline: (resolved) => sites.tubeonline.searchTubeOnline(null, resolved, resolved.title, 9000),
  mirandogratis: (resolved) => sites.mirandogratis.searchMirandoGratis(null, resolved, resolved.title, 9000),
  gnulaone: (resolved) => sites.gnulaone.searchGnulaOne(null, resolved, resolved.title, 9000),
  ultra: (resolved) => sites.ultra.searchUltra(null, resolved, resolved.title, 9000),
};

async function resolveControl(control) {
  const resolved = await Promise.race([
    streams.resolveTitle(control.type, control.id),
    new Promise((resolve) => setTimeout(() => resolve(null), 9000)),
  ]).catch(() => null);
  const season = control.type === 'series' ? Number(control.id.split(':')[1]) : null;
  const episode = control.type === 'series' ? Number(control.id.split(':')[2]) : null;
  return resolved || { ...control.fallback, mediaType: control.type, altTitle: null, season, episode };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const keys = args.length ? args.filter((key) => SEARCHERS[key]) : Object.keys(SEARCHERS);
  const rows = [];
  for (const control of CONTROLS) {
    const resolved = await resolveControl(control);
    console.log(`\n### ${control.id}: ${resolved.title} (${resolved.year || '—'}) ${resolved.mediaType}`);
    for (const key of keys) {
      const started = Date.now();
      let result;
      try {
        result = await Promise.race([
          SEARCHERS[key](resolved),
          new Promise((resolve) => setTimeout(() => resolve({ hits: [], reason: 'probe-timeout' }), 14000)),
        ]);
      } catch (err) {
        result = { hits: [], reason: `error:${String(err && err.message || err).slice(0, 60)}` };
      }
      const hits = result.hits || [];
      const verdict = hits.length
        ? hits.map((hit) => `${hit.quality}${hit.audioLabel ? `/${hit.audioLabel}` : ''} ${redact(hit.url)}`).join(' · ')
        : `${result.reason || result.skipped || 'sin motivo'}${result.notes ? ` ${JSON.stringify(result.notes)}` : ''}`;
      console.log(`- ${key}: ${hits.length} hit(s) en ${Date.now() - started} ms → ${verdict}`);
      // Últimas peticiones de esta fuente, para explicar el descarte.
      const recent = trace.slice(-6).map((entry) => `${entry.status} ${entry.url}${entry.location ? ` → ${entry.location.slice(0, 80)}` : ''}${entry.h1 ? ` h1="${entry.h1.slice(0, 40)}"` : ''}`);
      console.log(`    traza: ${recent.join(' | ')}`);
      rows.push({ control: control.id, title: resolved.title, provider: key, hits: hits.length, trace: recent,
        ms: Date.now() - started, quality: hits.map((hit) => hit.quality),
        audio: hits.map((hit) => hit.audioLabel || '—'), hosts: hits.map((hit) => redact(hit.url)), verdict });
    }
  }
  fs.mkdirSync('.probe', { recursive: true });
  fs.writeFileSync('.probe/sites-live.json', JSON.stringify(rows, null, 2));
  const md = ['| Control | Fuente | Hits | ms | Formato | Audio | Destino |', '|---|---|---:|---:|---|---|---|'];
  for (const row of rows) {
    md.push(`| ${row.title} | ${row.provider} | ${row.hits} | ${row.ms} | ${row.quality.join(',') || '—'} | ${row.audio.join(',') || '—'} | ${String(row.verdict).replace(/\|/g, '/').slice(0, 160)} |`);
  }
  md.push('', 'Sonda de adaptadores: solo ficha y embed; no descarga segmentos de vídeo ni imprime URLs firmadas.');
  fs.writeFileSync('.probe/sites-live.md', md.join('\n') + '\n');
  fs.writeFileSync('.probe/sites-live-trace.txt', trace.map((entry) => `${entry.status}\t${entry.url}\t${entry.location.slice(0, 100)}\t${entry.title}\t${entry.h1}`).join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  console.log('\nResumen escrito en .probe/sites-live.md');
}

main().catch((err) => { console.error(err); process.exit(1); });
