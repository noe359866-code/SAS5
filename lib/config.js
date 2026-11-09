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

  // TVDB (TheTVDB v4): fichas de series/películas por IMDb id
  config.tvdbApiKey = String(env.TVDB_API_KEY || '').trim();
  config.tvdbPin = String(env.TVDB_PIN || '').trim(); // PIN de suscriptor (opcional)

  // Región para proveedores de streaming (JustWatch/TMDB): NI, MX, ES, US, AR...
  config.watchRegion = String(env.WATCH_REGION || 'NI').trim().toUpperCase();
  // Cadena de respaldo para catálogos de plataforma cuando la región del
  // usuario no tiene resultados JustWatch (NI≈0): probamos MX y US.
  config.watchRegionFallback = String(env.WATCH_REGION_FALLBACK || 'MX,US')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  config.tmdbLanguage = String(env.TMDB_LANGUAGE || 'es').trim();

  config.addonName = String(env.ADDON_NAME || 'Catálogos+').trim();
  config.addonBaseUrl = String(env.ADDON_BASE_URL || '').trim().replace(/\/+$/, '');

  config.minVoteCount = toInt(env.TMDB_MIN_VOTE_COUNT, 500);
  config.cacheTtl = toInt(env.CACHE_TTL_SECONDS, 6 * 3600);
  config.httpTimeoutMs = toInt(env.HTTP_TIMEOUT_MS, 10000);
  config.port = toInt(env.PORT, 7000);

  config.tmdbConfigured = Boolean(config.tmdbApiKey || config.tmdbAccessToken);
  config.omdbConfigured = Boolean(config.omdbApiKey);
  config.watchmodeConfigured = Boolean(config.watchmodeApiKey);
  config.tvdbConfigured = Boolean(config.tvdbApiKey);

  return config;
}

/** Re-aplica la configuración desde un objeto de entorno (Workers/tests). */
function reload(envLike) {
  return applyEnv(envLike);
}

// Inicialización con el entorno actual (Node o lo que haya)
applyEnv(null);

module.exports = config;
