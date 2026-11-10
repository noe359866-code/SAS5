#!/usr/bin/env node
/**
 * Pregenera los catálogos del manifest por defecto como archivos estáticos.
 *
 * ¿Por qué? En el plan gratuito de Cloudflare Workers la cuota es de
 * 100.000 peticiones/día **por cuenta**, y cada petición que ejecuta el
 * Worker consume cuota. Las peticiones a *static assets* son gratuitas e
 * ilimitadas. Con `[assets]` en wrangler.toml, un archivo que existe en
 * `public/` se sirve sin ejecutar el Worker: los catálogos "por defecto"
 * (los que ve la mayoría de la gente) dejan de gastar cuota.
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
import { mkdir, writeFile, rm } from 'node:fs/promises';
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

function parseArgs(argv) {
  const ids = [];
  const options = { concurrency: 4, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg.startsWith('--only=')) ids.push(arg.slice('--only='.length));
    else if (arg.startsWith('--concurrency=')) options.concurrency = Number(arg.split('=')[1]) || 4;
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  if (ids.length) options.ids = ids;
  return options;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node scripts/prerender-catalogs.mjs [--dry-run] [--only=<id>]… [--concurrency=N] [--out=dir]');
    process.exit(0);
  }
  prerender(options).catch((err) => {
    console.error('[prerender] Error inesperado:', (err && err.message) || err);
    process.exit(1);
  });
}
