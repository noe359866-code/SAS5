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

const ENV_KEYS = [
  'TMDB_API_KEY', 'TMDB_ACCESS_TOKEN', 'OMDB_API_KEY',
  'WATCH_REGION', 'WATCH_REGION_FALLBACK',
  'TMDB_LANGUAGE', 'ADDON_NAME', 'ADDON_BASE_URL', 'SUPPORT_URL',
  'KOFI_USERNAME', 'TMDB_MIN_VOTE_COUNT', 'CACHE_TTL_SECONDS',
  'HTTP_TIMEOUT_MS', 'PORT', 'STREAM_PROVIDERS', 'STREAM_MAX_RESULTS',
  'STREAM_PROVIDER_TIMEOUT_MS', 'STREAM_FALLBACK_TIMEOUT_MS',
  'STREAM_PROVIDER_COOLDOWN_SECONDS', 'STREAM_STALE_SECONDS',
  'DEBRID_MAX_CHECKS', 'DEBRID_MAX_RESULTS', 'DEBRID_TIMEOUT_MS',
  'DEBRID_VALIDATE_TIMEOUT_MS', 'NYAA_API_URL', 'YTS_API_URL',
  'EZTV_API_URL', 'RARBG_API_URL', 'TORRENTIO_ES_URL',
  'TORRENT_INDEXER_URL', 'TORRENT_INDEXER_PATH', 'RARBG_API_KEY',
  'RESPONSE_CACHE_MB',
];

let lastFingerprint = null;

function envFingerprint(env) {
  let out = '';
  for (let i = 0; i < ENV_KEYS.length; i += 1) {
    const k = ENV_KEYS[i];
    const v = env[k];
    if (v !== undefined && v !== null && v !== '') {
      out += `${k}=${typeof v === 'string' ? v : String(v)};`;
    }
  }
  return out;
}

const responseCache = require('./responseCache');

const config = { reload };

function applyEnv(envLike) {
  const env = envLike || (typeof process !== 'undefined' && process.env ? process.env : {});
  const fp = envFingerprint(env);
  if (fp === lastFingerprint) return config;
  lastFingerprint = fp;

  config.tmdbApiKey = String(env.TMDB_API_KEY || '').trim();
  config.tmdbAccessToken = String(env.TMDB_ACCESS_TOKEN || '').trim();
  config.omdbApiKey = String(env.OMDB_API_KEY || '').trim();

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

  // Proveedores de contenido: Knaben, Torlock, BlackHoleBay, Nyaa, YTS, EZTV,
  // The RarBg, Índice BR (torrents), Torrentio ES/Latino y Español ES/LAT
  // (hispanos vía indexadores) y SpinFlix y Embed69 (streams directos).
  //
  // Embed69 va el último y NO se activa solo cuando la lista por defecto está
  // vacía: exige resolver un PoW (CPU) y en el plan Free eso no cabe. Para
  // usarlo hay que nombrarlo: STREAM_PROVIDERS="…,embed69" o EMBED69_POW.
  // STREAM_PROVIDERS="" o ausente = todos los demás activos.
  config.streamProviders = String(env.STREAM_PROVIDERS || 'knaben,torlock,blackholebay,nyaa,yts,eztv,rarbg,torrentindexer,torrentioes,espanol,spinflix,fanpelis,embed69,videoapi')
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
  // Plazo aparte para validar la clave al conectar: es una acción interactiva
  // (un solo clic) y los 4,5 s del modo stream provocaban «no se pudo validar»
  // por un simple response lento de TorBox/Premiumize.
  config.debridValidateTimeoutMs = Math.min(20000, Math.max(3000, toInt(env.DEBRID_VALIDATE_TIMEOUT_MS, 9000)));
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
  // SpinFlix (spinoff.link/pelis): API JSON que lo alimenta y su proxy HLS
  // (vimeos.net exige Referer; el proxy lo añade y reescribe las playlists).
  config.spinflixUrl = String(env.SPINFLIX_URL || 'https://lamoviebot.tvymas.workers.dev').trim().replace(/\/+$/, '');
  // Vacío = proxy HLS propio del addon (recomendado: pone el Referer en cada
  // segmento y no depende de terceros). Si se define, se usa ese proxy externo
  // tal cual (p. ej. https://spinoff.link/pelis/proxy.php), útil como rescate.
  config.spinflixProxyUrl = String(env.SPINFLIX_PROXY_URL || '').trim();
  // Hosts extra que el proxy propio puede alcanzar (además de vimeos).
  config.hlsProxyHosts = String(env.HLS_PROXY_HOSTS || '').trim();
  // Embed69: base y control del PoW. `off` desactiva el proveedor; `prewarm`
  // permite resolver el PoW una vez y servir el resto de la caché (o desde la
  // KV con `EMBED69_POW`), que es la única forma sensata en el plan Free.
  config.embed69Url = String(env.EMBED69_URL || 'https://embed69.org').trim().replace(/\/+$/, '');
  config.embed69Pow = String(env.EMBED69_POW || 'auto').trim().toLowerCase();
  config.embed69Prewarm = String(env.EMBED69_PREWARM || '').trim();
  // VideoAPI: API pública por TMDB, sin PoW ni clave (2 GET por título). Se
  // puede desactivar con VIDEOAPI=off sin tocar el resto de proveedores.
  config.videoapiUrl = String(env.VIDEOAPI_URL || 'https://videoapi.la').trim().replace(/\/+$/, '');
  config.videoapiEnabled = String(env.VIDEOAPI || 'on').trim().toLowerCase() !== 'off';
  // Fanpelis: API JSON pública (3 GET, sin PoW) que entrega embeds de
  // vimeos.net; el .m3u8 sale del propio embed, como en SpinFlix. Se puede
  // desactivar con FANPELIS=off.
  config.fanpelisUrl = String(env.FANPELIS_URL || 'https://fanpelis.to').trim().replace(/\/+$/, '');
  config.fanpelisEnabled = String(env.FANPELIS || 'on').trim().toLowerCase() !== 'off';
  const indexerPath = String(env.TORRENT_INDEXER_PATH || '/search').trim();
  config.torrentIndexerPath = /^\/[A-Za-z0-9_\-/]*$/.test(indexerPath) ? indexerPath : '/search';
  // Clave gratuita y opcional de The RarBg: sube su límite de 30 a 60
  // peticiones por minuto (y de 10.000 a 50.000 al día).
  config.rarbgApiKey = String(env.RARBG_API_KEY || '').trim();

  // Caché de respuestas en la memoria del isolate. Es la única caché que
  // funciona en `*.workers.dev`, donde la Cache API de Cloudflare no hace
  // nada (docs: «any Cache API operations … in *.workers.dev deployments will
  // have no impact»). Presupuesto en MB; 0 la desactiva.
  config.responseCacheMb = Math.min(96, Math.max(0, toInt(env.RESPONSE_CACHE_MB, 24)));
  responseCache.configure(config.responseCacheMb);

  config.tmdbConfigured = Boolean(config.tmdbApiKey || config.tmdbAccessToken);
  config.omdbConfigured = Boolean(config.omdbApiKey);
  return config;
}

/** Re-aplica la configuración desde un objeto de entorno (Workers/tests). */
function reload(envLike) {
  return applyEnv(envLike);
}

// Inicialización con el entorno actual (Node o lo que haya)
applyEnv(null);

module.exports = config;
