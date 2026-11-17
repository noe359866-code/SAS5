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
import { mkdir, writeFile, rm, readdir, stat, rename } from 'node:fs/promises';
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
  // Con `ids` se reescribe un subconjunto y se respeta el resto del directorio.
  // Sin `ids` es una generación completa: se escribe en un directorio temporal
  // y solo se sustituye si de verdad salió algo. Así un fallo de TMDB (o una
  // clave caducada) no deja el addon sin catálogos estáticos, que es lo que
  // pasaría borrando antes de generar.
  const stagingDir = !dryRun && !wanted ? `${catalogDir}.tmp` : catalogDir;
  if (!dryRun && !wanted) await rm(stagingDir, { recursive: true, force: true });

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
      const file = path.join(stagingDir, def.type, `${def.id}.json`);
      if (!dryRun) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body, 'utf8');
      }
      written.push(def.id);
      if (written.length % 10 === 0) log(`  · ${written.length} catálogos pregenerados…`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, defs.length || 1) }, worker));

  if (!dryRun && !wanted) {
    if (written.length) {
      // Sustitución atómica (mismo sistema de archivos): o están los nuevos,
      // o siguen los antiguos. Nunca un directorio a medias.
      await rm(catalogDir, { recursive: true, force: true });
      await rename(stagingDir, catalogDir);
    } else {
      await rm(stagingDir, { recursive: true, force: true });
      log('Nada nuevo que escribir: se conserva public/catalog/ tal como estaba.');
    }
  }

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
  // 6.000 fichas cubren ~150 catálogos de 40 títulos sin repetir, y siguen
  // dejando sitio para los catálogos por configuración en el tope de 20.000
  // archivos. El planificador recorta si no cabe (nunca se pasa).
  const maxMetas = Math.max(0, Number(options.maxMetas) || 6000);
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

/**
 * Pregenera las páginas 2…N de los catálogos ya escritos.
 *
 * Stremio pagina los catálogos de 20 en 20 (`/catalog/<tipo>/<id>/skip=20.json`)
 * y hasta ahora cada «cargar más» ejecutaba el Worker. La ruta del archivo es
 * la misma que usa el Worker (`/page-2.json`), así que basta con escribirla.
 *
 * @param {object} [options]
 * @param {string} [options.outDir]
 * @param {number} [options.pages] páginas por catálogo (por defecto 3)
 * @param {(type: string, id: string, skip: number) => Promise<{metas: any[], cacheMaxAge?: number}>} [options.resolve]
 * @param {(line: string) => void} [options.log]
 */
export async function prerenderPages(options = {}) {
  const started = Date.now();
  const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
  const pages = Math.max(1, Number(options.pages) || 3);
  const log = options.log || ((line) => console.log(line));
  const core = require(libPath('core.js'));
  const resolve = options.resolve || ((type, id, skip) => core.handleCatalog(type, id, null, { skip }));
  const catalogDir = path.join(outDir, 'catalog');

  // Solo los catálogos que ya existen: si la página 1 no se pudo generar, las
  // siguientes tampoco aportan nada.
  const targets = [];
  if (Array.isArray(options.ids) && options.ids.length) {
    // Lista explícita (`tipo/id`): solo esos catálogos.
    for (const entry of options.ids) {
      const [type, id] = String(entry).split('/');
      if (type && id) targets.push({ type, id });
    }
  }
  let typeDirs = [];
  try {
    typeDirs = targets.length ? [] : await readdir(catalogDir, { withFileTypes: true });
  } catch (_) {
    return { written: [], failed: [], skipped: 0, ms: Date.now() - started };
  }
  for (const dir of typeDirs) {
    if (!dir.isDirectory()) continue;
    const type = dir.name === 'anime' ? 'movie' : dir.name;
    let files = [];
    try {
      files = await readdir(path.join(catalogDir, dir.name));
    } catch (_) {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file.includes('/page-')) continue;
      targets.push({ type: dir.name, id: file.slice(0, -5) });
    }
  }

  const written = [];
  const failed = [];
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      for (let page = 2; page <= pages; page++) {
        const skip = (page - 1) * 20;
        let result;
        try {
          result = await resolve(target.type, target.id, skip);
        } catch (_) {
          failed.push(`${target.type}/${target.id}/page-${page}`);
          continue;
        }
        const metas = Array.isArray(result && result.metas) ? result.metas : [];
        // Sin resultados no se escribe: el Worker sigue sirviendo esa página
        // (y devolviendo la lista vacía correcta) sin que el archivo la congele.
        if (!metas.length) continue;
        const file = path.join(catalogDir, target.type, `${target.id}/page-${page}.json`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ metas, cacheMaxAge: result.cacheMaxAge }), 'utf8');
        written.push(`${target.type}/${target.id}/page-${page}`);
      }
      if (written.length && written.length % 40 === 0) log(`  · ${written.length} páginas pregeneradas…`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, targets.length || 1) }, worker));

  const ms = Date.now() - started;
  log(`${written.length} páginas adicionales escritas · ${failed.length} con error · ${ms} ms`);
  return { written, failed, skipped: 0, ms };
}

