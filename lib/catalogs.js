'use strict';

/**
 * Definición de TODOS los catálogos del addon.
 *
 *  - Películas/Series · Tendencias / Populares / Top Valoradas  (TMDB)
 *  - Películas y Series por PLATAFORMA  (TMDB discover + with_watch_providers)
 *  - Series · En TV hoy  (TVMaze, sin clave)
 *
 * Los catálogos visibles dependen de la config de usuario (prefijo base64url
 * en la URL del manifest): idioma, región y plataformas elegidas.
 * Sin prefijo → comportamiento por defecto (todo activado).
 */

const config = require('./config');
const cache = require('./cache');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');
const { channelMetas, SPORTS_CHANNELS } = require('./sportsChannels');
const { activeCategories, liveMetas } = require('./liveChannels');

// ─────────────────────────────────────────────────────────────────────────────
// Plataformas (JustWatch provider ids en TMDB; lista completa editable aquí)
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORMS = [
  // ── Globales ────────────────────────────────────────────────────────────
  { key: 'netflix',     name: 'Netflix',        providers: '8' },
  // 119 = "Amazon Prime Video" (LatAm/ES/AR) · 9 = Amazon (US). Con solo el 9
  // los catálogos de Prime salían vacíos fuera de EE. UU.
  { key: 'prime',       name: 'Prime Video',    providers: '119|9' },
  { key: 'disney',      name: 'Disney+',        providers: '337' },
  { key: 'max',         name: 'Max (HBO)',      providers: '1899|384|1825' },
  { key: 'appletv',     name: 'Apple TV+',      providers: '350' },
  { key: 'paramount',   name: 'Paramount+',     providers: '531|2303|1853' },
  { key: 'crunchyroll', name: 'Crunchyroll',    providers: '283|1968' },
  { key: 'hulu',        name: 'Hulu',           providers: '15' },
  { key: 'amcp',        name: 'AMC+',           providers: '526|528' },
  { key: 'mubi',        name: 'MUBI',           providers: '11' },
  { key: 'tubi',        name: 'Tubi',           providers: '73' },
  { key: 'pluto',       name: 'Pluto TV',       providers: '300' },
  { key: 'peacock',     name: 'Peacock',        providers: '386|387' },
  { key: 'starz',       name: 'Starz',          providers: '43' },
  { key: 'mgmplus',     name: 'MGM+',           providers: '34' },
  { key: 'youtubepremium', name: 'YouTube Premium', providers: '188' },
  { key: 'plex',        name: 'Plex',           providers: '538|2077' },
  { key: 'freevee',     name: 'Amazon Freevee', providers: '613' },
  { key: 'roku',        name: 'The Roku Channel', providers: '207' },
  { key: 'discoveryplus', name: 'discovery+',   providers: '510|524|584' },
  // ── Latinoamérica ───────────────────────────────────────────────────────
  { key: 'vix',         name: 'ViX',            providers: '457|1866' },
  { key: 'clarovideo',  name: 'Claro video',    providers: '167|484' },
  { key: 'directvgo',   name: 'DIRECTV GO',     providers: '467' },
  { key: 'movistartv',  name: 'Movistar TV',    providers: '339' },
  { key: 'filminlatino',name: 'Filmin Latino',  providers: '66' },
  { key: 'globoplay',   name: 'Globoplay',      providers: '307' },
  // ── España / Europa ─────────────────────────────────────────────────────
  { key: 'filmin',      name: 'Filmin',         providers: '63|64' },
  { key: 'atresplayer', name: 'Atresplayer',    providers: '62|2162' },
  { key: 'skyshowtime', name: 'SkyShowtime',    providers: '1773' },
  { key: 'movistarplus',name: 'Movistar Plus+', providers: '2241|149' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Estudios / productoras (company ids en TMDB). Solo películas.
// ─────────────────────────────────────────────────────────────────────────────
// Legacy keys retained only to decode already-installed configuration URLs.
const STUDIOS = [
  // ── Majors ──────────────────────────────────────────────────────────────
  { key: 'marvel',    name: 'Marvel Studios',       company: '420' },
  { key: 'pixar',     name: 'Pixar',                company: '3' },
  { key: 'waltdisney',name: 'Walt Disney Pictures', company: '2' },
  { key: 'disneyanim',name: 'Disney Animation',     company: '6125' },
  { key: 'lucasfilm', name: 'Lucasfilm',            company: '1' },
  { key: 'warner',    name: 'Warner Bros.',         company: '174' },
  { key: 'newline',   name: 'New Line Cinema',      company: '12' },
  { key: 'universal', name: 'Universal',            company: '33' },
  { key: 'illumination', name: 'Illumination',      company: '6704' },
  { key: 'dreamworks',name: 'DreamWorks Animation', company: '521' },
  { key: 'paramount', name: 'Paramount Pictures',   company: '4' },
  { key: 'sony',      name: 'Sony Pictures',        company: '5' },
  { key: 'fox',       name: '20th Century Studios', company: '127928' },
  { key: 'mgm',       name: 'MGM',                  company: '21' },
  { key: 'lionsgate', name: 'Lionsgate',            company: '1632' },
  // ── Autor / indie ───────────────────────────────────────────────────────
  { key: 'a24',       name: 'A24',                  company: '41077' },
  { key: 'blumhouse', name: 'Blumhouse',            company: '3172' },
  { key: 'ghibli',    name: 'Studio Ghibli',        company: '10342' },
  // ── Animación asiática ──────────────────────────────────────────────────
  { key: 'toei',      name: 'Toei Animation',       company: '5542' },
  { key: 'mappa',     name: 'MAPPA',                company: '21444' },
  { key: 'kyoani',    name: 'Kyoto Animation',      company: '5438' },
];

// Géneros solo de SERIES (TMDB genre ids de TV). Equilibran el manifest:
// añaden colecciones temáticas de series sin duplicar filas por productora.
const SERIES_GENRES = [
  { key: 'accion',   name: 'Acción y Aventura', genre: '10759' },
  { key: 'comedia',  name: 'Comedia',           genre: '35' },
  { key: 'crimen',   name: 'Crimen',            genre: '80' },
  { key: 'drama',    name: 'Drama',             genre: '18' },
  { key: 'misterio', name: 'Misterio',          genre: '9648' },
  { key: 'scifi',    name: 'Sci-Fi y Fantasía', genre: '10765' },
];

const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);
const STUDIO_KEYS = STUDIOS.map((s) => s.key);

const PAGE_SIZE = 20;
/** Una página sin resultados se recuerda poco, pero se recuerda. */
const EMPTY_TTL_SECONDS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Construcción de catálogos según config de usuario
// ─────────────────────────────────────────────────────────────────────────────
function buildDefs(cfg) {
  const defs = [];
  const base = cfg && cfg.base ? new Set(cfg.base) : null;
  const platformKeys = cfg && cfg.platforms ? new Set(cfg.platforms) : null;
  const hasBase = (k) => !base || base.has(k);

  // Nombres "estilo Cinemeta": la misma etiqueta para la fila de películas y
  // la de series ("Netflix", "Tendencias"...). Stremio las separa por
  // pestaña de tipo, y así el manifest no gasta ~11 bytes por catálogo en el
  // prefijo "Películas · "/"Series · " (el límite del addonCollection API
  // son 8 KB de manifest).
  for (const mediaType of ['movie', 'series']) {
    const prefix = mediaType === 'movie' ? 'cine' : 'tv';
    if (hasBase('tendencias')) defs.push({ id: `${prefix}_tendencias`, type: mediaType, name: 'Tendencias', kind: 'tendencias', mediaType });
    if (hasBase('populares'))  defs.push({ id: `${prefix}_popular`,    type: mediaType, name: 'Populares',  kind: 'popular',    mediaType });
    if (hasBase('top'))        defs.push({ id: `${prefix}_top`,        type: mediaType, name: 'Top Valoradas', kind: 'top',     mediaType });
  }

  if (hasBase('estrenos'))   defs.push({ id: 'cine_estrenos', type: 'movie',  name: 'En cines',                    kind: 'estrenos',   mediaType: 'movie' });
  if (hasBase('proximos'))   defs.push({ id: 'cine_proximos', type: 'movie',  name: 'Próximos estrenos',          kind: 'proximos',   mediaType: 'movie' });
  if (hasBase('en_emision')) defs.push({ id: 'tv_enemision',  type: 'series', name: 'En emisión',                 kind: 'en_emision', mediaType: 'series' });
  if (hasBase('anime')) {
    defs.push({ id: 'cine_anime', type: 'movie',  name: 'Anime', kind: 'anime', mediaType: 'movie' });
    defs.push({ id: 'tv_anime',   type: 'series', name: 'Anime', kind: 'anime', mediaType: 'series' });
  }

  for (const platform of PLATFORMS) {
    if (platformKeys && !platformKeys.has(platform.key)) continue;
    defs.push({ id: `cine_${platform.key}`, type: 'movie',  name: platform.name, kind: 'platform', mediaType: 'movie',  providers: platform.providers });
    defs.push({ id: `tv_${platform.key}`,   type: 'series', name: platform.name, kind: 'platform', mediaType: 'series', providers: platform.providers });
  }

  // Series por género + miniseries (opción base "generos_series" en /configure)
  if (hasBase('generos_series')) {
    for (const g of SERIES_GENRES) {
      defs.push({ id: `tv_genero_${g.key}`, type: 'series', name: g.name, kind: 'genre', mediaType: 'series', genre: g.genre });
    }
    defs.push({ id: 'tv_miniseries', type: 'series', name: 'Miniseries', kind: 'miniseries', mediaType: 'series' });
  }

  if (hasBase('tvmaze_hoy')) {
    defs.push({ id: 'tvmaze_hoy', type: 'series', name: 'En TV hoy (TVMaze)', kind: 'tvmaze', source: 'tvmaze' });
  }

  // Canales de deportes en vivo (tipo tv; catálogo estático, sin TMDB).
  if (hasBase('deportes')) {
    defs.push({ id: 'tv_deportes', type: 'tv', name: '⚽ Deportes en vivo', kind: 'channels' });
  }

  // Canales en vivo por categorías (proveedor único m3u.tvcluboficial.com,
  // verificado por sonda; la lista Magma TV solo refresca URLs en runtime).
  // Las filas temáticas entran en el manifest por defecto; las de países solo
  // cuando el usuario las marca en /configure (cada catálogo son ~95 chars y
  // el manifest debe quedar por debajo de los 8 KB de la addonCollection API).
  const LIVE_OPT_IN = new Set(['espana', 'mexico', 'argentina', 'colombia', 'chile', 'peru']);
  for (const cat of activeCategories()) {
    const enabled = LIVE_OPT_IN.has(cat.key)
      ? Boolean(base && base.has(`live_${cat.key}`))
      : hasBase(`live_${cat.key}`);
    if (enabled) {
      defs.push({ id: `tv_live_${cat.key}`, type: 'tv', name: cat.name, kind: 'channels-live', category: cat.key });
    }
  }

  // Stable, predictable sections per media type; IDs and selections stay intact.
  const section = (d) => d.kind === 'platform' ? 2 : d.kind === 'studio' ? 3 : 1;
  return defs.sort((a, b) =>
    (a.type === 'movie' ? 0 : 1) - (b.type === 'movie' ? 0 : 1) || section(a) - section(b));
}

/** Catálogos por defecto (todo activado) — para el manifest sin config. */
const CATALOG_DEFS = buildDefs(null);
const catalogById = new Map(CATALOG_DEFS.map((def) => [def.id, def]));

/** Catálogos declarados en el manifest, según config (o por defecto). */
function manifestCatalogs(cfg) {
  // All TMDB collections paginate; the daily TVMaze schedule does not.
  return buildDefs(cfg ?? null).map((def) => ({
    id: def.id, type: def.type, name: def.name,
    ...(def.source !== 'tvmaze' && def.kind !== 'channels' ? { extraSupported: ['skip'] } : {}),
  }));
}

/** Resuelve un catálogo y devuelve metas para Stremio. Nunca lanza. */
async function resolveCatalog(type, id, cfg, extra = {}) {
  const def = catalogById.get(id);
  if (!def || def.type !== type) return [];
  if (cfg) {
    const visible = buildDefs(cfg);
    if (!visible.some((d) => d.id === id && d.type === type)) return [];
  }

  const parsedSkip = Number(extra.skip || 0);
  if (!Number.isSafeInteger(parsedSkip) || parsedSkip < 0 || parsedSkip >= 10000) return [];
  const page = Math.floor(parsedSkip / PAGE_SIZE) + 1;
  const offset = parsedSkip % PAGE_SIZE;

  const lang = (cfg && cfg.lang) || config.tmdbLanguage || 'es';
  const region = (cfg && cfg.region) || config.watchRegion;
  const usesRegion = def.kind === 'platform' || def.kind === 'estrenos' || def.kind === 'proximos';
  const pageKey = `cat:v2:${type}:${id}:${lang}:${usesRegion ? [region, ...(config.watchRegionFallback || [])].join(',') : '_'}:p${page}:${config.tmdbConfigured ? 1 : 0}`;

  const cachedPage = cache.get(pageKey);
  if (cachedPage !== undefined) {
    return offset ? cachedPage.slice(offset) : cachedPage;
  }

  try {
    if (def.kind === 'channels') {
      // Curados primero; detrás, los canales de deportes de las listas vivas
      // que no cubre ningún curado (ESPN 4-7, Claro Sports 2, Azteca…).
      if (parsedSkip) return [];
      const curated = SPORTS_CHANNELS.map((c) => c.match);
      return [...channelMetas(), ...liveMetas('deportes', { excludeMatch: curated })];
    }
    if (def.kind === 'channels-live') {
      return parsedSkip ? [] : liveMetas(def.category);
    }
    if (def.source === 'tvmaze') {
      return parsedSkip ? [] : await tvmaze.airingToday();
    }
    if (!config.tmdbConfigured) {
      console.warn(`[Catálogo] TMDB no configurado; "${id}" devolverá lista vacía. Revisa TMDB_API_KEY/TMDB_ACCESS_TOKEN.`);
      return [];
    }
    const items = await cache.coalesce(`load:${pageKey}`, async () => {
      const again = cache.get(pageKey);
      if (again !== undefined) return again;
      let resolved = [];
      if (def.kind === 'platform') {
        // Select one regional list, never concatenate pages from several lists:
        // mixing them changes page lengths and repeats titles across skip values.
        const chain = [...new Set([region, ...(config.watchRegionFallback || [])])].filter(Boolean);
        const regionKey = `platform-region:v2:${type}:${id}:${lang}:${chain.join(',')}`;
        let selected = cache.get(regionKey);
        let firstPage;
        if (selected === undefined) {
          selected = await cache.coalesce(regionKey, async () => {
            let bestRegion = chain[0];
            let best = [];
            for (const candidateRegion of chain) {
              const candidate = await tmdb.catalogItems(def, { lang, region: candidateRegion, page: 1 });
              if (candidate.length > best.length) { best = candidate; bestRegion = candidateRegion; }
              if (candidate.length >= PAGE_SIZE) break;
            }
            firstPage = best.slice(0, PAGE_SIZE);
            cache.set(regionKey, bestRegion, Math.max(60, config.cacheTtl || 21600));
            return bestRegion;
          });
        }
        resolved = page === 1 && firstPage !== undefined ? firstPage
          : await tmdb.catalogItems(def, { lang, region: selected, page });
      } else {
        resolved = await tmdb.catalogItems(def, { lang, region, page });
      }
      resolved = resolved.slice(0, PAGE_SIZE);
      // Una página vacía también se guarda (5 minutos). Sin esto, cada visita a
      // una fila que hoy no tiene resultados (país sin catálogo JustWatch,
      // estreno agotado, género sin resultados) volvía a consultar TMDB y gastaba
      // cuota del Worker y de la API sin cambiar el resultado.
      const ttl = resolved.length > 0 ? Math.max(60, config.cacheTtl || 21600) : EMPTY_TTL_SECONDS;
      cache.set(pageKey, resolved, ttl);
      return resolved;
    });
    return offset ? items.slice(offset) : items;
  } catch (err) {
    console.error(`[Catálogo] Error resolviendo "${id}" ->`, err.message);
    return [];
  }
}

module.exports = {
  CATALOG_DEFS,
  catalogById,
  PLATFORMS,
  STUDIOS,
  SERIES_GENRES,
  PLATFORM_KEYS,
  STUDIO_KEYS,
  buildDefs,
  manifestCatalogs,
  resolveCatalog,
};
