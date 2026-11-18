'use strict';

/**
 * Planificador de estáticos: decide QUÉ archivos de `public/` conviene
 * pregenerar para que las peticiones de Stremio NO ejecuten el Worker.
 *
 * ## Por qué existe este archivo
 *
 * En `*.workers.dev` **toda** petición que no sea un archivo de `public/`
 * ejecuta el Worker y gasta una de las 100.000 invocaciones/día del plan free.
 * Al agotarlas, Cloudflare responde `Error 1027` y el addon deja de funcionar.
 * Ahí no hay Cache API ni Cache Rules que ayuden: los static assets son la
 * única palanca gratuita e ilimitada.
 *
 * El tráfico de un addon de Stremio es muy repetitivo:
 *
 *  - **Catálogos** (~62 %): casi siempre los mismos (Tendencias, Populares,
 *    Netflix, Marvel…) y Stremio los pide de 20 en 20 (`skip`).
 *  - **Fichas** (~15 %): solo de los títulos que aparecen en esos catálogos.
 *  - **Manifest** (~8 %): una vez por sesión y usuario.
 *
 * Pero cada usuario instala `/<cfg>/manifest.json`, así que sus catálogos
 * viven en `/<cfg>/catalog/...`, que **no** son estáticos. Este módulo decide
 * cuánto de eso cabe en el tope de 20.000 archivos de Cloudflare Free:
 *
 *  1. Catálogos por defecto (`/catalog/...`): los usa todo el que no
 *     personaliza, y son la mayor palanca.
 *  2. Fichas (`/meta/...`): no dependen de la selección del usuario, así que
 *     una sola copia sirve a todas las configuraciones.
 *  3. Catálogos de las configuraciones populares, con páginas extra
 *     (`/page-2.json`, `/page-3.json`).
 *  4. Manifest de las configuraciones frecuentes: aunque no haya presupuesto
 *     para sus catálogos, evita una invocación por sesión y usuario.
 *
 * Cada archivo cuesta lo mismo (1) y se elige por `daily = peticiones/día que
 * ahorra`. Los topes por tipo (`caps`) impiden que un solo grupo se coma el
 * presupuesto y deje a los demás sin nada.
 */

const ASSET_FILE_LIMIT = 20000; // tope de archivos por versión en Cloudflare Workers Free

/** Archivos reservados para lo que no planifica este módulo (web, logo, _headers…). */
const BASE_RESERVE = 80;

/**
 * Reparto del tráfico diario que cada grupo puede llegar a cubrir, en fracción
 * del TOTAL de peticiones (no de su grupo).
 *
 * Los porcentajes salen de `DEFAULT_MIX` (docs/escala-plan-free.md): catálogos
 * 62 %, fichas 15 %, web 13 %, streams 10 %. Los streams nunca se pregeneran:
 * dependen del título y se resuelven con fuentes de reproducción directa.
 * Así, la suma de los grupos estáticos es 0,90: el plan no promete más.
 *
 * Importante: no se solapan. `catalogDefault` + `catalogConfigured` +
 * `catalogConfiguredPages` suman 0,62, el tráfico real de catálogos; si se
 * contaran por separado, la proyección diría «0 invocaciones», que es mentira.
 */
const TRAFFIC = {
  catalogDefault: 0.40,      // instalaciones sin personalizar
  catalogConfigured: 0.14,   // página 1 de las configs populares
  catalogConfiguredPages: 0.08, // páginas 2-3 de esas configs (el «cargar más»)
  meta: 0.15,
  manifest: 0.08,            // parte del 13 % de web
  configByRegion: 0.03,      // /configure/r/XX: el «Configurar» de Stremio
};

/**
 * Topes de presupuesto por tipo: nadie se queda sin su parte.
 *
 * Las fichas tienen el segundo mayor porque una sola copia sirve a TODAS las
 * configuraciones (no dependen de la selección): es el archivo con mejor
 * relación «peticiones ahorradas / archivo» después de los catálogos por
 * defecto. Las páginas 2-3 van al final porque solo sirven a quien pulsa
 * «cargar más» en una configuración concreta.
 */
const CAPS = {
  'catalog-default': 0.45,
  meta: 0.40,
  'catalog-configured': 0.15,
  'catalog-configured-page': 0.10,
  manifest: 0.08,
};

/** Páginas de catálogo (`skip`) pregeneradas para las configs populares. */
const DEFAULT_PAGES = [1, 2, 3];

/**
 * ¿Se puede pregenerar esta configuración?
 *
 * Las respuestas se pueden pregenerar para cualquier configuración válida.
 */
function isPlannableConfig(cfg) {
  return Boolean(cfg);
}

