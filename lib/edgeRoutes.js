'use strict';


/** Tope de Cloudflare: 2.000 estáticas + 100 dinámicas. */
const MAX_REDIRECTS = 2100;

/**
 * Reglas con un parámetro (`:path`): cubren todas las configuraciones con una
 * sola línea. Cloudflare limita las dinámicas a 100, así que se usan con
 * cuentagotas.
 */
const DYNAMIC_ROUTES = [
  { from: '/:path/manifest.json/', to: '/:path/manifest.json', priority: 60 },
];

/** Rutas fijas que conviene resolver en el borde (0 invocaciones). */
const STATIC_ROUTES = [
  { from: '/configure/', to: '/configure', priority: 95 },
  { from: '/manifest.json/', to: '/manifest.json', priority: 90 },
  { from: '/configure/index.html', to: '/configure', priority: 75 },
  { from: '/index.html', to: '/', priority: 70 },
];

/**
 * Rutas de configurador que Stremio abre con `/<cfg>/configure`.
 *
 * Ahí sí hace falta el Worker: el configurador tiene que pintar la selección
 * del usuario, que viaja en el propio `<cfg>`. No se redirige porque un
 * configurador en blanco sería peor que una invocación.
 */

/**
 * Construye la lista de redirecciones.
 *
 * @param {object} [options]
 * @param {Array<{segment: string, cfg: {region?: string}}>} [options.configs]
 *   configuraciones conocidas (para el configurador por región)
 * @param {Set<string>} [options.regions] regiones válidas (REGION_OPTIONS)
 * @param {number} [options.max] tope de reglas (por defecto, `MAX_REDIRECTS`)
 * @returns {{rules: Array<{from: string, to: string, status: number}>, dropped: number}}
 */
function buildRedirects(options = {}) {
  const max = Math.max(0, Number(options.max) || MAX_REDIRECTS);
  const rules = [];

  for (const route of STATIC_ROUTES) {
    rules.push({ from: route.from, to: route.to, status: 301, priority: route.priority });
  }

  // Una sola regla DINÁMICA cubre TODAS las configuraciones a la vez: mueve la
  // barra final a una ruta concreta conservando el parámetro.
  //   /<cfg>/manifest.json/  →  /:path/manifest.json
  // Con esto no hace falta una regla por usuario (el cupo de Cloudflare es de
  // 2.000 estáticas + 100 dinámicas) y cualquier configuración nueva queda
  // cubierta desde el primer día.
  for (const route of DYNAMIC_ROUTES) {
    rules.push({ from: route.from, to: route.to, status: 301, priority: route.priority });
  }

  // Configurador: el botón «Configurar» de Stremio abre /<cfg>/configure, que
  // el Worker tiene que renderizar entero. Esta regla lo manda a la página
  // pregenerada DE SU REGIÓN (región + selección por defecto), que es un
  // archivo estático: 0 invocaciones.
  //
  // Hace falta una regla por configuración (no una dinámica) porque el destino
  // no puede descartar el parámetro: Cloudflare no permite recortar un
  // placeholder dentro del destino, y la región no está en la URL, está
  // codificada dentro del segmento.
  // La lista de regiones válidas vive en `userConfig`; se acepta cualquier
  // código ISO de dos letras como red de seguridad si no se pasa.
  const validRegions = options.regions instanceof Set ? options.regions : null;
  const entries = options.configs
    || (options.segments || []).map((segment) => ({ segment, cfg: {} }));
  for (const entry of entries) {
    const segment = entry && entry.segment;
    const region = entry && entry.cfg && entry.cfg.region;
    if (!segment || !region || !/^[A-Z]{2}$/.test(region)) continue;
    if (validRegions && !validRegions.has(region)) continue;
    rules.push({
      from: `/${segment}/configure`,
      to: `/configure/r/${region}`,
      status: 302,
      priority: 40,
    });
  }

  rules.sort((a, b) => (b.priority - a.priority) || a.from.localeCompare(b.from));
  const kept = rules.slice(0, max);
  return {
    rules: kept.map(({ from, to, status }) => ({ from, to, status })),
    dropped: rules.length - kept.length,
  };
}

/**
 * Serializa el bloque para `public/_redirects`.
 *
 * Conserva las reglas manuales que no gestiona este módulo (las que no están
 * entre los marcadores), para que nadie pierda lo que añadió a mano.
 *
 * @param {Array<{from: string, to: string, status?: number}>} rules
 * @param {string} [existing] contenido actual de `_redirects`
 * @returns {string}
 */
function renderRedirects(rules, existing = '') {
  const START = '# >>> plan:static (generado por scripts/prerender-catalogs.mjs --from-url) >>>';
  const END = '# <<< plan:static <<<';
  const manual = [];
  let inside = false;
  for (const line of String(existing).split('\n')) {
    if (line.trim() === START) { inside = true; continue; }
    if (line.trim() === END) { inside = false; continue; }
    if (!inside) manual.push(line);
  }
  // Limpia líneas sobrantes del bloque anterior.
  while (manual.length && manual[manual.length - 1].trim() === '') manual.pop();

  const body = rules.map((rule) => `${rule.from} ${rule.to} ${rule.status || 301}`);
  // Sin un blanco de separación antes del marcador, la última regla manual
  // quedaría pegada a él.
  const head = manual.length ? [...manual, ''] : [];
  return [
    ...head,
    START,
    '# Rutas que el Worker respondía con una invocación (y a veces con un 404).',
    '# _redirects se evalúa antes de los assets y del Worker: 0 invocaciones.',
    '# Se regenera en cada despliegue; no edites dentro del bloque.',
    ...body,
    END,
    '',
  ].join('\n');
}

module.exports = {
  DYNAMIC_ROUTES,
  MAX_REDIRECTS,
  STATIC_ROUTES,
  buildRedirects,
  renderRedirects,
};
