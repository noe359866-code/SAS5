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
  { key: 'paramount',   name: 'Paramount+',     providers: '531' },
  { key: 'starplus',    name: 'Star+',          providers: '619' },
  { key: 'crunchyroll', name: 'Crunchyroll',    providers: '283' },
  { key: 'hulu',        name: 'Hulu',           providers: '15' },
  { key: 'amcp',        name: 'AMC+',           providers: '526' },
  { key: 'mubi',        name: 'MUBI',           providers: '11' },
  { key: 'tubi',        name: 'Tubi',           providers: '73' },
  { key: 'pluto',       name: 'Pluto TV',       providers: '300' },
  { key: 'peacock',     name: 'Peacock',        providers: '386' },
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

  for (const platform of PLATFORMS) {
    if (platformKeys && !platformKeys.has(platform.key)) continue;
    defs.push({ id: `cine_${platform.key}`, type: 'movie',  name: `Películas · ${platform.name}`, kind: 'platform', mediaType: 'movie',  providers: platform.providers });
    defs.push({ id: `tv_${platform.key}`,   type: 'series', name: `Series · ${platform.name}`,    kind: 'platform', mediaType: 'series', providers: platform.providers });
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
  PLATFORM_KEYS,
  STUDIO_KEYS,
  buildDefs,
  manifestCatalogs,
  resolveCatalog,
};
