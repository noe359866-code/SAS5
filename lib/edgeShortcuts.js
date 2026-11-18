'use strict';

/**
 * Atajos de borde: convertir los catálogos y las fichas de una configuración
 * en peticiones **gratis**, sin pregenerar un archivo por usuario.
 *
 * ## Por qué funciona
 *
 * El contenido de un catálogo depende solo de `lang`, `region` y del propio
 * `id` del catálogo (`lib/catalogs.js`: la selección de plataformas/estudios
 * decide QUÉ catálogos se ven, no qué devuelve cada uno). El de una ficha
 * depende solo de `lang` y `region` (`lib/meta.js`).
 *
 * Consecuencia: si un usuario no cambió ni el idioma ni la región del
 * despliegue, **sus** `/<cfg>/catalog/...` y `/<cfg>/meta/...` son
 * byte a byte los archivos `/catalog/...` y `/meta/...` que ya genera
 * `npm run prerender`.
 *
 * Una regla de `_redirects` lo resuelve en el borde:
 *
 *   /<cfg>/catalog/*   /catalog/:splat   301
 *   /<cfg>/meta/*      /meta/:splat      301
 *
 * `_redirects` se evalúa antes de los assets y del Worker, así que la
 * petición cuesta **0 invocaciones** (y la segunda vuelve a costar 0: o es un
 * archivo, o si el archivo no existe el Worker lo resuelve con la
 * configuración por defecto, que devuelve exactamente lo mismo).
 *
 * Eso convierte el ~62 % del tráfico (catálogos) y el ~15 % (fichas) en
 * gratis para todas las configuraciones que solo cambian proveedores,
 * filtros u orden — que es la mayoría de las que se instalan desde
 * `/configure`.
 *
 * ## Lo que NO toca
 *
 * - `/<cfg>/stream/...`: depende de los filtros y proveedores del usuario.
 * - `/<cfg>/manifest.json`: declara la selección, es de cada usuario.
 * - `/<cfg>/configure`: tiene que pintar su selección.
 * - Configuraciones con `debridId`: su segmento es privado y no se publica.
 *
 * Cloudflare limita las reglas dinámicas de `_redirects` a 100; cada
 * configuración usa 2, así que el tope práctico son ~49 configuraciones.
 */

/** Rutas que se pueden atajar (subárbol de la configuración). */
const SHORTCUT_TREES = ['catalog', 'meta'];

/** Tope de reglas dinámicas de Cloudflare (`_redirects`). */
const MAX_DYNAMIC_RULES = 100;

/** Un segmento de configuración es base64url: nada más entra en una regla. */
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,4096}$/;

/**
 * Normaliza los valores por defecto del despliegue.
 *
 * @param {{lang?: string, region?: string}} [defaults]
 * @returns {{lang: string, region: string}|null}
 */
function normalizeDefaults(defaults) {
  const lang = String((defaults && defaults.lang) || '').trim();
  const region = String((defaults && defaults.region) || '').trim().toUpperCase();
  return lang && region ? { lang, region } : null;
}

/**
 * ¿La configuración pide exactamente el contenido por defecto?
 *
 * Los campos ausentes cuentan como «el valor del despliegue», igual que hace
 * `resolveCatalog` / `buildMeta` al aplicar `cfg.lang || config.tmdbLanguage`.
 *
 * @param {object|null} cfg configuración normalizada (`decodeConfig`)
 * @param {{lang?: string, region?: string}} defaults del despliegue
 * @returns {boolean}
 */
function isShortcutConfig(cfg, defaults) {
  const base = normalizeDefaults(defaults);
  if (!cfg || typeof cfg !== 'object' || !base) return false;
  // Con debrid el segmento es por usuario: no se publica ni se ataja.
  if (cfg.debridId) return false;
  const lang = String(cfg.lang || base.lang);
  const region = String(cfg.region || base.region).toUpperCase();
  return lang === base.lang && region === base.region;
}

/**
 * Reglas de `_redirects` para una configuración atajable.
 *
 * @param {string} segment segmento base64url
 * @returns {Array<{from: string, to: string, status: number, priority: number, dynamic: boolean}>}
 */
function rulesFor(segment) {
  if (!SEGMENT_RE.test(String(segment || ''))) return [];
  return SHORTCUT_TREES.map((tree) => ({
    from: `/${segment}/${tree}/*`,
    to: `/${tree}/:splat`,
    status: 301,
    priority: 35,
    dynamic: true,
  }));
}

/**
 * Añade los atajos que quepan en el cupo de reglas dinámicas de Cloudflare.
 *
 * @param {object} args
 * @param {Array<{segment: string, cfg?: object}>} args.configs configuraciones vistas
 * @param {{lang?: string, region?: string}} args.defaults del despliegue
 * @param {number} [args.used] reglas dinámicas ya ocupadas
 * @param {number} [args.max] cupo total (por defecto 100)
 * @returns {{rules: Array<object>, segments: string[], skipped: number}}
 */
function buildShortcuts({ configs = [], defaults, used = 0, max = MAX_DYNAMIC_RULES } = {}) {
  const base = normalizeDefaults(defaults);
  const limit = Math.max(0, Number(max) || 0);
  let dynamicUsed = Math.max(0, Number(used) || 0);
  const rules = [];
  const segments = [];
  let skipped = 0;

  if (!base) return { rules, segments, skipped };

  for (const entry of configs || []) {
    const segment = entry && entry.segment;
    if (!segment || !SEGMENT_RE.test(segment)) continue;
    if (!isShortcutConfig(entry.cfg, base)) continue;
    const candidate = rulesFor(segment);
    if (dynamicUsed + candidate.length > limit) {
      skipped += 1;
      continue;
    }
    rules.push(...candidate);
    segments.push(segment);
    dynamicUsed += candidate.length;
  }

  return { rules, segments, skipped };
}

module.exports = {
  MAX_DYNAMIC_RULES,
  SHORTCUT_TREES,
  buildShortcuts,
  isShortcutConfig,
  normalizeDefaults,
  rulesFor,
};
