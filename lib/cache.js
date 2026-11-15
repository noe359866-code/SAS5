'use strict';

/**
 * Caché LRU por instancia, con TTL, stale-while-revalidate y coalescencia
 * de peticiones concurrentes. En serverless cada isolate mantiene su propia
 * caché; los Workers también pueden usar Cache API en el borde para lo público.
 */

const MAX_ENTRIES = 8000;
const store = new Map();
const inFlight = new Map();
const metrics = { hits: 0, misses: 0, staleHits: 0, evictions: 0, coalesced: 0 };

function touch(key, entry) {
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

function get(key) {
  const entry = store.get(key);
  if (!entry) {
    metrics.misses++;
    return undefined;
  }
  const now = Date.now();
  if (now > entry.expires) {
    if (now > entry.staleUntil) store.delete(key);
    metrics.misses++;
    return undefined;
  }
  metrics.hits++;
  return touch(key, entry);
}

/** Obtiene una entrada vencida pero aún dentro de su ventana de gracia. */
function getStale(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  const now = Date.now();
  if (now > entry.staleUntil) {
    store.delete(key);
    return undefined;
  }
  if (now <= entry.expires) return touch(key, entry);
  metrics.staleHits++;
  return touch(key, entry);
}

let opsSinceSweep = 0;
function prune(now = Date.now()) {
  opsSinceSweep++;
  if (store.size >= MAX_ENTRIES || opsSinceSweep >= 250) {
    opsSinceSweep = 0;
    for (const [key, entry] of store) {
      if (now > entry.staleUntil) store.delete(key);
    }
  }
  while (store.size >= MAX_ENTRIES) {
    store.delete(store.keys().next().value);
    metrics.evictions++;
  }
}

function set(key, value, ttlSeconds, { staleSeconds = 0 } = {}) {
  store.delete(key);
  prune();
  const ttl = Math.max(0, Number(ttlSeconds) || 0);
  const grace = Math.max(0, Number(staleSeconds) || 0);
  const expires = Date.now() + ttl * 1000;
  store.set(key, { value, expires, staleUntil: expires + grace * 1000 });
}

function del(key) {
  return store.delete(key);
}

function deletePrefix(prefix) {
  let deleted = 0;
  for (const key of store.keys()) {
    if (String(key).startsWith(prefix)) {
      store.delete(key);
      deleted++;
    }
  }
  return deleted;
}

/** Una sola carga por clave, aunque varias peticiones lleguen a la vez. */
function coalesce(key, loader) {
  if (inFlight.has(key)) {
    metrics.coalesced++;
    return inFlight.get(key);
  }
  const promise = Promise.resolve().then(loader);
  inFlight.set(key, promise);
  const clear = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}

function stats() {
  return {
    entries: store.size,
    maxEntries: MAX_ENTRIES,
    inFlight: inFlight.size,
    ...metrics,
  };
}

module.exports = { get, getStale, set, del, deletePrefix, coalesce, stats, MAX_ENTRIES };
