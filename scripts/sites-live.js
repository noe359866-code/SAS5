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
      rows.push({ control: control.id, title: resolved.title, provider: key, hits: hits.length,
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
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  console.log('\nResumen escrito en .probe/sites-live.md');
}

main().catch((err) => { console.error(err); process.exit(1); });
