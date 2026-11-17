'use strict';

/**
 * Genera el bloque de redirecciones de `public/_redirects`.
 *
 * ## El problema que resuelve
 *
 * En `*.workers.dev` el Worker recibe **todas** las rutas que no son un
 * archivo de `public/`. Y de esas, dos se piden muchísimo más de lo que parece:
 *
 *  - `/watch` (sin barra final). Es el enlace que llevan la barra de navegación
 *    y el botón «Ver ahora»: sólo `public/watch/index.html` existe, así que
 *    `/watch` ejecuta el Worker y este responde un 404. Cada clic = 1 invocación
 *    de las 100.000/día… para servir un error.
 *  - `/configure/` y `/manifest.json/` con barra final, que tampoco existen
 *    como archivo.
 *
 * ## La solución
 *
 * `_redirects` se evalúa **antes** de los static assets y **antes** del
 * Worker, así que una redirección ahí cuesta 0 invocaciones. Cloudflare admite
 * 2.000 redirecciones estáticas + 100 dinámicas por despliegue; aquí solo se
 * usan estáticas (una por ruta conocida) para no gastar el cupo dinámico.
 *
 * El límite es 2.100 reglas: si algún día el planificador propone más, se
 * recortan por prioridad (`buildRedirects` ordena de más a menos importante) y
 * se avisa, en vez de romper el despliegue: las reglas que sobran las sigue
 * atendiendo el Worker, que es el comportamiento de siempre.
 */

/** Tope de Cloudflare: 2.000 estáticas + 100 dinámicas. */
const MAX_REDIRECTS = 2100;

/** Rutas fijas que conviene resolver en el borde (0 invocaciones). */
const STATIC_ROUTES = [
  { from: '/watch', to: '/watch/', priority: 100 },
  { from: '/configure/', to: '/configure', priority: 95 },
  { from: '/manifest.json/', to: '/manifest.json', priority: 90 },
  { from: '/watch/index.html', to: '/watch/', priority: 80 },
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
 * @param {Array<{segment: string}>} [options.segments] segmentos `<cfg>` conocidos
 * @param {number} [options.max] tope de reglas (por defecto, `MAX_REDIRECTS`)
 * @returns {{rules: Array<{from: string, to: string, status: number}>, dropped: number}}
 */
function buildRedirects(options = {}) {
  const max = Math.max(0, Number(options.max) || MAX_REDIRECTS);
  const rules = [];

  for (const route of STATIC_ROUTES) {
    rules.push({ from: route.from, to: route.to, status: 301, priority: route.priority });
  }

  // Manifest de cada configuración conocida: abrir el addon deja de invocar el
  // Worker si su manifest está pregenerado (se comprueba con `fs` en el script,
  // aquí solo se propone la ruta).
  for (const segment of new Set((options.segments || []).filter((s) => typeof s === 'string' && s))) {
    rules.push({
      from: `/${segment}/manifest.json/`,
      to: `/${segment}/manifest.json`,
      status: 301,
      priority: 50,
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
  MAX_REDIRECTS,
  STATIC_ROUTES,
  buildRedirects,
  renderRedirects,
};
