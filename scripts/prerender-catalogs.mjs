#!/usr/bin/env node
/**
 * Pregenera catálogos y fichas (metas) como archivos estáticos.
 *
 * ¿Por qué? En el plan gratuito de Cloudflare Workers la cuota es de
 * 100.000 peticiones/día **por cuenta**, y cada petición que ejecuta el
 * Worker consume cuota. Las peticiones a *static assets* son gratuitas e
 * ilimitadas (con tope de 20.000 archivos por versión en el plan free). Con
 * `[assets]` en wrangler.toml, un archivo que existe en `public/` se sirve
 * sin ejecutar el Worker: los catálogos y las fichas "por defecto" (los que
 * ve la mayoría de la gente) dejan de gastar cuota.
 *
 * Las fichas son el segundo bloque de tráfico de Stremio (~15 %): cada vez
 * que alguien abre un título pide `/meta/<tipo>/<id>.json`. Si ese archivo
 * existe en `public/meta/`, la petición es gratis. Se pregeneran solo los
 * títulos que aparecen en los catálogos ya generados (no todo TMDB) y con la
 * configuración por defecto: una instalación sin personalizar usa esas
 * mismas fichas.
 *
 * Uso:
 *   node scripts/prerender-catalogs.mjs                # escribe en public/
 *   node scripts/prerender-catalogs.mjs --dry-run      # solo informa
 *   node scripts/prerender-catalogs.mjs --only=cine_tendencias --only=tv_tendencias
 *   node scripts/prerender-catalogs.mjs --concurrency=2
 *
 * Requiere las mismas variables que el Worker (TMDB_API_KEY/TMDB_ACCESS_TOKEN,
 * WATCH_REGION, TMDB_LANGUAGE...). En local cárgalas con un `.env`.
 * Si no hay clave de TMDB, los catálogos salen vacíos y **no se escribe nada**
 * (el Worker sigue resolviéndolos en caliente): el script nunca sustituye
 * datos buenos por listas vacías.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const libPath = (name) => path.join(ROOT, 'lib', name);

/**
 * Pregenera catálogos.
 * @param {object} [options]
 * @param {(type: string, id: string) => Promise<{metas: any[], cacheMaxAge?: number}>} [options.resolve]
 * @param {string[]|null} [options.ids]      ids a generar (null = todos)
 * @param {string} [options.outDir]          carpeta de salida (por defecto public/)
 * @param {number} [options.concurrency]     peticiones simultáneas a TMDB/TVMaze
 * @param {boolean} [options.dryRun]
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<{written: string[], empty: string[], failed: string[], ms: number}>}
 */
export async function prerender(options = {}) {
  const started = Date.now();
  const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 4));
  const dryRun = Boolean(options.dryRun);
  const log = options.log || ((line) => console.log(line));

  // Carga perezosa: así los tests pueden inyectar `resolve` sin tocar la red.
  const core = require(libPath('core.js'));
  const { buildDefs } = require(libPath('catalogs.js'));

  const resolve = options.resolve || ((type, id) => core.handleCatalog(type, id, null));
  const wanted = options.ids && options.ids.length ? new Set(options.ids) : null;
  const defs = buildDefs(null).filter((def) => !wanted || wanted.has(def.id));

  const catalogDir = path.join(outDir, 'catalog');
  if (!dryRun) await rm(catalogDir, { recursive: true, force: true });

  const written = [];
  const empty = [];
  const failed = [];
  let cursor = 0;

  async function worker() {
    while (cursor < defs.length) {
      const def = defs[cursor++];
      let result;
      try {
        result = await resolve(def.type, def.id);
      } catch (err) {
        failed.push(def.id);
        log(`  ✗ ${def.id}: ${(err && err.message) || err}`);
        continue;
      }
      const metas = Array.isArray(result && result.metas) ? result.metas : [];
      if (!metas.length) {
        empty.push(def.id);
        continue;
      }
      const body = JSON.stringify({ metas, cacheMaxAge: result.cacheMaxAge });
      const file = path.join(catalogDir, def.type, `${def.id}.json`);
      if (!dryRun) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body, 'utf8');
      }
      written.push(def.id);
      if (written.length % 10 === 0) log(`  · ${written.length} catálogos pregenerados…`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, defs.length || 1) }, worker));

  const ms = Date.now() - started;
  log(
    `${dryRun ? '[dry-run] ' : ''}Catálogos: ${written.length} escritos, ` +
    `${empty.length} vacíos (se dejan al Worker), ${failed.length} con error · ${ms} ms`
  );
  if (written.length) log(`Salida: ${path.relative(ROOT, catalogDir)}/`);
  else log('Nada escrito: sin datos (¿falta TMDB_API_KEY?) el Worker sigue sirviendo en caliente.');

  return { written, empty, failed, ms };
}

/**
 * Extrae del disco los tt… que aparecen en los catálogos ya pregenerados.
 * @param {string} catalogDir p. ej. `public/catalog`
 * @returns {Promise<Array<{type: string, id: string}>>}
 */
export async function catalogIds(catalogDir) {
  const found = new Map(); // `${type}/${id}` → { type, id }
  let dirs = [];
  try {
    dirs = await readdir(catalogDir, { withFileTypes: true });
  } catch (_) {
    return []; // sin catálogos pregenerados: nada que fichar
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const type = dir.name === 'anime' ? 'movie' : dir.name;
    if (type !== 'movie' && type !== 'series') continue;
    let files = [];
    try {
      files = await readdir(path.join(catalogDir, dir.name));
    } catch (_) {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      let parsed;
      try {
        parsed = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(catalogDir, dir.name, file), 'utf8'));
      } catch (_) {
        continue;
      }
      for (const meta of (parsed && parsed.metas) || []) {
        const id = meta && meta.id;
        // Solo IMDb: el resto de ids no forman una ruta de ficha fiable.
        if (typeof id !== 'string' || !/^tt\d+$/.test(id)) continue;
        found.set(`${type}/${id}`, { type, id });
      }
    }
  }
  return [...found.values()];
}

