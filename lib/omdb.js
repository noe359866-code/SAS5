'use strict';

/**
 * Cliente OMDB (valoraciones IMDB / Rotten Tomatoes / Metacritic).
 * Requiere OMDB_API_KEY. Sin clave, devuelve null y el addon sigue funcionando.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson } = require('./http');

/** Ficha completa OMDB por IMDb id. Caché 24h. */
async function getByImdbId(imdbId) {
  if (!config.omdbConfigured) return null;
  if (!imdbId || !imdbId.startsWith('tt')) return null;

  const url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(
    config.omdbApiKey
  )}`;
  const cached = cache.get(url);
  if (cached) return cached;

  try {
    const data = await fetchJson(url, { timeoutMs: 8000 });
    if (!data || data.Response === 'False') {
      cache.set(url, null, 3600);
      return null;
    }
    cache.set(url, data, 24 * 3600);
    return data;
  } catch (err) {
    console.error('[OMDB] Error para', imdbId, '->', err.message);
    return null;
  }
}

/** Línea legible: "⭐ IMDB 8.7 · 🍅 Rotten Tomatoes 95% · Ⓜ️ Metacritic 78" */
function ratingsSummary(data) {
  if (!data) return null;
  const parts = [];
  if (data.imdbRating && data.imdbRating !== 'N/A') parts.push(`⭐ IMDB ${data.imdbRating}/10`);
  const rt = Array.isArray(data.Ratings)
    ? data.Ratings.find((r) => r.Source === 'Rotten Tomatoes')
    : null;
  if (rt && rt.Value) parts.push(`🍅 Rotten Tomatoes ${rt.Value}`);
  if (data.Metascore && data.Metascore !== 'N/A') parts.push(`Ⓜ️ Metacritic ${data.Metascore}/100`);
  return parts.length ? parts.join('  ·  ') : null;
}

module.exports = { getByImdbId, ratingsSummary };
