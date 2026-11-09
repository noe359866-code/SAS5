'use strict';

/**
 * Definición de TODOS los catálogos del addon.
 *
 *  - Películas/Series · Tendencias / Populares / Top Valoradas  (TMDB)
 *  - Películas y Series por PLATAFORMA  (TMDB discover + with_watch_providers)
 *  - Películas por ESTUDIO / PRODUCTORA  (TMDB discover + with_companies)
 *  - Series · En TV hoy  (TVMaze, sin clave)
 *
 * Los catálogos visibles dependen de la config de usuario (prefijo base64url
 * en la URL del manifest): idioma, región, plataformas y estudios elegidos.
 * Sin prefijo → comportamiento por defecto (todo activado).
 */

const config = require('./config');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');

// ─────────────────────────────────────────────────────────────────────────────
// Plataformas (JustWatch provider ids en TMDB; lista completa editable aquí)
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORMS = [
  { key: 'netflix',     name: 'Netflix',        providers: '8' },
  { key: 'prime',       name: 'Prime Video',    providers: '9' },
  { key: 'disney',      name: 'Disney+',        providers: '337' },
  { key: 'max',         name: 'Max (HBO)',      providers: '1899|384' },
  { key: 'appletv',     name: 'Apple TV+',      providers: '350' },
  { key: 'paramount',   name: 'Paramount+',     providers: '2303|531' },
  { key: 'crunchyroll', name: 'Crunchyroll',    providers: '283' },
  { key: 'hulu',        name: 'Hulu',           providers: '15' },
  { key: 'amcp',        name: 'AMC+',           providers: '526' },
  { key: 'mubi',        name: 'MUBI',           providers: '11' },
  { key: 'tubi',        name: 'Tubi',           providers: '73' },
  { key: 'pluto',       name: 'Pluto TV',       providers: '300' },
  { key: 'peacock',     name: 'Peacock',        providers: '386' },
  { key: 'starz',       name: 'Starz',          providers: '43' },
  { key: 'mgmplus',     name: 'MGM+',           providers: '34' },
  { key: 'youtubepremium', name: 'YouTube Premium', providers: '188' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Estudios / productoras (company ids en TMDB). Solo películas.
// ─────────────────────────────────────────────────────────────────────────────
const STUDIOS = [
  { key: 'marvel',    name: 'Marvel Studios',      company: '420' },
  { key: 'pixar',     name: 'Pixar',               company: '3' },
  { key: 'a24',       name: 'A24',                 company: '41077' },
  { key: 'dreamworks',name: 'DreamWorks Animation',company: '521' },
  { key: 'ghibli',    name: 'Studio Ghibli',       company: '10342' },
  { key: 'warner',    name: 'Warner Bros.',        company: '9993' },
  { key: 'universal', name: 'Universal',           company: '33' },
  { key: 'paramount', name: 'Paramount Pictures',  company: '4' },
  { key: 'sony',      name: 'Sony Pictures',       company: '5' },
];

// Géneros solo de SERIES (TMDB genre ids de TV). Equilibran el manifest:
// los estudios y los estrenos de cine son catálogos solo de películas, así
// que sin esto Stremio muestra muchas más filas de "movie" que de "series".
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

// ─────────────────────────────────────────────────────────────────────────────
// Construcción de catálogos según config de usuario
// ─────────────────────────────────────────────────────────────────────────────
function buildDefs(cfg) {
  const defs = [];
  const base = cfg && cfg.base ? new Set(cfg.base) : null;
  const platformKeys = cfg && cfg.platforms ? new Set(cfg.platforms) : null;
  const studioKeys = cfg && cfg.studios ? new Set(cfg.studios) : null;
  const hasBase = (k) => !base || base.has(k);

  for (const mediaType of ['movie', 'series']) {
    const prefix = mediaType === 'movie' ? 'cine' : 'tv';
    const label = mediaType === 'movie' ? 'Películas' : 'Series';
    if (hasBase('tendencias')) defs.push({ id: `${prefix}_tendencias`, type: mediaType, name: `${label} · Tendencias`, kind: 'tendencias', mediaType });
    if (hasBase('populares'))  defs.push({ id: `${prefix}_popular`,    type: mediaType, name: `${label} · Populares`,  kind: 'popular',    mediaType });
    if (hasBase('top'))        defs.push({ id: `${prefix}_top`,        type: mediaType, name: `${label} · Top Valoradas`, kind: 'top',     mediaType });
  }

  if (hasBase('estrenos'))   defs.push({ id: 'cine_estrenos', type: 'movie',  name: 'Películas · En cines',        kind: 'estrenos',   mediaType: 'movie' });
  if (hasBase('proximos'))   defs.push({ id: 'cine_proximos', type: 'movie',  name: 'Películas · Próximos estrenos', kind: 'proximos',   mediaType: 'movie' });
  if (hasBase('en_emision')) defs.push({ id: 'tv_enemision',  type: 'series', name: 'Series · En emisión',         kind: 'en_emision', mediaType: 'series' });
  if (hasBase('anime')) {
    defs.push({ id: 'cine_anime', type: 'movie',  name: 'Películas · Anime', kind: 'anime', mediaType: 'movie' });
    defs.push({ id: 'tv_anime',   type: 'series', name: 'Series · Anime',    kind: 'anime', mediaType: 'series' });
  }

  for (const platform of PLATFORMS) {
    if (platformKeys && !platformKeys.has(platform.key)) continue;
    defs.push({ id: `cine_${platform.key}`, type: 'movie',  name: `Películas · ${platform.name}`, kind: 'platform', mediaType: 'movie',  providers: platform.providers });
    defs.push({ id: `tv_${platform.key}`,   type: 'series', name: `Series · ${platform.name}`,    kind: 'platform', mediaType: 'series', providers: platform.providers });
  }

  // Series por género + miniseries (opción base "generos_series" en /configure)
  if (hasBase('generos_series')) {
    for (const g of SERIES_GENRES) {
      defs.push({ id: `tv_genero_${g.key}`, type: 'series', name: `Series · ${g.name}`, kind: 'genre', mediaType: 'series', genre: g.genre });
    }
    defs.push({ id: 'tv_miniseries', type: 'series', name: 'Series · Miniseries', kind: 'miniseries', mediaType: 'series' });
  }

  for (const studio of STUDIOS) {
    if (studioKeys && !studioKeys.has(studio.key)) continue;
    defs.push({
      id: `cine_estudio_${studio.key}`,
      type: 'movie',
      name: `Películas · ${studio.name}`,
      kind: 'studio',
      mediaType: 'movie',
      company: studio.company,
    });
  }

  if (hasBase('tvmaze_hoy')) {
    defs.push({ id: 'tvmaze_hoy', type: 'series', name: 'Series · En TV hoy (TVMaze)', kind: 'tvmaze', source: 'tvmaze' });
  }

  return defs;
}

/** Catálogos por defecto (todo activado) — para el manifest sin config. */
const CATALOG_DEFS = buildDefs(null);
const catalogById = new Map(CATALOG_DEFS.map((def) => [def.id, def]));

/** Catálogos declarados en el manifest, según config (o por defecto). */
function manifestCatalogs(cfg) {
  return buildDefs(cfg ?? null).map((def) => ({ id: def.id, type: def.type, name: def.name }));
}

/** Resuelve un catálogo y devuelve metas para Stremio. Nunca lanza. */
async function resolveCatalog(type, id, cfg) {
  const visible = buildDefs(cfg ?? null);
  const def = visible.find((d) => d.id === id && d.type === type);
  if (!def) return []; // desactivado en la config del usuario (o no existe)

  const lang = (cfg && cfg.lang) || config.tmdbLanguage || 'es';
  const region = (cfg && cfg.region) || config.watchRegion;

  try {
    if (def.source === 'tvmaze') {
      return await tvmaze.airingToday();
    }
    if (!config.tmdbConfigured) {
      console.warn(`[Catálogo] TMDB no configurado; "${id}" devolverá lista vacía. Revisa TMDB_API_KEY/TMDB_ACCESS_TOKEN.`);
      return [];
    }
    // Catálogos de plataforma: si la región del usuario no tiene resultados
    // JustWatch (típico en NI y países con poca cobertura), reintentamos con
    // MX y US antes de devolver vacío.
    if (def.kind === 'platform') {
      const chain = [...new Set([region, ...(config.watchRegionFallback || [])])];
      for (const r of chain) {
        const items = await tmdb.catalogItems(def, { lang, region: r });
        if (items.length > 0) {
          if (r !== region) console.log(`[FallbackRegión] "${id}" sin resultados en ${region}; usando ${r}`);
          return items;
        }
      }
      return [];
    }
    return await tmdb.catalogItems(def, { lang, region });
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
