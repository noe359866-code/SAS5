'use strict';

/**
 * Configuración de usuario del addon (Stremio "configurable").
 * Se codifica en base64url como prefijo de la URL del manifest:
 *   https://host/<base64url(json)>/manifest.json
 * Así cada usuario instala su propio manifest con su selección.
 *
 * Esquema:
 * {
 *   lang:      'es-MX'                     (español latino fijo)
 *   region:    'NI' | 'MX' | 'US' | 'ES' | 'AR' | ...  (país de TMDB / JustWatch)
 *   platforms: ['netflix', ...]   // vacío = ninguna plataforma
 *   studios:   ['marvel', ...]    // vacío = ningún estudio
 *   base:      ['tendencias', 'populares', 'top', 'tvmaze_hoy']
 *   streams:   ['fanpelis', ...]  // fuentes directas activas
 *   badges:    ['resolution', ...] // grupos de metadatos activos (null = todos)
 * }
 *
 * Los campos nuevos son opcionales: una URL instalada antes de que
 * existieran se sigue leyendo igual.
 */

const { FILTER_KEYS } = require('./streamFilters');
const { BADGE_KEYS } = require('./badges');

// Idioma de TMDB: títulos, sinopsis y pósters. Los códigos son los que
// acepta el parámetro `language` de la API. `label` es el nombre en el propio
// idioma y `name` el nombre en español (el que se busca en /configure).
const LANG_OPTIONS = [
  { code: 'es-MX', label: 'Español latino', name: 'Español latino' },
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

const DEFAULT_LANG = 'es-MX';
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
  // Al final para no mover los índices del códec de configs ya instaladas.
  { key: 'deportes', label: 'TV · Canales de deportes en vivo' },
  { key: 'live_entretenimiento', label: 'TV · Entretenimiento en vivo' },
  { key: 'live_cine', label: 'TV · Cine en vivo' },
  { key: 'live_infantil', label: 'TV · Infantil en vivo' },
  { key: 'live_anime', label: 'TV · Anime en vivo' },
  { key: 'live_musica', label: 'TV · Música en vivo' },
  { key: 'live_noticias', label: 'TV · Noticias en vivo' },
  { key: 'live_documentales', label: 'TV · Documentales en vivo' },
  { key: 'live_espana', label: 'TV · España en vivo' },
  { key: 'live_mexico', label: 'TV · México en vivo' },
  { key: 'live_argentina', label: 'TV · Argentina en vivo' },
  { key: 'live_colombia', label: 'TV · Colombia en vivo' },
  { key: 'live_chile', label: 'TV · Chile en vivo' },
  { key: 'live_peru', label: 'TV · Perú en vivo' },
  { key: 'live_religion', label: 'TV · Religión en vivo' },
  { key: 'live_bolivia', label: 'TV · Bolivia en vivo' },
  { key: 'live_costarica', label: 'TV · Costa Rica en vivo' },
  { key: 'live_dominicana', label: 'TV · Rep. Dominicana en vivo' },
  { key: 'live_ecuador', label: 'TV · Ecuador en vivo' },
  { key: 'live_elsalvador', label: 'TV · El Salvador en vivo' },
  { key: 'live_guatemala', label: 'TV · Guatemala en vivo' },
  { key: 'live_honduras', label: 'TV · Honduras en vivo' },
  { key: 'live_nicaragua', label: 'TV · Nicaragua en vivo' },
  { key: 'live_paraguay', label: 'TV · Paraguay en vivo' },
  { key: 'live_puertorico', label: 'TV · Puerto Rico en vivo' },
  { key: 'live_venezuela', label: 'TV · Venezuela en vivo' },
];

const BASE_KEYS = BASE_OPTIONS.map((o) => o.key);
/**
 * Catálogos recomendados para un perfil equilibrado en /configure (~38 filas
 * frente a las 121 del manifest completo: ~3× menos peticiones por sesión).
 */