/**
 * Clave canónica de una configuración.
 *
 * Solo cuenta lo que **cambia el contenido** de catálogos y fichas: idioma,
 * región, plataformas, estudios y catálogos base. Proveedores de streams,
 * filtros y orden NO cambian un catálogo, así que dos configs que solo
 * difieran en eso comparten archivos (y caché) sin ningún riesgo.
 */
function configKey(cfg) {
  if (!cfg) return 'default';
  const sorted = (value) => (Array.isArray(value) ? value.slice().sort().join(',') : '*');
  return [
    cfg.lang || '',
    cfg.region || '',
    sorted(cfg.platforms),
    sorted(cfg.studios),
    sorted(cfg.base),
  ].join('|');
}

/** Página (1-based) → sufijo de archivo: la página 1 es `catalog.json`. */
function pageSuffix(page) {
  return page > 1 ? `/page-${page}` : '';
}

/**
 * Construye el plan de archivos estáticos.
 *
 * @param {object} options
 * @param {Array<{segment: string, cfg: object, popularity?: number}>} [options.configs]
 *   configuraciones vistas, con su peso de tráfico relativo (por defecto 1).
 * @param {Array<{id: string, type: string}>} [options.defs] catálogos por defecto
 * @param {(cfg: object) => Array<{id: string, type: string}>} [options.defsFor]
 *   catálogos visibles para una configuración
 * @param {Array<{id: string, type: string}>} [options.titles] fichas a pregenerar
 * @param {number} [options.budget] archivos disponibles (por defecto, tope Free
 *   menos `BASE_RESERVE`)
 * @param {number} [options.catalogPages] páginas por catálogo por defecto
 * @param {number[]} [options.popularPages] páginas de las configs populares
 * @param {Record<string, number>} [options.caps] topes por tipo (fracción 0..1)
 * @returns {{files: Array<object>, byKind: Record<string, number>, skipped: number, budget: number, daily: number}}
 */
