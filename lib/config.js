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

// Invitación permanente al Discord de soporte. Si el enlace cambia, se
// puede sustituir mediante SUPPORT_URL sin tocar el código.
const DEFAULT_SUPPORT_URL = 'https://discord.gg/J6byqsRUfu';

// Página de Ko-fi para las donaciones (dentro de Ko-fi se paga con PayPal o
// tarjeta). Ko-fi no expone una API pública de lectura —su única superficie
// para desarrolladores es un webhook de confirmación—, así que la integración
// es el enlace a la página: no hace falta clave ni llamadas al servidor.
// Por defecto, la página del proyecto (https://ko-fi.com/hydratorrents); se
// cambia con KOFI_USERNAME y se oculta con KOFI_USERNAME=off.
const DEFAULT_KOFI_USERNAME = 'hydratorrents';
const KOFI_DISABLED = new Set(['off', 'none', 'disabled', 'false', 'no', '0']);
// Usuarios de Ko-fi: letras, números, punto, guion y guion bajo.
const KOFI_USERNAME_RE = /^[A-Za-z0-9._-]{1,50}$/;

/** Solo enlaces http(s) válidos; cualquier otra cosa cae al valor por defecto. */
function toHttpUrl(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    // «discord.gg/abc» sin esquema se entiende como https.
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * Usuario de Ko-fi normalizado a partir de KOFI_USERNAME.
 * Acepta «amiga», «@amiga», «ko-fi.com/amiga» y la URL completa; devuelve ''
 * cuando la donación está desactivada («off») o el valor no es de Ko-fi, para
 * que un error de tipeo no enlace a la página de otra persona.
 */
function toKofiUsername(value, fallback) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  if (KOFI_DISABLED.has(raw.toLowerCase())) return '';
  if (raw.includes('/') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
      // ko-fi.com debe ser el dominio, no un trozo de otro.
      if (!/(^|\.)ko-fi\.com$/i.test(url.hostname)) return '';
      const segment = url.pathname.split('/').filter(Boolean)[0] || '';
      return KOFI_USERNAME_RE.test(segment) ? segment : '';
    } catch (_) {
      return '';
    }
  }
  const username = raw.replace(/^@+/, '');
  return KOFI_USERNAME_RE.test(username) ? username : '';
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
  // Enlace de soporte (Discord) que muestran la portada y /configure.
  config.supportUrl = toHttpUrl(env.SUPPORT_URL, DEFAULT_SUPPORT_URL);

  // Donaciones vía Ko-fi (el pago se hace con PayPal o tarjeta en Ko-fi).
  // Con KOFI_USERNAME=off se ocultan el botón, la tarjeta y el enlace del pie.
  config.kofiUsername = toKofiUsername(env.KOFI_USERNAME, DEFAULT_KOFI_USERNAME);
  config.kofiUrl = config.kofiUsername ? `https://ko-fi.com/${config.kofiUsername}` : '';
  config.kofiEnabled = Boolean(config.kofiUrl);

  config.minVoteCount = toInt(env.TMDB_MIN_VOTE_COUNT, 500);
  config.cacheTtl = toInt(env.CACHE_TTL_SECONDS, 6 * 3600);
  config.httpTimeoutMs = toInt(env.HTTP_TIMEOUT_MS, 10000);
  config.port = toInt(env.PORT, 7000);

  // Proveedores de contenido (streams torrent, sin clave): Knaben, Torlock,
  // BlackHoleBay, Nyaa, YTS, EZTV, The RarBg, Índice BR y Torrentio ES/Latino.
  // STREAM_PROVIDERS="" o ausente = todos activos.
  config.streamProviders = String(env.STREAM_PROVIDERS || 'knaben,torlock,blackholebay,nyaa,yts,eztv,rarbg,torrentindexer,torrentioes')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  config.streamMaxResults = toInt(env.STREAM_MAX_RESULTS, 30);
  // Límite por proveedor: las búsquedas siguen en paralelo, pero un indexador
  // lento ya no bloquea toda la respuesta durante los 9–10 s anteriores.
  config.streamProviderTimeoutMs = Math.min(9000, Math.max(1000, toInt(env.STREAM_PROVIDER_TIMEOUT_MS, 6000)));
  config.streamFallbackTimeoutMs = Math.min(4000, Math.max(500, toInt(env.STREAM_FALLBACK_TIMEOUT_MS, 2500)));
  // Un indexador que agota el plazo varias veces seguidas se deja de consultar
  // durante este tiempo, para no esperarlo en cada petición. 0 = nunca pausar.
  config.streamProviderCooldownSeconds = Math.min(3600, Math.max(0, toInt(env.STREAM_PROVIDER_COOLDOWN_SECONDS, 300)));
  config.streamStaleSeconds = Math.max(0, toInt(env.STREAM_STALE_SECONDS, 6 * 3600));
  config.debridMaxChecks = Math.min(20, Math.max(1, toInt(env.DEBRID_MAX_CHECKS, 8)));
  config.debridMaxResults = Math.min(5, Math.max(1, toInt(env.DEBRID_MAX_RESULTS, 3)));
  config.debridTimeoutMs = Math.min(10000, Math.max(1000, toInt(env.DEBRID_TIMEOUT_MS, 4500)));
  // URL base de las APIs de Nyaa, YTS, EZTV y The RarBg. Son servicios
  // comunitarios que cambian de dominio de vez en cuando: se pueden redirigir
  // sin tocar código.
  config.nyaaApiUrl = String(env.NYAA_API_URL || 'https://nyaaapi.onrender.com').trim().replace(/\/+$/, '');
  config.ytsApiUrl = String(env.YTS_API_URL || 'https://movies-api.accel.li/api/v2').trim().replace(/\/+$/, '');
  config.eztvApiUrl = String(env.EZTV_API_URL || 'https://eztv1.xyz/api').trim().replace(/\/+$/, '');
  config.rarbgApiUrl = String(env.RARBG_API_URL || 'https://rarbg.ninjaproxy1.com').trim().replace(/\/+$/, '');
  // Índice español (Torrentio, fuentes pre-indexadas) y brasileño (torrent-indexer).
  config.torrentioEsUrl = String(env.TORRENTIO_ES_URL || 'https://torrentio.strem.fun').trim().replace(/\/+$/, '');
  // Índice brasileño (torrent-indexer de felipemarinho97): agrega los sitios
  // de torrents en portugués (comando, bludv, torrent-dos-filmes, starck,
  // rede-torrent, vaca-torrent). Endpoint /search salvo que el despliegue sea
  // uno propio con Meilisearch desactivado, en cuyo caso se usa
  // /indexers/comando_torrents. Ver TORRENT_INDEXER_PATH.
  config.torrentIndexerUrl = String(env.TORRENT_INDEXER_URL || 'https://torrent-indexer.darklyn.org')
    .trim().replace(/\/+$/, '');
  const indexerPath = String(env.TORRENT_INDEXER_PATH || '/search').trim();
  config.torrentIndexerPath = /^\/[A-Za-z0-9_\-/]*$/.test(indexerPath) ? indexerPath : '/search';
  // Clave gratuita y opcional de The RarBg: sube su límite de 30 a 60
  // peticiones por minuto (y de 10.000 a 50.000 al día).
  config.rarbgApiKey = String(env.RARBG_API_KEY || '').trim();

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