/**
 * Pregenera catálogos, fichas y manifest de configuraciones concretas.
 *
 * Cada usuario instala `/<cfg>/manifest.json`, y sus catálogos viven en
 * `/<cfg>/catalog/...` (no son estáticos). Escribir los de las configuraciones
 * más usadas convierte ese tráfico en archivos: 0 invocaciones del Worker.
 *
 * @param {object} [options]
 * @param {Array<{segment: string, cfg: object}>} [options.configs]
 * @param {string} [options.outDir]
 * @param {number[]} [options.pages] páginas a generar por catálogo (1-based)
 * @param {(type: string, id: string, cfg: object, extra: object) => Promise<any>} [options.resolve]
 * @param {(cfg: object) => object} [options.manifest] constructor del manifest
 * @param {boolean} [options.dryRun]
 * @param {(line: string) => void} [options.log]
 */
export async function prerenderConfigs(options = {}) {
  const started = Date.now();
  const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
  const pages = Array.isArray(options.pages) && options.pages.length ? options.pages : [1];
  const dryRun = Boolean(options.dryRun);
  const log = options.log || ((line) => console.log(line));
  const core = require(libPath('core.js'));
  const catalogsLib = require(libPath('catalogs.js'));
  const userConfig = require(libPath('userConfig.js'));
  const config = require(libPath('config.js'));

  const resolve = options.resolve
    || ((type, id, cfg, extra) => core.handleCatalog(type, id, cfg, extra));
  // El manifest debe llevar la URL absoluta del logo cuando se conoce el
  // origen; sin ella el Worker usa su propia variable y también vale.
  const manifestFor = options.manifest
    || ((cfg) => core.buildManifest(config.addonBaseUrl ? `${config.addonBaseUrl}/assets/logo.png` : null, cfg));

  const written = [];
  const failed = [];
  const manifests = [];
  for (const entry of options.configs || []) {
    if (!entry || typeof entry.segment !== 'string' || !entry.segment) continue;
    const cfg = entry.cfg || userConfig.decodeConfig(
      entry.segment, catalogsLib.PLATFORM_KEYS, catalogsLib.STUDIO_KEYS, require(libPath('streams.js')).PROVIDER_KEYS
    );
    // Con debrid el segmento es por usuario y sus streams son privados.
    if (!cfg || cfg.debridId) continue;

    // Si el planificador decidió qué archivos exactos tocan (`files`), se
    // respeta al pie de la letra: el presupuesto de 20.000 no es negociable.
    const planned = Array.isArray(entry.files) ? entry.files : null;
    const wanted = planned
      ? new Set(planned.map((file) => file.path))
      : null;
    // Páginas que pidió el planificador (1, 2, 3…), no las que «podrían» caber.
    const plannedPages = planned
      ? [...new Set(planned.map((file) => file.page || 1))].sort((a, b) => a - b)
      : pages;

    for (const def of catalogsLib.buildDefs(cfg)) {
      for (const page of plannedPages) {
        const suffix = page > 1 ? `/page-${page}` : '';
        const route = `/${entry.segment}/catalog/${def.type}/${def.id}${suffix}.json`;
        if (wanted && !wanted.has(route)) continue;
        const skip = (page - 1) * 20;
        let result;
        try {
          result = await resolve(def.type, def.id, cfg, skip ? { skip: String(skip) } : {});
        } catch (_) {
          failed.push(`${entry.segment}/${def.id}/p${page}`);
          continue;
        }
        const metas = Array.isArray(result && result.metas) ? result.metas : [];
        if (!metas.length) continue;
        const file = path.join(outDir, entry.segment, 'catalog', def.type, `${def.id}${suffix}.json`);
        if (!dryRun) {
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, JSON.stringify({ metas, cacheMaxAge: result.cacheMaxAge }), 'utf8');
        }
        written.push(`${entry.segment}/catalog/${def.type}/${def.id}${suffix}.json`);
      }
    }

    // Manifest: es lo que Stremio pide al abrir el addon en cada sesión.
    const manifestRoute = `/${entry.segment}/manifest.json`;
    if (wanted && !wanted.has(manifestRoute)) continue;
    const manifest = manifestFor(cfg);
    const manifestFile = path.join(outDir, entry.segment, 'manifest.json');
    if (!dryRun) {
      await mkdir(path.dirname(manifestFile), { recursive: true });
      await writeFile(manifestFile, JSON.stringify(manifest), 'utf8');
    }
    manifests.push(manifestRoute);
  }

  const ms = Date.now() - started;
  log(
    `${dryRun ? '[dry-run] ' : ''}Configuraciones: ${manifests.length} manifest, ` +
    `${written.length} catálogos · ${failed.length} con error · ${ms} ms`
  );
  return { written, manifests, failed, ms };
}

