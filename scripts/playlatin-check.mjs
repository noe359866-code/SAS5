#!/usr/bin/env node
// Sonda de PlayLatinSRC usando el mismo adaptador que /stream. No emite
// tokens, páginas de reproducción ni los enlaces completos del resolver.
import streams from '../lib/streams.js';

function parseArgs(argv) {
  const options = { imdb: 'tt0110357', series: null, season: 1, episode: 1, json: false };
  const valued = { '--imdb': 'imdb', '--series': 'series', '--season': 'season', '--episode': 'episode' };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split('=', 2);
    if (key === '--json') options.json = true;
    else if (key === '--help' || key === '-h') options.help = true;
    else if (Object.hasOwn(valued, key)) options[valued[key]] = inline ?? argv[++i];
    // --stream era opcional; ahora siempre se ejecuta el adaptador real.
  }
  return options;
}

async function probe(resolved) {
  const report = {};
  const start = Date.now();
  const hits = await streams.runProviders(['playlatin'], resolved.title, resolved, resolved.title, report, 9000);
  const entry = report.playlatin;
  return { imdb: resolved.imdbId, season: resolved.season, episode: resolved.episode,
    ok: hits.length > 0, reason: entry.reason || entry.skipped || (hits.length ? 'media-accepted' : 'no-compatible-media'),
    status: entry.status, streams: hits.length, ms: Date.now() - start, audio: [...new Set(hits.map((hit) => hit.audioLabel))] };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('PlayLatinSRC: node scripts/playlatin-check.mjs [--imdb=tt0110357] [--series=tt0108778 --season=1 --episode=1] [--json]');
} else {
  const fixtures = [{ mediaType: 'movie', imdbId: options.imdb, title: options.imdb }];
  if (options.series) fixtures.push({ mediaType: 'series', imdbId: options.series, title: options.series, season: Number(options.season), episode: Number(options.episode) });
  const results = await Promise.all(fixtures.map(probe));
  if (options.json) console.log(JSON.stringify(results, null, 2));
  else for (const row of results) console.log(`${row.imdb}: ${row.reason}; ${row.streams} URLs compatibles${row.status ? `; HTTP ${row.status}` : ''} (${row.ms} ms)`);
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}
