#!/usr/bin/env node
/**
 * Sonda de proveedores en español.
 *
 * Comprueba, contra los servicios reales, que las TRES fuentes hispanas
 * responden y que sus URLs siguen siendo las que construye el código. Cuando
 * «no dan» streams, esto dice en un segundo si es la fuente (caída, dominio
 * cambiado) o el addon (parser, filtro, URL mal formada).
 *
 *   node scripts/providers-check.mjs                 # Interstellar + Breaking Bad
 *   node scripts/providers-check.mjs --imdb tt0816692
 *   node scripts/providers-check.mjs --query interestelar --lang es
 *   node scripts/providers-check.mjs --json
 *
 * No necesita clave de TMDB: si la hay, se usa el título en español; si no,
 * el que pases con --query.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../lib/config.js');
const streams = require('../lib/streams.js');
const spinflix = require('../lib/spinflix.js');

const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS) || 12_000;

function parseArgs(argv) {
  const options = { imdb: 'tt0816692', series: null, query: null, lang: 'es', json: false };
  for (const arg of argv) {
    if (arg.startsWith('--imdb=')) options.imdb = arg.split('=')[1];
    else if (arg.startsWith('--series=')) options.series = arg.split('=')[1];
    else if (arg.startsWith('--query=')) options.query = arg.split('=')[1];
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

async function timed(label, run) {
  const started = Date.now();
  try {
    const value = await run();
    return { label, ok: true, value, ms: Date.now() - started };
  } catch (err) {
    return { label, ok: false, error: (err && err.message) || String(err), ms: Date.now() - started };
  }
}

/** Resumen de una respuesta de buscador del addon. */
function summarize(result) {
  const found = Array.isArray(result) ? { hits: result } : result || {};
  const hits = found.hits || [];
  const detail = {
    hits: hits.length,
    skipped: found.skipped || null,
    query: found.query || null,
    samples: hits.slice(0, 2).map((hit) => ({
      title: String(hit.title || '').slice(0, 90),
      seeders: hit.seeders,
      url: hit.url ? String(hit.url).slice(0, 70) : undefined,
    })),
  };
  if (found.error) detail.error = found.error;
  return detail;
}

async function checkTorrentioSpanish() {
  const base = String(config.torrentioEsUrl || 'https://torrentio.strem.fun').replace(/\/+$/, '');
  const manifest = await (await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(TIMEOUT_MS) })).json();
  const description = String(manifest.description || '');
  const missing = ['MejorTorrent', 'Wolfmax4k', 'Cinecalidad']
    .filter((name) => !new RegExp(name, 'i').test(description));
  return {
    host: base,
    alive: true,
    providersInManifest: missing.length ? `faltan: ${missing.join(', ')}` : 'los 3 presentes',
  };
}

async function checkSpinFlix(options) {
  const base = String(config.spinflixUrl || '').replace(/\/+$/, '');
  const title = options.query || 'interestelar';
  const probe = async (q) => {
    const url = `${base}/search?q=${encodeURIComponent(q)}&page=1`;
    const data = await (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).json();
    const items = (data && (data.results || data.items)) || [];
    return { query: q, results: items.length, first: items[0] && items[0].slug };
  };
  // El buscador es solo en español: buscar en inglés y no encontrar nada es lo
  // normal, no un fallo. Se prueba en los dos idiomas para dejarlo claro.
  const spanish = await probe(title);
  const english = await probe(options.imdb === 'tt0816692' ? 'interstellar' : title.replace(/[áéíóúñ]/g, ''));
  return {
    host: base,
    alive: true,
    buscador: 'solo en español',
    prueba: [spanish, english],
    proxy: String(config.spinflixProxyUrl || '').includes('spinoff.link')
      ? 'spinoff.link/pelis/proxy.php (el que funciona)'
      : config.spinflixProxyUrl,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Sonda de proveedores en español.\n\n' +
      '  --imdb=tt0816692   título de prueba (película)\n' +
      '  --series=tt0903747 serie de prueba (Breaking Bad)\n' +
      '  --query=…          título en español para SpinFlix\n' +
      '  --json             salida legible por máquina');
    return;
  }

  const type = options.series ? 'series' : 'movie';
  const id = options.series ? `${options.series}:1:1` : options.imdb;
  const resolved = await streams.resolveTitle(type, id);
  if (!resolved) {
    console.error('No se pudo resolver el título. Revisa el id.');
    process.exitCode = 1;
    return;
  }

  const results = [];
  results.push(await timed('torrentioes (manifest)', checkTorrentioSpanish));
  results.push(await timed('spinflix (buscador)', () => checkSpinFlix(options)));
  // Los tres buscadores que alimentan «Español (ES/ES)» y el propio agregado.
  // El agregado «Español (ES/LAT)»: busca con el título en español de TMDB en
  // Knaben, Torlock y BlackHoleBay y se queda solo lo que declara audio español.
  results.push(await timed('espanol (agregado)', async () => summarize(
    await streams.SEARCHERS.espanol(resolved.title, resolved, null, TIMEOUT_MS))));

  if (options.json) {
    console.log(JSON.stringify({ resolved, results }, null, 2));
    return;
  }

  console.log(`\nTítulo de prueba: ${resolved.title} (${resolved.year || 's/f'})` +
    `${resolved.tmdbId ? ` · TMDB ${resolved.tmdbId}` : ' · sin TMDB'}` +
    `${resolved.imdbId ? ` · IMDb ${resolved.imdbId}` : ''}\n`);
  for (const item of results) {
    const head = `${item.ok ? '✔' : '✘'} ${item.label} (${item.ms} ms)`;
    console.log(head);
    if (!item.ok) {
      console.log(`    ${item.error}`);
      continue;
    }
    const value = item.value;
    if (value && value.hits !== undefined) {
      console.log(`    ${value.hits} resultados` +
        (value.skipped ? ` · ${value.skipped}` : '') +
        (value.query ? ` · consulta ${value.query}` : ''));
      for (const sample of value.samples || []) {
        console.log(`      · [${sample.seeders ?? '?'}] ${sample.title}`);
      }
    } else {
      console.log('    ' + JSON.stringify(value));
    }
  }
  console.log('\nRecordatorio: ningún proveedor hispano usa el título en inglés. ' +
    'Si TMDB no está configurado, no habrá título en español salvo que lo pases con --query.\n');
}

main().catch((err) => {
  console.error('La sonda falló:', err);
  process.exitCode = 1;
});