/**
 * Pregenera el configurador como archivo estático por REGIÓN.
 *
 * El botón «Configurar» de Stremio abre `/<cfg>/configure`, que hasta ahora
 * renderizaba el Worker entero (headerg, muro de pósters, 121 catálogos…) en
 * cada clic. `_redirects` lo manda a `/configure/r/<REGION>`, que es este
 * archivo: 0 invocaciones.
 *
 * Lo que se pierde: la selección fina del usuario (plataformas y estudios
 * marcados) no aparece premarcada; la región y el idioma sí. El borrador del
 * navegador (`localStorage`) tiene prioridad, así que quien configure desde el
 * mismo navegador sigue viendo su selección.
 *
 * @param {object} [options]
 * @param {Array<{region: string}>} [options.regions] regiones a generar
 * @param {string} [options.outDir]
 * @param {(region: string) => string} [options.render] HTML de una región
 * @param {boolean} [options.dryRun]
 * @param {(line: string) => void} [options.log]
 */
export async function prerenderConfigPages(options = {}) {
  const started = Date.now();
  const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
  const dryRun = Boolean(options.dryRun);
  const log = options.log || ((line) => console.log(line));
  const regions = options.regions || require(libPath('userConfig.js')).REGION_OPTIONS.map((r) => r.code);
  const render = options.render;
  const renderOne = render || ((region) => {
    const config = require(libPath('config.js'));
    const { renderConfigure } = require(libPath('configurePage.js'));
    const origin = String(process.env.PUBLIC_ORIGIN || process.env.ADDON_BASE_URL || config.addonBaseUrl || '').trim().replace(/\/+$/, '');
    if (!origin) return null;
    return renderConfigure({
      origin,
      host: new URL(origin).host,
      trendingMovies: options.trendingMovies,
      trendingSeries: options.trendingSeries,
      preset: { region },
    });
  });

  const written = [];
  for (const region of regions) {
    if (!/^[A-Z]{2}$/.test(String(region))) continue;
    let html = null;
    try {
      html = renderOne(region);
    } catch (err) {
      log(`  ✗ /configure/r/${region}: ${(err && err.message) || err}`);
      continue;
    }
    // Sin PUBLIC_ORIGIN no se puede hornear la URL del manifest: se deja al
    // Worker (que lo renderiza en caliente) en vez de publicar enlaces rotos.
    if (!html) continue;
    const file = path.join(outDir, 'configure', 'r', `${region}.html`);
    if (!dryRun) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, html, 'utf8');
    }
    written.push(`/configure/r/${region}`);
  }

  log(
    `${dryRun ? '[dry-run] ' : ''}Configuradores por región: ${written.length} escritos · ` +
    `${Date.now() - started} ms` +
    (written.length ? '' : ' (define PUBLIC_ORIGIN para pregenerarlos)')
  );
  return { written, ms: Date.now() - started };
}

