#!/usr/bin/env node
/**
 * PlayLatinSRC (https://playlatinsrc.co) — sonda REAL del proveedor integrado.
 *
 * No es una sonda de viabilidad: usa el mismo código que producción
 * (`lib/playlatin.js`), así que si esto pasa, el proveedor sirve. Comprueba el
 * contrato completo, que es lo que puede romperse solo:
 *
 *   1. La página del embed (`/custom/movie/{imdb}`) sigue trayendo el
 *      `.player-shell` con `data-id` y `data-resolve-token`.
 *   2. `POST /api/resolve` (con el token en el cuerpo) devuelve `ok:true` y
 *      `sources[]` con URLs `https` jugables.
 *   3. Los `sources` se normalizan a las tres versiones que usa el addon
 *      (Latino, Castellano, Subtitulado) y salen con `Referer` correcto.
 *   4. Opcionalmente (`--stream`), que el buscador del addon devuelve streams.
 *
 *   node scripts/playlatin-check.mjs
 *   node scripts/playlatin-check.mjs --imdb tt0110357
 *   node scripts/playlatin-check.mjs --series tt0108778 --season 1 --episode 1
 *   node scripts/playlatin-check.mjs --stream --json
 *
 * Necesita red hacia el sitio, no claves. Sale con código 1 si la página, el
 * resolve o los enlaces fallan, para poder usarlo como paso estricto.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../lib/config.js');
const playlatin = require('../lib/playlatin.js');

const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS) || 15_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const base = () => String(config.playlatinUrl || 'https://playlatinsrc.co').replace(/\/+$/, '');

function parseArgs(argv) {
  const options = { imdb: 'tt0110357', series: null, season: 1, episode: 1, stream: false, json: false };
  const valued = { '--imdb': 'imdb', '--series': 'series', '--season': 'season', '--episode': 'episode' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (valued[key]) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options[valued[key]] = key === '--season' || key === '--episode' ? Number(value) : value;
    } else if (arg === '--stream') options.stream = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

async function get(url, referer) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', Referer: referer },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

/** Una obra de punta a punta con el código del proveedor. */
async function probe(resolved, label) {
  const out = { title: label, imdb: resolved.imdbId, ok: false };
  const path = playlatin.pagePath(resolved);
  if (!path) return { ...out, error: 'sin ruta: falta IMDb o temporada/episodio' };
  out.path = path;

  // 1. Cáscara del embed.
  const page = await get(`${base()}${path}`, `${base()}/`);
  if (!page.ok) return { ...out, error: `la página respondió HTTP ${page.status}` };
  const shell = playlatin.parseShell(page.text);
  out.shell = { id: shell.id, type: shell.type, mode: shell.mode, token: Boolean(shell.token) };
  if (!shell.token || !shell.id) {
    return {
      ...out,
      ok: true,
      note: 'la página no trae token: el título no está en su catálogo (respuesta válida)',
    };
  }

  // 2. Resolve con el token en el cuerpo, igual que en producción.
  const res = await fetch(`${base()}/api/resolve`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: `${base()}${path}`,
    },
    body: JSON.stringify({
      type: shell.type || (resolved.mediaType === 'movie' ? 'movie' : 'series'),
      id: shell.id,
      season: shell.season || '',
      episode: shell.episode || '',
      mode: shell.mode,
      token: shell.token,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text();
  if (!res.ok) return { ...out, error: `el resolve respondió HTTP ${res.status}` };
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    return { ...out, error: 'el resolve no devolvió JSON (¿token caducado?)' };
  }
  out.resolve = { ok: payload.ok === true, error: payload.error || null, sources: Array.isArray(payload.sources) ? payload.sources.length : 0 };
  if (payload.ok !== true) {
    return { ...out, error: `resolve dijo ${payload.error || 'ok:false'}` };
  }

  // 3. Normalización a lo que ve Stremio.
  const entries = playlatin.normalizeSources(payload);
  out.streams = entries.length;
  out.languages = [...new Set(entries.map((entry) => entry.label))];
  out.kinds = [...new Set(entries.map((entry) => entry.kind))];
  out.hosts = [...new Set(entries.map((entry) => entry.server))].slice(0, 4);
  out.samples = entries.slice(0, 2).map((entry) => ({
    host: entry.server,
    version: entry.label,
    kind: entry.kind,
    url: `${entry.url.split('?')[0].slice(0, 60)}…`,
  }));
  if (!entries.length) return { ...out, error: 'resolve ok pero sin sources https jugables' };
  return { ...out, ok: true };
}

/** El camino de producción: el buscador del addon dentro de `streams`. */
async function probeSearcher(resolved) {
  const streams = require('../lib/streams.js');
  const started = Date.now();
  const result = await streams.SEARCHERS.playlatin(resolved.title, resolved, resolved.title, TIMEOUT_MS);
  const hits = (result && result.hits) || [];
  return {
    hits: hits.length,
    ms: Date.now() - started,
    skipped: result && result.skipped,
    languages: [...new Set(hits.map((hit) => hit.audioLabel))],
    proxyHeaders: hits[0] ? Boolean(hits[0].referer) : false,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Sonda real de PlayLatinSRC (por IMDb, sin claves).\n\n' +
      '  --imdb=tt0110357      película de prueba (por defecto El rey león)\n' +
      '  --series=tt0108778    serie de prueba (Friends)\n' +
      '  --season=N --episode=N\n' +
      '  --stream              además, el buscador del addon de punta a punta\n' +
      '  --json                salida legible por máquina');
    return;
  }

  const movie = { mediaType: 'movie', imdbId: options.imdb, title: options.imdb };
  const results = [await probe(movie, `película ${options.imdb}`)];

  if (options.series) {
    const episode = {
      mediaType: 'series',
      imdbId: options.series,
      title: options.series,
      season: options.season,
      episode: options.episode,
    };
    results.push(await probe(episode, `serie ${options.series} S${options.season}E${options.episode}`));
  }

  let searcher = null;
  if (options.stream) {
    try {
      searcher = await probeSearcher(movie);
    } catch (err) {
      searcher = { error: (err && err.message) || String(err) };
    }
  }

  const exitOk = results.every((item) => item.ok) && (!searcher || searcher.hits > 0);

  if (options.json) {
    console.log(JSON.stringify({ host: base(), results, searcher }, null, 2));
  } else {
    console.log(`PlayLatinSRC · ${base()}\n`);
    for (const item of results) {
      console.log(`${item.ok ? '✔' : '✘'} ${item.title} · ${item.path || item.error}`);
      if (item.error) console.log(`    ${item.error}`);
      if (item.note) console.log(`    ${item.note}`);
      if (item.streams) {
        console.log(`    ${item.streams} stream(s) · ${item.languages.join(', ')} · ${item.kinds.join('/')}`);
        console.log(`    hosts: ${item.hosts.join(', ')}`);
      }
      if (item.resolve) console.log(`    resolve ok=${item.resolve.ok} · sources=${item.resolve.sources}`);
    }
    if (searcher) {
      console.log('');
      if (searcher.error) console.log(`✘ buscador del addon: ${searcher.error}`);
      else {
        console.log(`${searcher.hits > 0 ? '✔' : '✘'} buscador del addon · ${searcher.hits} hit(s) en ${searcher.ms} ms`);
        if (searcher.skipped) console.log(`    ${searcher.skipped}`);
        if (searcher.languages.length) console.log(`    idiomas: ${searcher.languages.join(', ')} · referer: ${searcher.proxyHeaders}`);
      }
    }
  }

  // Código de salida: cualquier obra que no se pueda verificar con éxito.
  process.exitCode = exitOk ? 0 : 1;
}

main().catch((err) => {
  console.error('La sonda falló:', (err && err.message) || err);
  process.exitCode = 1;
});