/**
 * Número de archivos bajo un directorio (para no pasar el tope de 20.000
 * archivos por versión que impone Cloudflare en el plan gratuito).
 */
export async function countFiles(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countFiles(path.join(dir, entry.name));
    else total += 1;
  }
  return total;
}

/**
 * Pregenera las fichas (`/meta/<tipo>/<id>.json`) de los títulos que aparecen
 * en los catálogos. Cada ficha que existe en `public/meta/` es una petición
 * menos al Worker (y una invocación menos de las 100.000/día del plan free).
 *
 * @param {object} [options]
 * @param {Array<{type: string, id: string}>} [options.ids]  a generar (por defecto: los de los catálogos)
 * @param {(type: string, id: string) => Promise<any>} [options.resolve]
 * @param {string} [options.outDir]
 * @param {number} [options.concurrency]
 * @param {number} [options.maxMetas]  tope de fichas (por defecto 1500)
 * @param {boolean} [options.dryRun]
 * @param {(line: string) => void} [options.log]
 */
export async function prerenderMetas(options = {}) {
  const started = Date.now();
  const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || 4));
  const dryRun = Boolean(options.dryRun);
  const maxMetas = Math.max(0, Number(options.maxMetas) || 1500);
  const log = options.log || ((line) => console.log(line));
  const core = require(libPath('core.js'));
  const resolve = options.resolve || ((type, id) => core.handleMeta(type, id, null));

  let targets = options.ids || (await catalogIds(path.join(outDir, 'catalog')));
  // Los catálogos se ordenan por relevancia: las fichas siguen ese orden, así
  // que si se alcanza el tope se quedan fuera los títulos menos visibles.
  if (targets.length > maxMetas) targets = targets.slice(0, maxMetas);

  const written = [];
  const empty = [];
  const failed = [];
  let bytes = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      let meta;
      try {
        meta = await resolve(target.type, target.id);
      } catch (err) {
        failed.push(`${target.type}/${target.id}`);
        log(`  ✗ ${target.type}/${target.id}: ${(err && err.message) || err}`);
        continue;
      }
      const data = meta && meta.meta;
      // Sin ficha no se escribe nada: el Worker la sigue resolviendo en vivo.
      if (!data || !data.id) {
        empty.push(`${target.type}/${target.id}`);
        continue;
      }
      const body = JSON.stringify({ meta: data, cacheMaxAge: meta.cacheMaxAge });
      const file = path.join(outDir, 'meta', target.type, `${target.id}.json`);
      if (!dryRun) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body, 'utf8');
      }
      bytes += Buffer.byteLength(body);
      written.push(`${target.type}/${target.id}`);
      if (written.length % 25 === 0) log(`  · ${written.length} fichas pregeneradas…`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length || 1) }, worker));

  const ms = Date.now() - started;
  log(
    `${dryRun ? '[dry-run] ' : ''}Fichas: ${written.length} escritas ` +
      `(${(bytes / 1024 / 1024).toFixed(1)} MB), ${empty.length} vacías (se dejan al Worker), ` +
      `${failed.length} con error · ${ms} ms`
  );
  return { written, empty, failed, bytes, ms };
}

function parseArgs(argv) {
  const ids = [];
  const options = { concurrency: 4, dryRun: false, metas: true };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg.startsWith('--only=')) ids.push(arg.slice('--only='.length));
    else if (arg.startsWith('--concurrency=')) options.concurrency = Number(arg.split('=')[1]) || 4;
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg === '--no-metas') options.metas = false;
    else if (arg === '--only-metas') options.onlyMetas = true;
    else if (arg.startsWith('--max-metas=')) options.maxMetas = Number(arg.split('=')[1]) || 1500;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  if (ids.length) options.ids = ids;
  return options;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

const ASSET_FILE_LIMIT = 20000; // tope de archivos por versión en Workers Free

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'node scripts/prerender-catalogs.mjs [--dry-run] [--only=<id>]… [--concurrency=N] [--out=dir]\n' +
      '                                   [--no-metas] [--only-metas] [--max-metas=N]'
    );
    process.exit(0);
  }
  (async () => {
    if (!options.onlyMetas) await prerender(options);
    if (options.metas || options.onlyMetas) await prerenderMetas(options);

    // Guardarraíl: Cloudflare Free admite 20.000 archivos por versión. Si nos
    // pasamos, `wrangler deploy` fallaría y nos quedaríamos sin web.
    const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
    const files = await countFiles(outDir);
    console.log(`[prerender] Archivos en public/: ${files} de ${ASSET_FILE_LIMIT} permitidos por Cloudflare Free.`);
    if (files > ASSET_FILE_LIMIT) {
      console.error(
        `[prerender] ¡Demasiados archivos! Cloudflare Free admite ${ASSET_FILE_LIMIT}. ` +
        'Baja el tope con --max-metas=N o deja de pregenerar con --no-metas.'
      );
      process.exit(1);
    }
  })().catch((err) => {
    console.error('[prerender] Error inesperado:', (err && err.message) || err);
    process.exit(1);
  });
}