/**
 * Escribe `public/_redirects` con las rutas que el Worker resolvía gastando
 * una invocación (`/watch`, barras finales…). Se conserva lo que no gestiona
 * este script, para no pisar reglas manuales.
 */
export async function writeRedirects(options = {}) {
  const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
  const { buildRedirects, renderRedirects } = require(libPath('edgeRoutes.js'));
  const file = path.join(outDir, '_redirects');
  const log = options.log || ((line) => console.log(line));
  const { REGION_OPTIONS } = require(libPath('userConfig.js'));
  const { rules, dropped } = buildRedirects({
    configs: options.configs || [],
    regions: new Set(REGION_OPTIONS.map((region) => region.code)),
  });

  let existing = '';
  try {
    existing = await (await import('node:fs/promises')).readFile(file, 'utf8');
  } catch (_) { /* primera vez */ }
  const next = renderRedirects(rules, existing);
  if (!options.dryRun) await writeFile(file, next, 'utf8');
  log(
    `_redirects: ${rules.length} reglas en el borde (0 invocaciones)` +
    ` · ${rules.filter((rule) => rule.from.includes('/configure')).length} llevan el «Configurar» de Stremio a un configurador pregenerado` +
    (dropped ? ` · ${dropped} descartadas por el tope de Cloudflare` : '')
  );
  return { rules: rules.length, dropped };
}

function parseArgs(argv) {
  const ids = [];
  const options = { concurrency: 4, dryRun: false, metas: true, pages: 3 };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg.startsWith('--only=')) ids.push(arg.slice('--only='.length));
    else if (arg.startsWith('--concurrency=')) options.concurrency = Number(arg.split('=')[1]) || 4;
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg === '--no-metas') options.metas = false;
    else if (arg === '--only-metas') options.onlyMetas = true;
    else if (arg.startsWith('--max-metas=')) options.maxMetas = Number(arg.split('=')[1]) || 6000;
    else if (arg.startsWith('--pages=')) options.pages = Math.max(1, Number(arg.split('=')[1]) || 3);
    else if (arg === '--no-pages') options.pages = 1;
    else if (arg === '--no-configs') options.configs = false;
    else if (arg === '--no-config-pages') options.configPages = false;
    else if (arg.startsWith('--from-url=')) options.fromUrl = arg.slice('--from-url='.length);
    else if (arg === '--from-url') options.fromUrl = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  if (ids.length) options.ids = ids;
  return options;
}

/**
 * Lee el informe de configuraciones vistas desde un despliegue.
 *
 * `/internal/cache.json` expone `configs.{configs[],totalSegments,totalHits}`
 * con el segmento y su popularidad normalizada. Sin este dato, el planificador
 * solo puede adivinar; con él, pregenera exactamente lo que más se pide.
 *
 * @param {string} baseUrl origen del despliegue
 * @param {number} [timeoutMs]
 * @returns {Promise<Array<{segment: string, cfg: object, popularity: number}>>}
 */