function buildPlan(options = {}) {
  const budget = Math.max(0, Number.isFinite(options.budget)
    ? options.budget
    : ASSET_FILE_LIMIT - BASE_RESERVE);
  const caps = { ...CAPS, ...(options.caps || {}) };
  const popularPages = Array.isArray(options.popularPages) && options.popularPages.length
    ? options.popularPages
    : DEFAULT_PAGES;
  const defaultPages = Math.max(1, Number(options.catalogPages) || 1);

  // ── 1. Catálogos por defecto (`/catalog/...`) ────────────────────────────
  const defaults = [];
  for (const def of options.defs || []) {
    for (let page = 1; page <= defaultPages; page++) {
      defaults.push({
        path: `/catalog/${def.type}/${def.id}${pageSuffix(page)}.json`,
        kind: 'catalog-default',
        type: def.type,
        id: def.id,
        page,
        weight: 1,
      });
    }
  }

  // ── 2. Fichas (`/meta/...`), compartidas por todas las configs ───────────
  const metas = [];
  const seenMetas = new Set();
  for (const title of options.titles || []) {
    if (!title || typeof title.id !== 'string' || !title.id) continue;
    const type = title.type === 'series' ? 'series' : 'movie';
    const key = `${type}/${title.id}`;
    if (seenMetas.has(key)) continue;
    seenMetas.add(key);
    metas.push({
      path: `/meta/${type}/${title.id}.json`,
      kind: 'meta',
      type,
      id: title.id,
      weight: Number(title.weight) > 0 ? Number(title.weight) : 1,
    });
  }

  // ── 3/4. Configuraciones: agrupar las idénticas y ordenar por popularidad ─
  const groups = new Map();
  const addGroup = (entry, counted) => {
    if (!entry || typeof entry.segment !== 'string' || !entry.segment) return;
    if (!isPlannableConfig(entry.cfg)) return;
    const key = configKey(entry.cfg);
    const popularity = Number(entry.popularity) > 0 ? Number(entry.popularity) : 1;
    const current = groups.get(key);
    if (current) {
      if (counted) current.popularity += popularity;
    } else {
      groups.set(key, { key, segment: entry.segment, cfg: entry.cfg, popularity, counted });
    }
  };
  for (const entry of options.configs || []) addGroup(entry, true);
  // Configs fijadas (p. ej. la del botón «Esenciales»): existen sin tráfico.
  for (const entry of options.pinned || []) addGroup(entry, false);

  const ranked = [...groups.values()].sort((a, b) => b.popularity - a.popularity);
  const seenSegments = new Set();
  const uniqueRanked = ranked.filter((group) => {
    if (seenSegments.has(group.segment)) return false;
    seenSegments.add(group.segment);
    return true;
  });

  const configured = [];
  const manifests = [];
  for (const group of uniqueRanked) {
    const defs = options.defsFor ? options.defsFor(group.cfg) : [];
    for (const def of defs) {
      for (const page of popularPages) {
        configured.push({
          path: `/${group.segment}/catalog/${def.type}/${def.id}${pageSuffix(page)}.json`,
          kind: page > 1 ? 'catalog-configured-page' : 'catalog-configured',
          segment: group.segment,
          type: def.type,
          id: def.id,
          page,
          weight: group.popularity,
        });
      }
    }
    manifests.push({
      path: `/${group.segment}/manifest.json`,
      kind: 'manifest',
      segment: group.segment,
      weight: group.popularity,
    });
  }

  // ── 5. Reparto del presupuesto y elección por ROI ────────────────────────
  const kinds = ['catalog-default', 'meta', 'catalog-configured', 'catalog-configured-page', 'manifest'];
  const pools = {
    'catalog-default': defaults,
    meta: metas,
    'catalog-configured': configured.filter((item) => item.kind === 'catalog-configured'),
    'catalog-configured-page': configured.filter((item) => item.kind === 'catalog-configured-page'),
    manifest: manifests,
  };
  // Cada tipo tiene su fracción del tráfico total. Las dos de catálogos
  // configurados (página 1 y páginas 2-3) son fracciones distintas y no se
  // solapan, así que la suma de todo el plan nunca pasa del 85 %.
  const SHARES = {
    'catalog-default': TRAFFIC.catalogDefault,
    meta: TRAFFIC.meta,
    'catalog-configured': TRAFFIC.catalogConfigured,
    'catalog-configured-page': TRAFFIC.catalogConfiguredPages,
    manifest: TRAFFIC.manifest,
  };

  // `daily` es la fracción del tráfico TOTAL que ahorra cada archivo:
  // share del tipo / cuántos archivos compiten por él. Es comparable entre
  // tipos, que es lo que hace falta para ordenar por ROI.
  const files = [];
  for (const kind of kinds) {
    const pool = pools[kind];
    if (!pool.length) continue;
    const share = SHARES[kind] || 0;
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0) || 1;
    for (const item of pool) {
      files.push({ ...item, daily: share * (item.weight / totalWeight) });
    }
  }

  const limit = Math.min(files.length, budget);
  const chosen = [];
  const used = {};
  const taken = new Set();
  const take = (file) => {
    if (taken.has(file.path)) return false;
    taken.add(file.path);
    used[file.kind] = (used[file.kind] || 0) + 1;
    chosen.push(file);
    return true;
  };

  // 1) Manifests primero: cuestan 1 archivo cada uno y evitan una invocación
  //    por sesión y usuario. Por ROI puro perderían contra un catálogo (que se
  //    pide más veces), pero sin manifest el addon no se puede ni abrir.
  for (const file of files) {
    if (file.kind !== 'manifest') continue;
    if (chosen.length >= limit) break;
    take(file);
  }

  // 2) El resto por ROI. En empate, orden de aparición: dos ejecuciones con
  //    los mismos datos escriben exactamente los mismos archivos.
  const rankedFiles = files
    .filter((file) => file.kind !== 'manifest')
    .map((file, index) => ({ file, index }))
    .sort((a, b) => (b.file.daily - a.file.daily) || (a.index - b.index))
    .map((entry) => entry.file);

  for (const file of rankedFiles) {
    if (chosen.length >= limit) break;
    const cap = Math.floor(budget * (caps[file.kind] ?? 1));
    if ((used[file.kind] || 0) >= cap) continue;
    take(file);
  }

  // Si los topes por tipo dejan presupuesto sin usar (pasa cuando hay pocas
  // configuraciones), se rellena con lo mejor que quede, sin tope.
  if (chosen.length < limit) {
    for (const file of rankedFiles) {
      if (chosen.length >= limit) break;
      if (taken.has(file.path)) continue;
      taken.add(file.path);
      used[file.kind] = (used[file.kind] || 0) + 1;
      chosen.push(file);
    }
  }

  const byKind = {};
  for (const file of chosen) byKind[file.kind] = (byKind[file.kind] || 0) + 1;
  const daily = chosen.reduce((sum, file) => sum + file.daily, 0);

  return { files: chosen, byKind, skipped: files.length - chosen.length, budget, daily };
}

module.exports = {
  ASSET_FILE_LIMIT,
  BASE_RESERVE,
  CAPS,
  DEFAULT_PAGES,
  TRAFFIC,
  buildPlan,
  configKey,
  isPlannableConfig,
  pageSuffix,
};