const RECOMMENDED_PLATFORMS = [
  'netflix', 'prime', 'disney', 'max', 'appletv', 'paramount', 'crunchyroll', 'vix',
];
const RECOMMENDED_STUDIOS = [
  'marvel', 'pixar', 'warner', 'universal', 'a24', 'ghibli',
];
const RECOMMENDED_BASE = [
  'tendencias', 'populares', 'top', 'estrenos', 'en_emision', 'anime', 'deportes',
  'live_entretenimiento', 'live_cine', 'live_infantil', 'live_anime',
  'live_musica', 'live_noticias', 'live_documentales',
];
const RESERVED_SEGMENTS = new Set(['assets', 'catalog', 'meta', 'stream', 'configure', 'healthz', 'internal', 'manifest.json', 'favicon.ico', 'site.webmanifest']);

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

function defaultConfig(env) {
  const region = String((env && env.WATCH_REGION) || 'NI').trim().toUpperCase();
  const lang = DEFAULT_LANG;
  return {
    lang: LANG_OPTIONS.some((o) => o.code === lang) ? lang : DEFAULT_LANG,
    region: REGION_OPTIONS.some((o) => o.code === region) ? region : DEFAULT_REGION,
    platforms: null, // null = todas (comportamiento por defecto)
    studios: null,   // null = todos
    base: null,      // null = todos los catálogos base
    streams: null,   // null = todos los proveedores de contenido (streams)
    hide: [],        // ningún tipo de stream oculto
    badges: null,    // null = todas las etiquetas técnicas activas
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
/**
 * El idioma editorial del addon es siempre español latino. Los códigos de
 * idioma que ya viajen en URLs antiguas se normalizan al valor fijo.
 */
function defaultLang() {
  return DEFAULT_LANG;
}

function normalizeConfig(raw, platformKeys, studioKeys, streamKeys) {
  if (!raw || typeof raw !== 'object') throw new Error('config inválida');
  const lang = LANG_OPTIONS.some((o) => o.code === raw.lang) ? raw.lang : defaultLang();
  const region = REGION_OPTIONS.some((o) => o.code === String(raw.region || '').toUpperCase())
    ? String(raw.region).toUpperCase()
    : DEFAULT_REGION;
  const platforms = pickArray(raw.platforms, platformKeys);
  const studios = pickArray(raw.studios, studioKeys);
  const base = pickArray(raw.base, BASE_KEYS);
  let streams = streamKeys ? pickArray(raw.streams, streamKeys) : null;
  // Una selección antigua que solo contenía fuentes retiradas vuelve al
  // conjunto directo predeterminado; [] explícito sí mantiene todo apagado.
  if (Array.isArray(raw.streams) && raw.streams.length && streams && streams.length === 0) streams = null;
  const hide = pickArray(raw.hide, FILTER_KEYS) || [];
  // Ausente = todas las etiquetas; [] = ninguna (elección válida).
  const badges = raw.badges === undefined ? null : pickArray(raw.badges, BADGE_KEYS) || [];
  return { lang, region, platforms, studios, base, streams, hide, badges, isDefault: false };
}

// El orden canónico de cada grupo es el de las listas PLATFORMS/STUDIOS/… de
// `catalogs.js` y `streams.js`. Se resuelve de forma perezosa (dentro de
// `encodeConfig`) porque `configurePage.js`, `homePage.js` y `webI18n.js`
// requieren este módulo: hacerlo arriba crearía un ciclo de require.
let canonicalOrders = null;
function orders() {
  if (!canonicalOrders) {
    const catalogs = require('./catalogs');
    const streams = require('./streams');
    const index = (keys) => new Map(keys.map((key, i) => [key, i]));
    canonicalOrders = {
      base: index(BASE_KEYS),
      platforms: index(catalogs.PLATFORM_KEYS),
      studios: index(catalogs.STUDIO_KEYS),
      streams: index(streams.PROVIDER_KEYS),
      hide: index(FILTER_KEYS),
    };
  }
  return canonicalOrders;
}

/**
 * Ordena una selección con el orden canónico del addon (el de las listas
 * PLATFORMS/STUDIOS/…) y quita duplicados.
 *
 * ¿Por qué importa? El segmento `<cfg>` es la identidad del usuario en la URL
 * del manifest. Si `['netflix','disney']` y `['disney','netflix']` produjeran
 * segmentos distintos, dos usuarios con la MISMA configuración no compartirían
 * ni la caché del borde ni el catálogo pregenerado. Con orden canónico sí.
 */
function canonicalKeys(list, order) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    if (typeof value !== 'string' || seen.has(value) || !order.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.sort((a, b) => order.get(a) - order.get(b));
}

/**
 * Serializa config → base64url (solo ASCII, JSON compacto).
 *
 * Es determinista: la misma configuración produce siempre el mismo segmento
 * (ver `canonicalKeys`), aunque la selección llegue en otro orden. De eso
 * dependen los catálogos y manifiestos pregenerados por configuración: dos
 * usuarios con la misma selección comparten los mismos archivos estáticos (y
 * por tanto 0 invocaciones del Worker).
 */
function encodeConfig(cfg) {
  const order = orders();
  const slim = {
    lang: cfg.lang && cfg.lang !== DEFAULT_LANG ? cfg.lang : undefined,
    region: cfg.region,
    platforms: Array.isArray(cfg.platforms) ? canonicalKeys(cfg.platforms, order.platforms) : cfg.platforms === null || cfg.platforms === undefined ? undefined : cfg.platforms,
    studios: Array.isArray(cfg.studios) ? canonicalKeys(cfg.studios, order.studios) : cfg.studios === null || cfg.studios === undefined ? undefined : cfg.studios,
    base: Array.isArray(cfg.base) ? canonicalKeys(cfg.base, order.base) : cfg.base === null || cfg.base === undefined ? undefined : cfg.base,
    streams: Array.isArray(cfg.streams) ? canonicalKeys(cfg.streams, order.streams) : cfg.streams === null || cfg.streams === undefined ? undefined : cfg.streams,
    // Los valores por defecto no viajan en la URL.
    hide: Array.isArray(cfg.hide) && cfg.hide.length ? canonicalKeys(cfg.hide, order.hide) : undefined,
    // Solo viaja si se desactivó algún grupo (la lista completa es el defecto).
    badges: Array.isArray(cfg.badges) && cfg.badges.length < BADGE_KEYS.length ? cfg.badges : undefined,
  };
  const json = JSON.stringify(slim);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const DECODE_CACHE_MAX = 512;
const decodeCache = new Map();

function cloneDecodedConfig(cfg) {
  if (!cfg) return null;
  return {
    ...cfg,
    platforms: Array.isArray(cfg.platforms) ? cfg.platforms.slice() : cfg.platforms,
    studios: Array.isArray(cfg.studios) ? cfg.studios.slice() : cfg.studios,
    base: Array.isArray(cfg.base) ? cfg.base.slice() : cfg.base,
    streams: Array.isArray(cfg.streams) ? cfg.streams.slice() : cfg.streams,
    hide: Array.isArray(cfg.hide) ? cfg.hide.slice() : cfg.hide,
    badges: Array.isArray(cfg.badges) ? cfg.badges.slice() : cfg.badges,
  };
}

/** Parsea base64url → config normalizada o null si no es válida. */
function decodeConfig(segment, platformKeys, studioKeys, streamKeys) {
  try {
    if (!segment || RESERVED_SEGMENTS.has(segment)) return null;
    if (!CONFIG_SEGMENT_RE.test(segment)) return null;
    const cacheKey = `${segment}|${Array.isArray(platformKeys) ? platformKeys.length : 0}|${Array.isArray(studioKeys) ? studioKeys.length : 0}|${Array.isArray(streamKeys) ? streamKeys.length : 0}|${defaultLang()}`;
    if (decodeCache.has(cacheKey)) {
      const hit = decodeCache.get(cacheKey);
      decodeCache.delete(cacheKey);
      decodeCache.set(cacheKey, hit);
      return cloneDecodedConfig(hit);
    }
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
      (raw.badges !== undefined && !Array.isArray(raw.badges))
    ) {
      return null;
    }
    if (decodeCache.size >= DECODE_CACHE_MAX) {
      decodeCache.delete(decodeCache.keys().next().value);
    }
    decodeCache.set(cacheKey, cfg);
    return cloneDecodedConfig(cfg);
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAX_CONFIG_SEGMENT,
  CONFIG_SEGMENT_RE,
  LANG_OPTIONS,
  REGION_GROUPS,
  REGION_OPTIONS,
  DEFAULT_LANG,
  DEFAULT_REGION,
  BASE_OPTIONS,
  BASE_KEYS,
  RECOMMENDED_PLATFORMS,
  RECOMMENDED_STUDIOS,
  RECOMMENDED_BASE,
  defaultConfig,
  defaultLang,
  encodeConfig,
  decodeConfig,
  normalizeConfig,
};
