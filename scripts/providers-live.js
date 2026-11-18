'use strict';

// Sonda de los adaptadores usados en producción, sin mocks ni claves de TMDB.
const { appendFileSync } = require('node:fs');
const { activeProviders, runProviders } = require('../lib/streams');

const fixtures = {
  peliculas: [
    { title: 'Matrix', altTitle: 'The Matrix', year: '1999', mediaType: 'movie', imdbId: 'tt0133093', tmdbId: 603,
      keys: ['fanpelis', 'flixlatam', 'playlatin', 'spinflix', 'cuevana3', 'cinecalidad', 'tioplus'], control: true },
  ],
  series: [
    { title: 'Breaking Bad', year: '2008', mediaType: 'series', season: 1, episode: 1, imdbId: 'tt0903747', tmdbId: 1396,
      keys: ['fanpelis', 'flixlatam', 'playlatin', 'spinflix', 'cuevana3'], control: true },
    { title: 'Naruto', year: '2002', mediaType: 'series', season: 1, episode: 1, imdbId: 'tt0409591', keys: ['animeonlineninja'] },
  ],
  extra: [
    { title: 'Toy Story 5', year: '2026', mediaType: 'movie', keys: ['fuegocine'] },
    { title: 'Mufasa: El rey león', altTitle: 'Mufasa: The Lion King', year: '2024', mediaType: 'movie',
      imdbId: 'tt13186482', keys: ['fanpelis'] },
    { title: 'El rey león', altTitle: 'The Lion King', year: '1994', mediaType: 'movie', imdbId: 'tt0110357', keys: ['playlatin'] },
  ],
};

function annotate(title, message) {
  if (process.env.GITHUB_ACTIONS) {
    const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::notice title=${escape(title).replace(/,/g, '%2C').replace(/:/g, '%3A')}::${escape(message)}`);
  } else console.log(`${title}: ${message}`);
}

function summarize(entry) {
  if (entry?.paused) return 'en pausa';
  if (entry?.skipped) return `omitido: ${entry.skipped}`;
  if (!entry?.ok) return entry?.reason || 'error de consulta';
  return entry.reason || (entry.relevant ? 'medio aceptado' : 'sin medio compatible');
}

async function main(group) {
  const selected = group ? fixtures[group] : Object.values(fixtures).flat();
  if (!selected) throw new Error('Grupo de sondas inválido');
  const enabled = activeProviders(null);
  const rows = [];
  let failed = false;
  for (const fixture of selected) {
    const label = fixture.mediaType === 'series' ? `${fixture.title} T${fixture.season}E${fixture.episode}` : fixture.title;
    const keys = fixture.keys.filter((key) => enabled.includes(key));
    const report = {};
    const hits = await runProviders(keys, fixture.title, fixture, fixture.title, report, 6000);
    for (const key of fixture.keys) {
      const entry = report[key];
      const state = entry ? summarize(entry) : 'desactivado';
      const status = entry?.status || /\bHTTP (\d{3})\b/.exec(entry?.error || '')?.[1] || '—';
      const kinds = [...new Set(hits.filter((hit) => hit.provider === key).map((hit) => hit.resolution || hit.quality || 'directo'))].join(', ') || '—';
      const raw = entry?.raw ?? 0;
      const relevant = entry?.relevant ?? 0;
      const note = `${state}; HTTP ${status}; aceptados ${relevant}/${raw}; formato/calidad ${kinds}`;
      annotate(`${label} / ${key}`, note);
      rows.push(`| ${label} | ${key} | ${state} | ${status} | ${relevant}/${raw} | ${kinds} |`);
    }
    if (fixture.control && !hits.length) failed = true;
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### Scrapers: ${group || 'todos'}`, '',
    '| Control | Proveedor | Estado | HTTP | Aceptados/extraídos | Formato/calidad |',
    '|---|---|---|---|---|---|', ...rows, '',
    'Que el adaptador acepte una URL no prueba reproducción en Stremio. Sonda desde el runner, no desde producción.', '',
  ].join('\n'));
  if (failed) process.exitCode = 1;
}

if (require.main === module) main(process.argv[2]).catch(() => {
  console.error('Falló la ejecución de la sonda de proveedores');
  process.exitCode = 1;
});

module.exports = { annotate };
