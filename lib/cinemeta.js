'use strict';

const cache = require('./cache');
const { fetchJson } = require('./http');

/** Metadatos por IMDb (incluye la numeración de episodios que usa Stremio). */
async function lookup(type, imdbId, timeoutMs) {
  if (!/^tt\d+$/.test(imdbId || '')) return null;
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  return cache.coalesce(`load:${url}`, async () => {
    try {
      const data = await fetchJson(url, { timeoutMs });
      const meta = data?.meta || null;
      cache.set(url, meta, meta ? 24 * 3600 : 300);
      return meta;
    } catch (_) { return null; }
  });
}

module.exports = { lookup };
