'use strict';

/**
 * Configuración de usuario del addon (Stremio "configurable").
 * Se codifica en base64url como prefijo de la URL del manifest:
 *   https://host/<base64url(json)>/manifest.json
 * Así cada usuario instala su propio manifest con su selección.
 *
 * Esquema:
 * {
 *   lang:      'es' | 'es-MX' | 'en' | 'pt-BR' | ...   (idioma de TMDB)
 *   region:    'NI' | 'MX' | 'US' | 'ES' | 'AR' | ...  (país de TMDB / JustWatch)
 *   platforms: ['netflix', ...]   // vacío = ninguna plataforma
 *   studios:   ['marvel', ...]    // vacío = ningún estudio
 *   base:      ['tendencias', 'populares', 'top', 'tvmaze_hoy']
 *   streams:   ['knaben', ...]    // proveedores de streams activos
 *   hide:      ['cam', '3d', ...] // tipos de stream ocultos (lib/streamFilters.js)
 *   badges:    ['resolution', ...] // grupos de etiquetas activos (null = todos)
 *   sort:      'seeders' | 'quality' | 'size'
 *   maxSize:   0..1000            // GB por torrent; 0 = sin límite
 *   debridId:       identificador opaco de la credencial debrid cifrada
 *   debridProvider: proveedor conectado (solo para mostrarlo en /configure)
 * }
 *
 * Los campos nuevos son opcionales: una URL instalada antes de que
 * existieran se sigue leyendo igual (sin filtros, orden por seeders).
 */

const { FILTER_KEYS, SORT_KEYS, DEFAULT_SORT, normalizeMaxSize } = require('./streamFilters');
const { BADGE_KEYS } = require('./badges');

