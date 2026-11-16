'use strict';

/**
 * Cálculo de la auditoría de escala (parte pura, sin red).
 *
 * Vive aquí —y no dentro de scripts/scale-audit.mjs— para que los tests
 * puedan requerirlo desde CommonJS. El script ESM lo importa y añade las
 * sondas HTTP contra el despliegue real.
 *
 * La clave del invento: el Worker marca sus respuestas con
 * `X-Catalogos-Runtime: worker`. Lo que llega sin esa marca no ejecutó
 * código, así que no consumió ninguna de las 100.000 invocaciones/día que
 * incluye el plan gratuito de Cloudflare Workers.
 */

const FREE_DAILY_INVOCATIONS = 100_000; // Workers Free, por cuenta y por día

// Reparto típico de tráfico de un addon de Stremio + reproductor web
// (mismo que documenta docs/escala-plan-free.md).
const DEFAULT_MIX = {
  catalog: 0.62,
  meta: 0.15,
  stream: 0.07,
  streamDebrid: 0.03,
  web: 0.13,
};

/**
 * De dónde salió una respuesta:
 *  - `static`        → archivo de public/ (0 invocaciones)
 *  - `cdn`           → Cache Rule del CDN (0 invocaciones)
 *  - `worker`        → ejecutó el handler en vivo
 *  - `worker-memory` → ejecutó el Worker, pero respondió la memoria del isolate
 *  - `worker-edge`   → ejecutó el Worker, pero respondió la Cache API del borde
 *  - `error`         → fallo: no se cuenta como gratis
 *
 * @param {string} path ruta pedida
 * @param {{status: number, headers: {get(name: string): string|null}}} response
 * @param {boolean} [markerWorks] el Worker emite la marca (verificado en /healthz)
 */
/** Rutas que el prerender escribe en public/ (static assets de verdad). */
const STATIC_PREFIXES = /^\/(catalog|meta|assets|watch)\//;
const STATIC_EXACT = new Set(['/', '/configure', '/manifest.json', '/internal/branding.json']);

function classify(path, response, markerWorks = true) {
  if (!response || response.status >= 400) return 'error';
  if (markerWorks && !response.headers.get('x-catalogos-runtime')) {
    // Sin marca del Worker no se ejecutó código. Si la ruta es de las que
    // pregeneramos, es un static asset; si no, solo puede ser el CDN.
    return STATIC_PREFIXES.test(path) || STATIC_EXACT.has(path) ? 'static' : 'cdn';
  }
  const cache = response.headers.get('x-catalogos-cache');
  if (cache === 'memory' || cache === 'stale') return 'worker-memory';
  if (cache === 'edge') return 'worker-edge';
  return 'worker';
}

/**
 * Proyecta las invocaciones/día de un reparto de tráfico.
 * @param {object} args
 * @param {Record<string, string>} args.servedBy grupo → cómo se sirve
 * @param {number} [args.total] peticiones/día a proyectar
 * @param {Record<string, number>} [args.mix]
 */
function estimate({ servedBy = {}, total = 500_000, mix = DEFAULT_MIX } = {}) {
  const rows = Object.keys(mix).map((group) => {
    const share = mix[group] || 0;
    const requests = Math.round(total * share);
    const how = servedBy[group] || 'unknown';
    const free = how === 'static' || how === 'cdn';
    return { group, share, requests, servedBy: how, invocations: free ? 0 : requests };
  });
  const invocations = rows.reduce((sum, row) => sum + row.invocations, 0);
  return {
    total,
    invocations,
    budget: FREE_DAILY_INVOCATIONS,
    headroom: FREE_DAILY_INVOCATIONS - invocations,
    usage: invocations / FREE_DAILY_INVOCATIONS,
    ok: invocations <= FREE_DAILY_INVOCATIONS,
    rows,
  };
}

/** Recomendaciones concretas según lo medido en el despliegue. */
function advise({ servedBy = {}, host = '', estimate: est } = {}) {
  const tips = [];
  const runsWorker = (group) => String(servedBy[group] || '').startsWith('worker');

  if (/\.workers\.dev$/i.test(String(host))) {
    tips.push(
      'Estás en *.workers.dev: allí la Cache API de Cloudflare no funciona (los docs lo dicen: «any Cache ' +
      'API operations … in *.workers.dev deployments will have no impact») y no se pueden crear Cache Rules. ' +
      'Tu único tráfico gratis son los static assets de public/. Conecta un dominio propio (gratis) y crea ' +
      'la Cache Rule de docs/escala-plan-free.md: es lo que permite llegar a 500.000 peticiones/día.'
    );
  }
  if (runsWorker('catalog')) {
    tips.push(
      'Los catálogos (62 % del tráfico) ejecutan el Worker. Con una Cache Rule del CDN el borde los sirve ' +
      'sin invocarlo; sin dominio propio, instala el manifest general (sin configuración) para que usen los ' +
      'JSON pregenerados de public/catalog/.'
    );
  }
  if (runsWorker('meta')) {
    tips.push(
      'Las fichas (15 %) no llegan como static asset: ejecuta `npm run prerender` —que ahora también escribe ' +
      'public/meta/— y despliega, o añade /meta/ a la Cache Rule.'
    );
  }
  if (runsWorker('web')) {
    tips.push(
      'La web no está pregenerada: define PUBLIC_ORIGIN y ejecuta `npm run build:web` para escribir ' +
      'index.html y configure/index.html en public/ (0 invocaciones).'
    );
  }
  if (est && !est.ok) {
    tips.push(
      `Con este reparto harían falta ~${est.invocations.toLocaleString('es')} invocaciones/día, por encima de ` +
      'las 100.000 del plan gratuito. Aplica los puntos anteriores o pasa a Workers Paid ($5/mes).'
    );
  }
  return tips;
}

module.exports = { classify, estimate, advise, DEFAULT_MIX, FREE_DAILY_INVOCATIONS };
