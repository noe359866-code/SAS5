#!/usr/bin/env node
/**
 * Sonda REAL de VideoAPI, sin dobles ni datos de ejemplo.
 *
 *   node scripts/videoapi-check.mjs                    # Interstellar + Breaking Bad
 *   node scripts/videoapi-check.mjs --movie 157336 --series 1396
 *   node scripts/videoapi-check.mjs --imdb tt0816692   # además, la traducción IMDb→TMDB
 *   node scripts/videoapi-check.mjs --json
 *
 * La sonda habla con VideoAPI **por TMDB id**, que es la única llave que
 * entiende, así que NO necesita TMDB_API_KEY. Si la clave está configurada
 * (o se pasa --imdb), se comprueba además el camino real de producción:
 * IMDb → TMDB → VideoAPI, que es el que usa el addon en Stremio.
 *
 * Comprueba el contrato completo, que es lo que puede romperse solo:
 *
 *   1. `exists` responde y su `path` cumple el formato que acepta el addon.
 *   2. La página del reproductor trae al menos un iframe de lamovie.link /
 *      vimeos.net (sin él no hay nada que reproducir, por muchos «existe» que
 *      diga el catálogo).
 *
 * Sale con código 1 si algo falla, para poder usarlo como paso estricto en
 * GitHub Actions: una caída de la fuente se ve en el color, no en un log.
 * No imprime claves ni URLs completas más allá del host del reproductor.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../lib/config.js');
const streams = require('../lib/streams.js');
const videoapi = require('../lib/videoapi.js');

const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS) || 15_000;

function parseArgs(argv) {
  // Ids de TMDB conocidos: Interstellar y Breaking Bad.
  const options = { movie: 157336, series: 1396, season: 1, episode: 1, imdb: '', json: false };
  for (const arg of argv) {
    if (arg.startsWith('--movie=')) options.movie = Number(arg.split('=')[1]);
    else if (arg.startsWith('--series=')) options.series = Number(arg.split('=')[1]);
    else if (arg.startsWith('--season=')) options.season = Number(arg.split('=')[1]);
    else if (arg.startsWith('--episode=')) options.episode = Number(arg.split('=')[1]);
    else if (arg.startsWith('--imdb=')) options.imdb = arg.split('=')[1];
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

const base = () => String(config.videoapiUrl || 'https://videoapi.la').replace(/\/+$/, '');

async function get(url, referer) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/sonda)', Referer: referer },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

/**
 * Una obra de punta a punta, a partir de los datos mínimos que necesita el
 * proveedor (`tmdbId`, tipo y episodio). No pasa por `resolveTitle`: así la
 * sonda mide VideoAPI y no la configuración de TMDB del entorno.
 */
async function probe(resolved, label) {
  const out = { title: label, mediaType: resolved.mediaType, tmdbId: resolved.tmdbId, ok: false };
  if (!Number.isInteger(out.tmdbId) || out.tmdbId <= 0) {
    return { ...out, error: 'falta el TMDB id' };
  }
  const exists = videoapi.existsUrl(resolved);
  if (!exists) return { ...out, error: 'sin ruta de exists (¿serie sin temporada/episodio?)' };

  const first = await get(exists, `${base()}/api`);
  if (!first.ok) return { ...out, error: `exists respondió HTTP ${first.status}` };
  let payload;
  try {
    payload = JSON.parse(first.text);
  } catch (_) {
    return { ...out, error: 'exists no devolvió JSON' };
  }
  out.exists = Boolean(payload && payload.exists === true);
  if (!out.exists) return { ...out, ok: true, note: 'no está en el catálogo (respuesta válida)' };

  const path = videoapi.playerPath(payload);
  out.path = path;
  if (!path) return { ...out, error: `path fuera de contrato: ${String(payload.path).slice(0, 60)}` };

  const pageUrl = `${base()}${path}`;
  const page = await get(pageUrl, `${base()}/`);
  if (!page.ok) return { ...out, error: `el reproductor respondió HTTP ${page.status}` };
  const frames = videoapi.playerFrames(page.text, pageUrl);
  out.iframes = frames.length;
  out.playerHost = frames[0] ? new URL(frames[0].url).host : null;
  if (!frames.length) return { ...out, error: 'la página no trae iframe del reproductor' };
  return { ...out, ok: true };
}

/**
 * El camino de producción en Stremio: el addon recibe un IMDb y necesita el
 * TMDB id. Solo se comprueba si hay TMDB configurado; si no, se avisa de la
 * consecuencia real (sin TMDB, VideoAPI no tiene con qué preguntar).
 */
async function probeImdb(imdb, mediaType, season, episode) {
  const resolved = await streams.resolveTitle(mediaType, `${imdb}:${season}:${episode}`);
  if (!resolved) return { title: `IMDb ${imdb}`, ok: false, error: 'no se pudo resolver el título' };
  if (!resolved.tmdbId) {
    return {
      title: `IMDb ${imdb} → ${resolved.title}`,
      ok: false,
      error: 'sin TMDB id: el entorno no tiene TMDB_API_KEY, y VideoAPI solo identifica por TMDB. ' +
        'En producción hace falta la clave (o que Stremio mande tmdb:<id>).',
    };
  }
  return probe(
    { mediaType: resolved.mediaType, tmdbId: resolved.tmdbId, season, episode },
    `IMDb ${imdb} → ${resolved.title} (TMDB ${resolved.tmdbId})`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Sonda real de VideoAPI (por TMDB, sin claves).\n\n' +
      '  --movie=157336       película de TMDB (por defecto Interstellar)\n' +
      '  --series=1396        serie de TMDB (por defecto Breaking Bad)\n' +
      '  --season=N --episode=N\n' +
      '  --imdb=tt0816692     comprueba además la traducción IMDb→TMDB\n' +
      '  --json               salida legible por máquina');
    return;
  }

  const results = [
    await probe({ mediaType: 'movie', tmdbId: options.movie }, `película TMDB ${options.movie}`),
    await probe(
      { mediaType: 'series', tmdbId: options.series, season: options.season, episode: options.episode },
      `serie TMDB ${options.series} S${options.season}E${options.episode}`
    ),
  ];
  if (options.imdb) {
    results.push(await probeImdb(options.imdb, 'movie', 1, 1));
  }

  if (options.json) {
    console.log(JSON.stringify({ host: base(), results }, null, 2));
  } else {
    console.log(`VideoAPI · ${base()}\n`);
    for (const item of results) {
      console.log(`${item.ok ? '✔' : '✘'} ${item.title}`);
      if (item.error) console.log(`    ${item.error}`);
      if (item.note) console.log(`    ${item.note}`);
      if (item.iframes) console.log(`    ${item.iframes} iframe(s) · host ${item.playerHost} · ${item.path}`);
    }
  }

  // Código de salida: cualquier obra que no se pueda verificar con éxito.
  process.exitCode = results.every((item) => item.ok) ? 0 : 1;
}

main().catch((err) => {
  console.error('La sonda falló:', (err && err.message) || err);
  process.exitCode = 1;
});
