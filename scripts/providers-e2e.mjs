#!/usr/bin/env node
/**
 * Prueba de extremo a extremo contra un despliegue.
 *
 * Pide `/<cfg>/stream/:type/:id.json` al addon ya desplegado y cuenta qué
 * devolvió cada proveedor. Sirve para lo que los tests offline no pueden ver:
 * si el Worker (con su CPU y su red) es capaz de hablar con Embed69, SpinFlix
 * y compañía.
 *
 *   node scripts/providers-e2e.mjs --url https://mi-addon.workers.dev
 *   node scripts/providers-e2e.mjs --url … --imdb tt0903747 --series \
 *        --season 1 --episode 1
 *   node scripts/providers-e2e.mjs --url … --json
 *
 * El addon no expone un informe por proveedor en `/stream` (a propósito: no
 * se filtra de dónde sale cada enlace), así que aquí se cuentan los streams
 * por su `name`, que sí es público.
 */
const DEFAULT_MOVIE = 'tt0816692'; // Interstellar
const DEFAULT_SERIES = 'tt0903747'; // Breaking Bad

function parseArgs(argv) {
  const options = {
    url: '',
    imdb: DEFAULT_MOVIE,
    series: false,
    season: 1,
    episode: 1,
    timeout: 30000,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--url') options.url = next();
    else if (arg.startsWith('--url=')) options.url = arg.split('=')[1];
    else if (arg === '--imdb') options.imdb = next();
    else if (arg.startsWith('--imdb=')) options.imdb = arg.split('=')[1];
    else if (arg === '--series') options.series = true;
    else if (arg === '--season') options.season = Number(next());
    else if (arg === '--episode') options.episode = Number(next());
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

/** `/stream/...` devuelve `{ streams: [...] }`; cada uno con `name` y `title`. */
function summarize(streams) {
  const byQuality = new Map();
  const hosts = new Set();
  for (const stream of streams || []) {
    const name = String((stream && stream.name) || 'sin nombre');
    byQuality.set(name, (byQuality.get(name) || 0) + 1);
    try {
      if (stream && stream.url) hosts.add(new URL(stream.url).hostname);
    } catch (_) { /* magnet o URL rara */ }
  }
  return {
    total: (streams || []).length,
    byName: Object.fromEntries([...byQuality.entries()].sort((a, b) => b[1] - a[1])),
    hosts: [...hosts].sort(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.url) {
    console.log('Uso: node scripts/providers-e2e.mjs --url https://mi-addon.workers.dev [--series --season 1 --episode 1] [--imdb tt…] [--json]');
    if (!options.url) process.exitCode = 1;
    return;
  }

  const base = options.url.replace(/\/+$/, '');
  const id = options.series ? `${options.imdb}:${options.season}:${options.episode}` : options.imdb;
  const type = options.series ? 'series' : 'movie';
  const url = `${base}/stream/${type}/${encodeURIComponent(id)}.json`;

  const started = Date.now();
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeout),
  });
  const ms = Date.now() - started;
  const body = await response.json().catch(() => null);
  const streams = (body && body.streams) || [];

  if (options.json) {
    console.log(JSON.stringify({ url, status: response.status, ms, ...summarize(streams) }, null, 2));
    const hasEmbeds = streams.some((s) => s && s.behaviorHints && s.behaviorHints.notWebReady);
    if (!response.ok || !streams.length) process.exitCode = 1;
    return;
  }

  console.log(`\n${url}`);
  console.log(`HTTP ${response.status} · ${ms} ms · ${streams.length} streams\n`);
  if (!streams.length) {
    console.log('Sin resultados. Causas habituales:');
    console.log('  · el título no está en ninguna fuente,');
    console.log('  · la configuración de la URL filtra los proveedores,');
    console.log('  · Embed69 necesita su PoW (EMBED69_POW) y se quedó sin CPU.');
    process.exitCode = 1;
    return;
  }
  const counts = summarize(streams);
  for (const [name, count] of Object.entries(counts.byName)) {
    console.log(`  ${String(count).padStart(3)} × ${name}`);
  }
  if (counts.hosts.length) console.log(`\nHosts de los enlaces directos: ${counts.hosts.join(', ')}`);
  console.log('');
}

main().catch((err) => {
  console.error('Falló:', (err && err.message) || err);
  process.exitCode = 1;
});
