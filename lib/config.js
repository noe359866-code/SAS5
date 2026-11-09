'use strict';

/**
 * Configuración central del addon.
 * - Local / Vercel: lee process.env (+ .env en local vía dotenv, si existe).
 * - Cloudflare Workers: el fetch handler llama a `config.reload(env)` en cada
 *   petición para aplicar los vars/secrets del Worker (TMDB_API_KEY, etc.).
 *
 * Nunca pongas claves reales en el código.
 */

// dotenv solo existe en Node; en Workers se omite sin romper.
try {
  if (typeof process !== 'undefined' && process.cwd) {
    require('dotenv').config();
  }
} catch (_) { /* sin dotenv: seguimos con process.env */ }

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = { reload };

function applyEnv(envLike) {
  const env = envLike || (typeof process !== 'undefined' && process.env ? process.env : {});

  config.tmdbApiKey = String(env.TMDB_API_KEY || '').trim();
  config.tmdbAccessToken = String(env.TMDB_ACCESS_TOKEN || '').trim();
  config.omdbApiKey = String(env.OMDB_API_KEY || '').trim();
  config.watchmodeApiKey = String(env.WATCHMODE_API_KEY || '').trim();

  // Región para proveedores de streaming (JustWatch/TMDB): NI, MX, ES, US, AR...
  config.watchRegion = String(env.WATCH_REGION || 'NI').trim().toUpperCase();

  config.addonName = String(env.ADDON_NAME || 'Catálogos+').trim();
  config.addonBaseUrl = String(env.ADDON_BASE_URL || '').trim().replace(/\/+$/, '');

  config.minVoteCount = toInt(env.TMDB_MIN_VOTE_COUNT, 500);
  config.cacheTtl = toInt(env.CACHE_TTL_SECONDS, 6 * 3600);
  config.httpTimeoutMs = toInt(env.HTTP_TIMEOUT_MS, 10000);
  config.port = toInt(env.PORT, 7000);

  config.tmdbConfigured = Boolean(config.tmdbApiKey || config.tmdbAccessToken);
  config.omdbConfigured = Boolean(config.omdbApiKey);
  config.watchmodeConfigured = Boolean(config.watchmodeApiKey);

  return config;
}

/** Re-aplica la configuración desde un objeto de entorno (Workers/tests). */
function reload(envLike) {
  return applyEnv(envLike);
}

// Inicialización con el entorno actual (Node o lo que haya)
applyEnv(null);

module.exports = config;
