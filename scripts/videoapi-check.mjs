#!/usr/bin/env node
/**
 * Sonda REAL de VideoAPI, sin dobles ni datos de ejemplo.
 *
 *   node scripts/videoapi-check.mjs                    # Interstellar + Breaking Bad
 *   node scripts/videoapi-check.mjs --imdb tt0816692
 *   node scripts/videoapi-check.mjs --series tt0903747 --season 1 --episode 1
 *   node scripts/videoapi-check.mjs --json
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
  const options = { imdb: 'tt0816692', series: 'tt0903747', season: 1, episode: 1, json: false };
  for (const arg of argv) {
    if (arg.startsWith('--imdb=')) options.imdb = arg.split('=')[1];
    else if (arg.startsWith('--series=')) options.series = arg.split('=')[1];
    else if (arg.startsWith('--season=')) options.season = Number(arg.split('=')[1]);
    else if (arg.startsWith('--episode=')) options.episode = Number(arg.split('=')[1]);
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

/** Una obra (película o episodio) de punta a punta. */
async function probe(mediaType, id, title) {
  const out = { title, mediaType, ok: false };
  const resolved = await streams.resolveTitle(mediaType, id);
  if (!resolved) return { ...out, error: 'no se pudo resolver el título' };
  out.resolvedTitle = resolved.title;
  out.tmdbId = resolved.tmdbId || null;
  if (!resolved.tmdbId) return { ...out, error: 'sin TMDB id: VideoAPI solo identifica por TMDB' };

  const exists = videoapi.existsUrl(resolved);
  const first = await get(exists, `${base()}/api`);
  if (!first.ok) return { ...out, error: `exists respondió HTTP ${first.status}` };
  let payload;
  try {
    payload = JSON.parse(first.text);
  } catch (_) {
    return { ...out, error: 'exists no devolvió JSON' };
  }
  out.exists = payload && payload.exists === true;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Sonda real de VideoAPI.\n\n' +
      '  --imdb=tt0816692     película de prueba\n' +
      '  --series=tt0903747   serie de prueba\n' +
      '  --season=N --episode=N\n' +
      '  --json               salida legible por máquina');
    return;
  }

  const results = [
    await probe('movie', options.imdb, `película ${options.imdb}`),
    await probe(
      'series',
      `${options.series}:${options.season}:${options.episode}`,
      `serie ${options.series} S${options.season}E${options.episode}`
    ),
  ];

  if (options.json) {
    console.log(JSON.stringify({ host: base(), results }, null, 2));
  } else {
    console.log(`VideoAPI · ${base()}\n`);
    for (const item of results) {
      console.log(`${item.ok ? '✔' : '✘'} ${item.title}${item.resolvedTitle ? ` → ${item.resolvedTitle}` : ''}`);
      if (item.tmdbId) console.log(`    TMDB ${item.tmdbId}`);
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
