'use strict';

/** Configuración mínima compartida por la API Node y Cloudflare Worker. */
try {
  if (typeof process !== 'undefined' && process.cwd) require('dotenv').config();
} catch { /* Workers no necesita dotenv. */ }

function integer(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const config = { reload };
function reload(envLike) {
  const env = envLike || (typeof process !== 'undefined' ? process.env || {} : {});
  config.addonName = String(env.ADDON_NAME || 'RamdonLatam Canales').trim();
  config.addonBaseUrl = String(env.ADDON_BASE_URL || '').trim().replace(/\/+$/, '');
  config.cacheTtl = integer(env.CACHE_TTL_SECONDS, 21600, 60, 86400);
  config.port = integer(env.PORT, 7000, 1, 65535);
  return config;
}

reload(null);
module.exports = config;
