'use strict';

const requestScope = require('./requestScope');

/**
 * Caché de respuestas HTTP en la memoria del isolate.
 *
 * ¿Por qué existe si ya hay Cache API (`caches.default`)? Porque la Cache API
 * **no hace nada en `*.workers.dev`**: los docs de Cloudflare lo dicen tal
 * cual («any Cache API operations in … any *.workers.dev deployments will have
 * no impact»). En un despliegue sin dominio propio, `cache.match()` nunca
 * devuelve nada y `cache.put()` no guarda nada, así que cada petición repetida
 * volvía a ejecutar el fan-out completo (TMDB, OMDB, 10 indexadores
 * de streams…) gastando CPU, subpeticiones y cupo de APIs externas con cuota
 * diaria. Esta caché funciona en cualquier entorno: la memoria del isolate.
 *
 * No sustituye a la Cache API ni a las Cache Rules del CDN —esas responden
 * **sin ejecutar el Worker** (0 invocaciones) y son la vía para escalar de
 * verdad—, pero es la red de seguridad cuando el borde no cachea: convierte
 * una petición de 5 ms y 25 subpeticiones en una de ~0,1 ms y 0 subpeticiones.
 *
 * Características:
 *  - Presupuesto por **bytes** (no por número de entradas): las respuestas
 *    van de 2 KB (una ficha) a ~200 KB (un catálogo), así que contar entradas
 *    no protege los 128 MB del isolate.
 *  - TTL y ventana *stale* derivados del `Cache-Control` que ya publicamos,
 *    para que la vida en memoria no contradiga lo que prometemos al cliente.
 *  - *Single-flight*: si llegan 50 peticiones a la vez del mismo recurso frío,
 *    se ejecuta una sola carga y las 50 esperan el mismo resultado.
 *  - Respeta `no-store`/`private`: esas respuestas no se guardan nunca (son
 *    que llevan enlaces directos personalizados).
 */

const MAX_ENTRY_BYTES = 1.5 * 1024 * 1024; // una respuesta por encima no se guarda
const DEFAULT_BUDGET_BYTES = 24 * 1024 * 1024; // ~18 % de los 128 MB del isolate

let budgetBytes = DEFAULT_BUDGET_BYTES;
const store = new Map(); // clave → { value, bytes, expires, staleUntil }
const globalInFlight = new Map(); // clave → promesa de carga en curso
const metrics = { hits: 0, misses: 0, staleHits: 0, evictions: 0, coalesced: 0, stored: 0, skippedBytes: 0 };

/** Tamaño aproximado de una respuesta JSON/HTML (el JSON es casi todo ASCII). */
function estimateBytes(body) {
  return typeof body === 'string' ? body.length : 0;
}

/**
 * Ajusta el presupuesto. Se llama desde config.js en cada recarga de entorno.
 * @param {number} megabytes 0 desactiva la caché; se limita a 96 MB.
 */
function configure(megabytes) {
  const mb = Number(megabytes);
  if (!Number.isFinite(mb) || mb <= 0) {
    budgetBytes = 0;
  } else {
    budgetBytes = Math.min(96, Math.max(1, Math.round(mb))) * 1024 * 1024;
  }
  if (budgetBytes === 0) reset();
}

/** Vacía la caché (tests y recarga de configuración). Mantiene el presupuesto. */
function reset() {
  store.clear();
  globalInFlight.clear();
  for (const key of Object.keys(metrics)) metrics[key] = 0;
}

function now() {
  return Date.now();
}

/** Deja sitio para `bytes` bytes expulsando la entrada usada hace más tiempo. */
function makeRoom(bytes) {
  if (bytes > budgetBytes) return false;
  let used = 0;
  for (const entry of store.values()) used += entry.bytes;
  while (used + bytes > budgetBytes && store.size) {
    const oldest = store.keys().next().value;
    const entry = store.get(oldest);
    store.delete(oldest);
    used -= entry.bytes;
    metrics.evictions++;
  }
  return true;
}

/**
 * Guarda una respuesta. `ttlSeconds` es el tiempo fresco y `staleSeconds` lo
 * que puede servir caducada mientras se recalcula (stale-while-revalidate).
 */
function set(key, value, ttlSeconds, { staleSeconds = 0 } = {}) {
  if (!budgetBytes || !key || typeof value !== 'string') return false;
  const bytes = estimateBytes(value);
  if (!bytes || bytes > MAX_ENTRY_BYTES || bytes > budgetBytes) {
    metrics.skippedBytes++;
    return false;
  }
  if (!makeRoom(bytes)) {
    metrics.skippedBytes++;
    return false;
  }
  const ts = now();
  const ttl = Math.max(1, Number(ttlSeconds) || 0);
  // Ventana de gracia: lo que la respuesta promete con `stale-while-revalidate`
  // (hasta 24 h), acotado por memoria. Con el tope anterior de 6 h, un catálogo
  // con `stale-while-revalidate=86400` pasaba a "frío" a las 6 h y volvía a
  // ejecutar el handler (TMDB, indexadores) en lugar de servirse al instante.
  const stale = Math.max(0, Math.min(24 * 3600, Number(staleSeconds) || 0));
  store.delete(key); // reinsertar: la Map conserva el orden de inserción (LRU)
  store.set(key, {
    value,
    bytes,
    expires: ts + ttl * 1000,
    staleUntil: ts + (ttl + stale) * 1000,
  });
  metrics.stored++;
  return true;
}

/** Devuelve la respuesta si sigue fresca; si no, undefined. */
function get(key) {
  const entry = store.get(key);
  if (!entry) {
    metrics.misses++;
    return undefined;
  }
  const ts = now();
  if (ts > entry.expires) {
    if (ts > entry.staleUntil) store.delete(key);
    metrics.misses++;
    return undefined;
  }
  // Reinsertar para marcarla como la usada más recientemente.
  store.delete(key);
  store.set(key, entry);
  metrics.hits++;
  return entry.value;
}

/** Devuelve la respuesta aunque esté caducada, si aún está en su gracia. */
function getStale(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  const ts = now();
  if (ts > entry.staleUntil) {
    store.delete(key);
    return undefined;
  }
  store.delete(key);
  store.set(key, entry);
  if (ts > entry.expires) metrics.staleHits++;
  else metrics.hits++;
  return entry.value;
}

/**
 * Single-flight: si ya hay una carga en curso para la clave, devuelve esa
 * promesa en vez de lanzar otra.
 */
function coalesce(key, loader) {
  const inFlight = requestScope.flights('responseCache', globalInFlight);
  const pending = inFlight.get(key);
  if (pending) {
    metrics.coalesced++;
    return pending;
  }
  const promise = (async () => loader())().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function stats() {
  let bytes = 0;
  for (const entry of store.values()) bytes += entry.bytes;
  return {
    enabled: budgetBytes > 0,
    budgetBytes,
    bytes,
    entries: store.size,
    inFlight: requestScope.flights('responseCache', globalInFlight).size,
    ...metrics,
  };
}

module.exports = {
  configure,
  set,
  get,
  getStale,
  coalesce,
  stats,
  reset,
  MAX_ENTRY_BYTES,
  DEFAULT_BUDGET_BYTES,
};
