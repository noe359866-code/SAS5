'use strict';
const { runProviders } = require('../lib/streams');

const fixtures = [
  { title: 'Matrix', year: '1999', mediaType: 'movie', imdbId: 'tt0133093' },
  { title: 'Breaking Bad', year: '2008', mediaType: 'series', season: 1, episode: 1, imdbId: 'tt0903747' },
];

(async () => {
  let failed = false;
  for (const resolved of fixtures) {
    const keys = ['fanpelis', 'playlatin', 'flixlatam'];
    const report = {};
    const hits = await runProviders(keys, resolved.title, resolved, resolved.title, report, 9000);
    for (const key of keys) {
      const { ok, relevant = 0, skipped } = report[key] || {};
      console.log(`${resolved.title} / ${key}: ${ok ? `${relevant} fuentes directas${skipped ? ' (omitido)' : ''}` : 'error de consulta'}`);
    }
    if (!hits.length) failed = true;
  }
  if (failed) process.exitCode = 1;
})().catch(() => { console.error('Falló la sonda de proveedores'); process.exitCode = 1; });
