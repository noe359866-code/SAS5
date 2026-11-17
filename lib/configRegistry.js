'use strict';

/**
 * Registro de configuraciones vistas, para saber qué pregenerar.
 *
 * En `*.workers.dev` los catálogos de un usuario viven en `/<cfg>/catalog/...`
 * y no son estáticos: cada visita ejecuta el Worker. Pero los usuarios se
 * reparten en muy pocas configuraciones (idioma + región + plataformas), y las
 * repetidas se pueden servir como archivo.
 *
 * Este módulo recuerda, por isolate, cuántas veces ha visto cada segmento y
 * con qué configuración, y lo publica en `/internal/cache.json`. El script de
 * pregeneración (`npm run prerender`) lee ese informe y escribe los JSON.
 *
 * Privacidad: solo se guarda el segmento base64url (que ya viaja en la URL del
 * manifest) y la configuración normalizada. Nunca credenciales: las configs
 * con `debridId` **no se registran** (su segmento es por usuario y su tráfico
 * es privado).
 */

/** Cuántos segmentos distintos se recuerdan (memoria del isolate: 128 MB). */
const MAX_SEGMENTS = 500;

/** Ventana de popularidad: lo que no se ha visto en 7 días se olvida. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

const seen = new Map(); // segment → { cfg, hits, first, last }

let totalHits = 0;

function prune(now) {
  if (seen.size <= MAX_SEGMENTS) return;
  // Primero lo más antiguo: es un aproximado de «lo menos popular».
  const entries = [...seen.entries()].sort((a, b) => a[1].last - b[1].last);
  const excess = seen.size - MAX_SEGMENTS;
  for (let i = 0; i < excess; i++) {
    seen.delete(entries[i][0]);
    totalHits -= entries[i][1].hits;
  }
}

/**
 * Anota una visita a una configuración.
 *
 * @param {string} segment segmento base64url de la URL
 * @param {object|null} cfg configuración normalizada (`decodeConfig`)
 * @param {number} [now] instante (para tests)
 */
function note(segment, cfg, now = Date.now()) {
  if (typeof segment !== 'string' || !segment || !cfg) return;
  // Con debrid el segmento es por usuario: no se comparte ni se pregenera.
  if (cfg.debridId) return;
  const current = seen.get(segment);
  if (current) {
    current.hits += 1;
    current.last = now;
  } else {
    seen.set(segment, { cfg: slimConfig(cfg), hits: 1, first: now, last: now });
  }
  totalHits += 1;
  prune(now);
}

/** Solo lo que cambia el contenido de catálogos/fichas. */
function slimConfig(cfg) {
  return {
    lang: cfg.lang,
    region: cfg.region,
    platforms: cfg.platforms === undefined ? null : cfg.platforms,
    studios: cfg.studios === undefined ? null : cfg.studios,
    base: cfg.base === undefined ? null : cfg.base,
  };
}

/**
 * Informe para `/internal/cache.json` y para `npm run prerender --from-url`.
 *
 * `popularity` es normalizada (la más vista vale 1) para que el planificador
 * no dependa del volumen absoluto: un despliegue pequeño y uno grande con el
 * mismo reparto producen el mismo plan.
 *
 * @param {object} [options]
 * @param {number} [options.limit] cuántos segmentos devolver
 * @param {number} [options.now]
 * @returns {{configs: Array<{segment: string, cfg: object, hits: number, popularity: number}>, totalSegments: number, totalHits: number}}
 */
function report(options = {}) {
  const now = Number(options.now) || Date.now();
  const limit = Math.max(1, Number(options.limit) || 100);
  const alive = [...seen.entries()]
    .filter(([, entry]) => now - entry.last <= STALE_MS)
    .sort((a, b) => b[1].hits - a[1].hits)
    .slice(0, limit);
  const top = alive.length ? alive[0][1].hits : 1;
  return {
    configs: alive.map(([segment, entry]) => ({
      segment,
      cfg: entry.cfg,
      hits: entry.hits,
      popularity: Math.round((entry.hits / top) * 1000) / 1000,
    })),
    totalSegments: seen.size,
    totalHits,
  };
}

/** Vacía el registro (tests). */
function reset() {
  seen.clear();
  totalHits = 0;
}

module.exports = {
  MAX_SEGMENTS,
  STALE_MS,
  note,
  report,
  reset,
  slimConfig,
};
