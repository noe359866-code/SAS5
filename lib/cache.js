'use strict';

/**
 * Caché en memoria con TTL. En serverless cada instancia calienta su propia
 * caché; suficiente para reducir llamadas repetidas a TMDB/OMDB/Watchmode.
 */

const MAX_ENTRIES = 500;
const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlSeconds) {
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.expires) store.delete(k);
    }
    if (store.size >= MAX_ENTRIES) store.clear();
  }
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

function stats() {
  return { entries: store.size, maxEntries: MAX_ENTRIES };
}

module.exports = { get, set, stats };
