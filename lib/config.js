'use strict';

/**
 * Configuración central del addon.
 * Todas las claves se leen de variables de entorno (.env en local,
 * Environment Variables en Vercel). Nunca pongas claves reales en el código.
 */

require('dotenv').config();

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  // TMDB: clave v3 (TMDB_API_KEY) o token v4 (TMDB_ACCESS_TOKEN). Basta con una.
  tmdbApiKey: (process.env.TMDB_API_KEY || '').trim(),
  tmdbAccessToken: (process.env.TMDB_ACCESS_TOKEN || '').trim(),

  // OMDB: valoraciones IMDB / Rotten Tomatoes / Metacritic
  omdbApiKey: (process.env.OMDB_API_KEY || '').trim(),

  // Watchmode: disponibilidad en plataformas en streaming
  watchmodeApiKey: (process.env.WATCHMODE_API_KEY || '').trim(),

  // Región para proveedores de streaming (TMDB/Watchmode). NI=Nicaragua, MX, ES, US...
  watchRegion: (process.env.WATCH_REGION || 'NI').trim().toUpperCase(),

  // Nombre visible y URL pública del addon (para el logo en el manifest)
  addonName: (process.env.ADDON_NAME || 'Catálogos+').trim(),
  addonBaseUrl: (process.env.ADDON_BASE_URL || '').trim().replace(/\/+$/, ''),

  // Mínimo de votos en TMDB para el catálogo "Top Valoradas"
  minVoteCount: toInt(process.env.TMDB_MIN_VOTE_COUNT, 500),

  // TTL general de caché en segundos (6 horas por defecto)
  cacheTtl: toInt(process.env.CACHE_TTL_SECONDS, 6 * 3600),

  httpTimeoutMs: toInt(process.env.HTTP_TIMEOUT_MS, 10000),
  port: toInt(process.env.PORT, 7000),
};

config.tmdbConfigured = Boolean(config.tmdbApiKey || config.tmdbAccessToken);
config.omdbConfigured = Boolean(config.omdbApiKey);
config.watchmodeConfigured = Boolean(config.watchmodeApiKey);

module.exports = config;