export async function fetchConfigReport(baseUrl, timeoutMs = 15000) {
  const origin = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!origin) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/internal/cache.json?configs=100`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const body = await response.json();
    const configs = body && body.configs && Array.isArray(body.configs.configs) ? body.configs.configs : [];
    return configs
      .filter((entry) => entry && typeof entry.segment === 'string' && entry.segment && entry.cfg)
      .map((entry) => ({ segment: entry.segment, cfg: entry.cfg, popularity: Number(entry.popularity) || 1 }));
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plan de archivos a pregenerar (el reparto del presupuesto vive en
 * `lib/staticPlan.js`, que tiene sus propios tests).
 *
 * @param {object} args
 * @param {Array} args.configs configuraciones vistas (con popularidad)
 * @param {number} args.budget archivos disponibles
 * @param {object} [args.catalogsLib]
 * @param {Array} [args.titles] fichas candidatas
 * @param {number[]} [args.pages] páginas por catálogo
 */
export function planStaticFiles({
  configs, budget, catalogsLib, titles = [], pages = [1, 2, 3], defs = [], defaultCatalogPages = 1,
}) {
  const { buildPlan } = require(libPath('staticPlan.js'));
  const lib = catalogsLib || require(libPath('catalogs.js'));
  return buildPlan({
    configs,
    titles,
    defs,
    budget,
    popularPages: pages,
    catalogPages: defaultCatalogPages,
    defsFor: (cfg) => lib.buildDefs(cfg),
  });
}

/** Suma los recuentos por tipo de dos planes. */
function mergeKinds(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [kind, count] of Object.entries(map || {})) out[kind] = (out[kind] || 0) + count;
  }
  return out;
}

/** Resuelve la página `skip` de un catálogo por defecto (mismo camino que el Worker). */
function coreCatalogPage(type, id, skip) {
  return require(libPath('core.js')).handleCatalog(type, id, null, { skip: String(skip) });
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

const ASSET_FILE_LIMIT = 20000; // tope de archivos por versión en Workers Free

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'node scripts/prerender-catalogs.mjs [--dry-run] [--only=<id>]… [--concurrency=N] [--out=dir]\n' +
      '                                   [--no-metas] [--only-metas] [--max-metas=N]\n' +
      '                                   [--pages=N] [--no-pages] [--no-configs]\n' +
      '                                   [--no-config-pages]\n' +
      '                                   [--from-url=https://tu-dominio]'
    );
    process.exit(0);
  }
  (async () => {
    const outDir = path.resolve(ROOT, options.outDir || process.env.PRERENDER_OUT_DIR || 'public');
    const { BASE_RESERVE } = require(libPath('staticPlan.js'));
    const catalogsLib = require(libPath('catalogs.js'));
    const pages = options.pages > 1 ? [1, 2, 3].slice(0, options.pages) : [1];

    if (options.onlyMetas) {
      // Modo fichas: solo eso, sin plan ni proyección.
      await prerenderMetas(options);
    } else {
      // ── Datos reales del despliegue ─────────────────────────────────────
      const fromUrl = options.fromUrl === true
        ? (process.env.PUBLIC_ORIGIN || process.env.ADDON_BASE_URL || '')
        : options.fromUrl;
      const configs = (options.configs === false || !fromUrl) ? [] : await fetchConfigReport(fromUrl);
      if (fromUrl && options.configs !== false && !configs.length) {
        console.log(`[prerender] Sin informe de configuraciones en ${fromUrl} (¿despliegue nuevo?). Se omite ese paso.`);
      }

      // ── Presupuesto: se cuenta lo que ya hay en public/ (web, logo…) ────
      const existing = await countFiles(outDir);
      const budget = Math.max(0, ASSET_FILE_LIMIT - BASE_RESERVE - existing);

      // ── Fase A: catálogos por defecto y sus páginas ─────────────────────
      // Las fichas dependen de los títulos que salgan de estos catálogos, así
      // que el plan se hace en dos pasos. En la primera ejecución (
      // public/catalog no existe) no hay nada en disco: se generan todos los
      // catálogos que el plan permita en vez de no escribir nada.
      const planA = planStaticFiles({
        configs: [], budget, titles: [], catalogsLib, pages,
        defs: catalogsLib.buildDefs(null),
        defaultCatalogPages: pages.length,
      });
      const wantedDefaults = new Set(planA.files.map((file) => file.path));
      const plannedPage = (type, id, page) => wantedDefaults.has(
        `/catalog/${type}/${id}${page > 1 ? `/page-${page}` : ''}.json`
      );

      let onDisk = [];
      try {
        const dirs = await readdir(path.join(outDir, 'catalog'), { withFileTypes: true });
        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;
          for (const file of await readdir(path.join(outDir, 'catalog', dir.name))) {
            if (file.endsWith('.json') && !file.includes('/page-')) {
              onDisk.push({ type: dir.name, id: file.slice(0, -5) });
            }
          }
        }
      } catch (_) { /* primera ejecución */ }

      const writeDefaults = onDisk.length
        ? onDisk.filter((item) => plannedPage(item.type, item.id, 1))
        : catalogsLib.buildDefs(null).filter((def) => plannedPage(def.type, def.id, 1));

      if (writeDefaults.length) {
        await prerender({ ...options, ids: writeDefaults.map((item) => item.id) });
      } else {
        console.log('[prerender] Catálogos por defecto: nada que escribir dentro del presupuesto.');
      }

      // Páginas 2..N de esos catálogos (el «cargar más» de Stremio).
      //
      // Se regeneran las que faltan Y las que ya existían: aunque el catálogo
      // de la página 1 no cambie (lo normal entre ejecuciones cada 6 h), sus
      // páginas deben refrescarse igual que él. Sin esto, la página 2 de un
      // catálogo «sin novedades» se quedaría congelada para siempre.
      if (pages.length > 1) {
        const withPages = new Set();
        try {
          for (const dir of await readdir(path.join(outDir, 'catalog'), { withFileTypes: true })) {
            if (!dir.isDirectory()) continue;
            for (const id of await readdir(path.join(outDir, 'catalog', dir.name))) {
              try {
                const sub = await readdir(path.join(outDir, 'catalog', dir.name, id));
                if (sub.some((name) => /^page-\d+\.json$/.test(name))) withPages.add(`${dir.name}/${id}`);
              } catch (_) { /* no es un directorio: es un catálogo de página 1 */ }
            }
          }
        } catch (_) { /* primera ejecución */ }
        const needsPages = [...new Set([
          ...writeDefaults.map((item) => `${item.type}/${item.id}`),
          ...withPages,
        ])];
        await prerenderPages({
          outDir,
          pages: pages.length,
          log: () => {},
          ids: needsPages,
          resolve: async (type, id, skip) => {
            if (!plannedPage(type, id, skip / 20 + 1)) return { metas: [] };
            return coreCatalogPage(type, id, skip);
          },
        });
      }

      // ── Fase B: fichas de los títulos que aparecen en esos catálogos ────
      const titles = [];
      if (options.metas) {
        const seen = new Set();
        for (const title of await catalogIds(path.join(outDir, 'catalog'))) {
          const key = `${title.type}/${title.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          titles.push(title);
        }
      }
      const written = await countFiles(outDir);
      const budgetLeft = Math.max(0, ASSET_FILE_LIMIT - BASE_RESERVE - written);
      const planB = planStaticFiles({
        configs, budget: budgetLeft, titles, catalogsLib, pages: [1],
      });
      const wantedMetas = new Set(planB.files.map((file) => file.path));
      if (options.metas && titles.length) {
        await prerenderMetas({
          ...options,
          ids: titles.filter((title) => wantedMetas.has(`/meta/${title.type}/${title.id}.json`)),
        });
      }

      // El plan que se publicó es la suma de las dos fases (sin solapes: la
      // fase A no lleva configuraciones ni fichas).
      const plan = {
        files: [...planA.files, ...planB.files],
        byKind: mergeKinds(planA.byKind, planB.byKind),
        skipped: planA.skipped + planB.skipped,
        budget,
        daily: planA.daily + planB.daily,
      };

      // Catálogos + manifest de las configuraciones populares.
      const configured = plan.files.filter((file) => file.segment);
      if (configured.length) {
        const bySegment = new Map();
        for (const file of configured) {
          if (!bySegment.has(file.segment)) {
            const source = configs.find((entry) => entry.segment === file.segment);
            bySegment.set(file.segment, { segment: file.segment, cfg: source && source.cfg, files: [] });
          }
          bySegment.get(file.segment).files.push(file);
        }
        const chosen = [...bySegment.values()];
        console.log(
          `[prerender] Plan: ${chosen.length} de ${configs.length} configuraciones ` +
          `(${plan.byKind.manifest || 0} manifest, ${plan.byKind['catalog-configured'] || 0}+` +
          `${plan.byKind['catalog-configured-page'] || 0} catálogos) · ` +
          `${plan.byKind['catalog-default'] || 0} catálogos por defecto, ${plan.byKind.meta || 0} fichas · ` +
          `presupuesto ${plan.budget} archivos libres, ${existing} ya en public/` +
          (plan.skipped ? ` · ${plan.skipped} descartados por prioridad` : '') + '.'
        );
        await prerenderConfigs({ ...options, configs: chosen, pages });
      } else {
        console.log(
          `[prerender] Plan: ${plan.byKind['catalog-default'] || 0} catálogos por defecto, ` +
          `${plan.byKind.meta || 0} fichas · presupuesto ${plan.budget} archivos libres` +
          (configs.length ? ' · ninguna configuración entra en el presupuesto' : '') + '.'
        );
      }

      // Configurador pregenerado por región: es a donde apunta el «Configurar»
      // de Stremio vía _redirects. Solo las regiones que aparecen en el
      // informe (más la del despliegue): generar las 90 no vale para nada.
      if (options.configPages !== false) {
        const deployRegion = String(process.env.WATCH_REGION || require(libPath('config.js')).watchRegion || 'NI').toUpperCase();
        const regions = new Set([deployRegion]);
        for (const entry of configs) {
          if (entry.cfg && /^[A-Z]{2}$/.test(entry.cfg.region || '')) regions.add(entry.cfg.region);
        }
        const { written: pages } = await prerenderConfigPages({
          outDir,
          regions: [...regions],
          dryRun: options.dryRun,
          trendingMovies: null,
          trendingSeries: null,
        });
        if (pages.length) {
          console.log(`[prerender] Configurador estático en ${pages.length} regiones (0 invocaciones por clic en «Configurar»).`);
        }
      }

      // Proyección honesta con el plan que de verdad se escribió.
      const { projectPlan, capacityWithPlan } = require(libPath('scaleAudit.js'));
      const projected = projectPlan({ plan, total: Number(process.env.PLAN_TOTAL_REQUESTS) || 500_000 });
      const coverage = Math.round(Math.min(1, plan.daily) * 100);
      console.log(`[prerender] Cobertura estática: ${coverage} % de las peticiones (el resto son streams, que siempre ejecutan el Worker).`);
      console.log(
        `[prerender] Con este plan el Worker ejecuta ~${projected.workerRequests.toLocaleString('es')} de ` +
        `${projected.total.toLocaleString('es')} peticiones/día (${Math.round(projected.usage * 100)} % del plan free) ` +
        `→ aguanta ~${capacityWithPlan({ files: plan.files }).toLocaleString('es')} peticiones/día.`
      );

      if (options.configs !== false) await writeRedirects({ outDir, configs });
    }

    // Guardarraíl: Cloudflare Free admite 20.000 archivos por versión. Si nos
    // pasamos, `wrangler deploy` fallaría y nos quedaríamos sin web.
    const files = await countFiles(outDir);
    console.log(`[prerender] Archivos en public/: ${files} de ${ASSET_FILE_LIMIT} permitidos por Cloudflare Free.`);
    if (files > ASSET_FILE_LIMIT) {
      console.error(
        `[prerender] ¡Demasiados archivos! Cloudflare Free admite ${ASSET_FILE_LIMIT}. ` +
        'Baja el tope con --max-metas=N, --pages=N o deja de pregenerar con --no-metas.'
      );
      process.exit(1);
    }
  })().catch((err) => {
    console.error('[prerender] Error inesperado:', (err && err.message) || err);
    process.exit(1);
  });
}