// Idioma de TMDB: títulos, sinopsis y pósters. Los códigos son los que
// acepta el parámetro `language` de la API. `label` es el nombre en el propio
// idioma y `name` el nombre en español (el que se busca en /configure).
const LANG_OPTIONS = [
  { code: 'es', label: 'Español (España)', name: 'Español de España' },
  { code: 'es-MX', label: 'Español (Latinoamérica)', name: 'Español latino' },
  { code: 'en', label: 'English', name: 'Inglés' },
  { code: 'pt-BR', label: 'Português (Brasil)', name: 'Portugués de Brasil' },
  { code: 'pt-PT', label: 'Português (Portugal)', name: 'Portugués de Portugal' },
  { code: 'fr', label: 'Français', name: 'Francés' },
  { code: 'de', label: 'Deutsch', name: 'Alemán' },
  { code: 'it', label: 'Italiano', name: 'Italiano' },
  { code: 'ca', label: 'Català', name: 'Catalán' },
  { code: 'nl', label: 'Nederlands', name: 'Neerlandés (holandés)' },
  { code: 'pl', label: 'Polski', name: 'Polaco' },
  { code: 'ru', label: 'Русский', name: 'Ruso' },
  { code: 'tr', label: 'Türkçe', name: 'Turco' },
  { code: 'ar', label: 'العربية', name: 'Árabe' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi' },
  { code: 'ja', label: '日本語', name: 'Japonés' },
  { code: 'ko', label: '한국어', name: 'Coreano' },
  { code: 'zh', label: '中文', name: 'Chino' },
];

// País de TMDB: decide qué hay en cada plataforma (JustWatch) y los
// estrenos de cine. Se agrupan por zona para el selector de /configure.
const REGION_GROUPS = ['Latinoamérica', 'Norteamérica', 'Europa', 'Asia y Oceanía'];
const REGION_OPTIONS = [
  ['Latinoamérica', [
    ['AR', 'Argentina'], ['BO', 'Bolivia'], ['BR', 'Brasil'], ['CL', 'Chile'], ['CO', 'Colombia'],
    ['CR', 'Costa Rica'], ['EC', 'Ecuador'], ['SV', 'El Salvador'], ['GT', 'Guatemala'],
    ['HN', 'Honduras'], ['MX', 'México'], ['NI', 'Nicaragua'], ['PA', 'Panamá'], ['PY', 'Paraguay'],
    ['PE', 'Perú'], ['DO', 'Rep. Dominicana'], ['UY', 'Uruguay'], ['VE', 'Venezuela'],
  ]],
  ['Norteamérica', [
    ['CA', 'Canadá'], ['US', 'Estados Unidos'],
  ]],
  ['Europa', [
    ['DE', 'Alemania'], ['AT', 'Austria'], ['BE', 'Bélgica'], ['DK', 'Dinamarca'], ['ES', 'España'],
    ['FI', 'Finlandia'], ['FR', 'Francia'], ['IE', 'Irlanda'], ['IT', 'Italia'], ['NO', 'Noruega'],
    ['NL', 'Países Bajos'], ['PL', 'Polonia'], ['PT', 'Portugal'], ['GB', 'Reino Unido'],
    ['SE', 'Suecia'], ['CH', 'Suiza'], ['TR', 'Turquía'],
  ]],
  ['Asia y Oceanía', [
    ['AU', 'Australia'], ['KR', 'Corea del Sur'], ['PH', 'Filipinas'], ['IN', 'India'],
    ['ID', 'Indonesia'], ['JP', 'Japón'], ['NZ', 'Nueva Zelanda'],
  ]],
].flatMap(([group, countries]) => countries.map(([code, label]) => ({ code, label, group })));

const DEFAULT_LANG = 'es';
const DEFAULT_REGION = 'NI';

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
 * OJO: no bajar de ~1 KB. Una config "completa" (todas las plataformas,
 * estudios, catálogos base y proveedores marcados, que es justo lo que genera
 * /configure cuando marcas todo) ronda los 1000 caracteres. Con el límite
 * original (512) esas URLs se rechazaban con 404 `invalid_config` y Stremio
 * se quedaba sin manifest → sin streams.
 */
const MAX_CONFIG_SEGMENT = 4096;
const CONFIG_SEGMENT_RE = new RegExp(`^[A-Za-z0-9_-]{8,${MAX_CONFIG_SEGMENT}}$`);
const DEBRID_ID_RE = /^[A-Za-z0-9_-]{32}$/;
const DEBRID_PROVIDER_KEYS = ['torbox', 'easydebrid', 'premiumize', 'realdebrid'];

function defaultConfig(env) {
  const region = String((env && env.WATCH_REGION) || 'NI').trim().toUpperCase();
  const lang = String((env && env.TMDB_LANGUAGE) || 'es').trim();
  return {
    lang: LANG_OPTIONS.some((o) => o.code === lang) ? lang : DEFAULT_LANG,
    region: REGION_OPTIONS.some((o) => o.code === region) ? region : DEFAULT_REGION,
    platforms: null, // null = todas (comportamiento por defecto)
    studios: null,   // null = todos
    base: null,      // null = todos los catálogos base
    streams: null,   // null = todos los proveedores de contenido (streams)
    hide: [],        // ningún tipo de stream oculto
    badges: null,    // null = todas las etiquetas técnicas activas
    sort: DEFAULT_SORT,
    maxSize: 0,      // sin límite de tamaño
    debridId: null,  // referencia opaca; el token se guarda cifrado en servidor
    debridProvider: null,
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
  const lang = LANG_OPTIONS.some((o) => o.code === raw.lang) ? raw.lang : DEFAULT_LANG;
  const region = REGION_OPTIONS.some((o) => o.code === String(raw.region || '').toUpperCase())
    ? String(raw.region).toUpperCase()
    : DEFAULT_REGION;
  const platforms = pickArray(raw.platforms, platformKeys);
  const studios = pickArray(raw.studios, studioKeys);
  const base = pickArray(raw.base, BASE_KEYS);
  const streams = streamKeys ? pickArray(raw.streams, streamKeys) : null;
  // Filtros de streams: ausentes = no se oculta nada y se ordena por seeders.
  const hide = pickArray(raw.hide, FILTER_KEYS) || [];
  // Ausente = todas las etiquetas; [] = ninguna (elección válida).
  const badges = raw.badges === undefined ? null : pickArray(raw.badges, BADGE_KEYS) || [];
  const sort = SORT_KEYS.includes(raw.sort) ? raw.sort : DEFAULT_SORT;
  const maxSize = normalizeMaxSize(raw.maxSize);
  const debridId = typeof raw.debridId === 'string' && DEBRID_ID_RE.test(raw.debridId) ? raw.debridId : null;
  const debridProvider = debridId && DEBRID_PROVIDER_KEYS.includes(raw.debridProvider) ? raw.debridProvider : null;
  return { lang, region, platforms, studios, base, streams, hide, badges, sort, maxSize, debridId, debridProvider, isDefault: false };
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
    // Los valores por defecto no viajan en la URL.
    hide: Array.isArray(cfg.hide) && cfg.hide.length ? cfg.hide : undefined,
    // Solo viaja si se desactivó algún grupo (la lista completa es el defecto).
    badges: Array.isArray(cfg.badges) && cfg.badges.length < BADGE_KEYS.length ? cfg.badges : undefined,
    sort: cfg.sort && cfg.sort !== DEFAULT_SORT ? cfg.sort : undefined,
    maxSize: cfg.maxSize > 0 ? cfg.maxSize : undefined,
    debridId: typeof cfg.debridId === 'string' && DEBRID_ID_RE.test(cfg.debridId) ? cfg.debridId : undefined,
    debridProvider: typeof cfg.debridId === 'string' && DEBRID_ID_RE.test(cfg.debridId) && DEBRID_PROVIDER_KEYS.includes(cfg.debridProvider) ? cfg.debridProvider : undefined,
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
      (raw.streams !== undefined && !Array.isArray(raw.streams)) ||
      (raw.hide !== undefined && !Array.isArray(raw.hide)) ||
      (raw.badges !== undefined && !Array.isArray(raw.badges)) ||
      (raw.debridId !== undefined && (typeof raw.debridId !== 'string' || !DEBRID_ID_RE.test(raw.debridId))) ||
      (raw.debridProvider !== undefined && (!DEBRID_PROVIDER_KEYS.includes(raw.debridProvider) || typeof raw.debridId !== 'string' || !DEBRID_ID_RE.test(raw.debridId)))
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
  DEBRID_ID_RE,
  DEBRID_PROVIDER_KEYS,
  LANG_OPTIONS,
  REGION_GROUPS,
  REGION_OPTIONS,
  DEFAULT_LANG,
  DEFAULT_REGION,
  BASE_OPTIONS,
  BASE_KEYS,
  defaultConfig,
  encodeConfig,
  decodeConfig,
  normalizeConfig,
};
