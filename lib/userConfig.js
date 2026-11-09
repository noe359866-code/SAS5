'use strict';

/**
 * Configuración de usuario del addon (Stremio "configurable").
 * Se codifica en base64url como prefijo de la URL del manifest:
 *   https://host/<base64url(json)>/manifest.json
 * Así cada usuario instala su propio manifest con su selección.
 *
 * Esquema:
 * {
 *   lang:      'es' | 'es-MX' | 'en' | 'pt-BR' | ...
 *   region:    'NI' | 'MX' | 'US' | 'ES' | 'AR' | ...  (watch_region JustWatch)
 *   platforms: ['netflix', ...]   // vacío = ninguna plataforma
 *   studios:   ['marvel', ...]    // vacío = ningún estudio
 *   base:      ['tendencias', 'populares', 'top', 'tvmaze_hoy']
 * }
 */

const LANG_OPTIONS = [
  { code: 'es', label: 'Español' },
  { code: 'es-MX', label: 'Español (México)' },
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
];

const REGION_OPTIONS = [
  { code: 'NI', label: 'Nicaragua', flag: '🇳🇮' },
  { code: 'MX', label: 'México', flag: '🇲🇽' },
  { code: 'US', label: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'ES', label: 'España', flag: '🇪🇸' },
  { code: 'AR', label: 'Argentina', flag: '🇦🇷' },
  { code: 'CO', label: 'Colombia', flag: '🇨🇴' },
  { code: 'CL', label: 'Chile', flag: '🇨🇱' },
  { code: 'PE', label: 'Perú', flag: '🇵🇪' },
  { code: 'UY', label: 'Uruguay', flag: '🇺🇾' },
  { code: 'EC', label: 'Ecuador', flag: '🇪🇨' },
  { code: 'VE', label: 'Venezuela', flag: '🇻🇪' },
  { code: 'CR', label: 'Costa Rica', flag: '🇨🇷' },
  { code: 'PA', label: 'Panamá', flag: '🇵🇦' },
  { code: 'DO', label: 'Rep. Dominicana', flag: '🇩🇴' },
  { code: 'GT', label: 'Guatemala', flag: '🇬🇹' },
  { code: 'HN', label: 'Honduras', flag: '🇭🇳' },
];

const BASE_OPTIONS = [
  { key: 'tendencias', label: 'Tendencias' },
  { key: 'populares', label: 'Populares' },
  { key: 'top', label: 'Top Valoradas' },
  { key: 'tvmaze_hoy', label: 'Series · En TV hoy (TVMaze)' },
  { key: 'estrenos', label: 'Películas · En cines' },
  { key: 'proximos', label: 'Películas · Próximos estrenos' },
  { key: 'en_emision', label: 'Series · En emisión' },
  { key: 'anime', label: 'Anime · Popular' },
  { key: 'generos_series', label: 'Series · Por género y miniseries' },
];

const BASE_KEYS = BASE_OPTIONS.map((o) => o.key);
const RESERVED_SEGMENTS = new Set(['assets', 'catalog', 'meta', 'stream', 'configure', 'healthz', 'internal', 'manifest.json', 'favicon.ico']);

/**
 * Longitud máxima del segmento base64url de config.
 *
 * OJO: no bajar de ~1 KB. Una config "completa" (16 plataformas + 9 estudios
 * + 9 catálogos base + 3 proveedores de streams, que es justo lo que genera
 * /configure cuando marcas todo) ocupa ~596 caracteres. Con el límite
 * anterior (512) esas URLs se rechazaban con 404 `invalid_config` y Stremio
 * se quedaba sin manifest → sin streams.
 */
const MAX_CONFIG_SEGMENT = 4096;
const CONFIG_SEGMENT_RE = new RegExp(`^[A-Za-z0-9_-]{8,${MAX_CONFIG_SEGMENT}}$`);

function defaultConfig(env) {
  const region = String((env && env.WATCH_REGION) || 'NI').trim().toUpperCase();
  const lang = String((env && env.TMDB_LANGUAGE) || 'es').trim();
  return {
    lang: LANG_OPTIONS.some((o) => o.code === lang) ? lang : 'es',
    region: REGION_OPTIONS.some((o) => o.code === region) ? region : 'NI',
    platforms: null, // null = todas (comportamiento por defecto)
    studios: null,   // null = todos
    base: null,      // null = todos los catálogos base
    streams: null,   // null = todos los proveedores de contenido (streams)
    isDefault: true,
  };
}

function pickArray(value, allowedKeys) {
  if (!Array.isArray(value)) return null; // ausente → valor por defecto
  const set = new Set(allowedKeys);
  return [...new Set(value.filter((v) => typeof v === 'string' && set.has(v)))];
}

/**
 * Normaliza y valida un objeto config crudo.
 * Lanza Error si está corrupto.
 */
function normalizeConfig(raw, platformKeys, studioKeys, streamKeys) {
  if (!raw || typeof raw !== 'object') throw new Error('config inválida');
  const lang = LANG_OPTIONS.some((o) => o.code === raw.lang) ? raw.lang : 'es';
  const region = REGION_OPTIONS.some((o) => o.code === String(raw.region || '').toUpperCase())
    ? String(raw.region).toUpperCase()
    : 'NI';
  const platforms = pickArray(raw.platforms, platformKeys);
  const studios = pickArray(raw.studios, studioKeys);
  const base = pickArray(raw.base, BASE_KEYS);
  const streams = streamKeys ? pickArray(raw.streams, streamKeys) : null;
  return { lang, region, platforms, studios, base, streams, isDefault: false };
}

/** Serializa config → base64url (solo ASCII, JSON compacto). */
function encodeConfig(cfg) {
  const slim = {
    lang: cfg.lang,
    region: cfg.region,
    platforms: cfg.platforms === null || cfg.platforms === undefined ? undefined : cfg.platforms,
    studios: cfg.studios === null || cfg.studios === undefined ? undefined : cfg.studios,
    base: cfg.base === null || cfg.base === undefined ? undefined : cfg.base,
    streams: cfg.streams === null || cfg.streams === undefined ? undefined : cfg.streams,
  };
  const json = JSON.stringify(slim);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parsea base64url → config normalizada o null si no es válida. */
function decodeConfig(segment, platformKeys, studioKeys, streamKeys) {
  try {
    if (!segment || RESERVED_SEGMENTS.has(segment)) return null;
    if (!CONFIG_SEGMENT_RE.test(segment)) return null;
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
    const json = atob(pad);
    const raw = JSON.parse(json);
    const cfg = normalizeConfig(raw, platformKeys, studioKeys, streamKeys);
    if (
      (raw.platforms !== undefined && !Array.isArray(raw.platforms)) ||
      (raw.studios !== undefined && !Array.isArray(raw.studios)) ||
      (raw.base !== undefined && !Array.isArray(raw.base)) ||
      (raw.streams !== undefined && !Array.isArray(raw.streams))
    ) {
      return null;
    }
    return cfg;
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAX_CONFIG_SEGMENT,
  CONFIG_SEGMENT_RE,
  LANG_OPTIONS,
  REGION_OPTIONS,
  BASE_OPTIONS,
  BASE_KEYS,
  defaultConfig,
  encodeConfig,
  decodeConfig,
  normalizeConfig,
};
