'use strict';

/**
 * Definición de TODOS los catálogos del addon.
 *
 * Estructura:
 *  - Películas/Series · Tendencias / Populares / Top Valoradas  (TMDB)
 *  - Películas y Series por PLATAFORMA  (TMDB discover + with_watch_providers)
 *  - Películas por ESTUDIO / PRODUCTORA  (TMDB discover + with_companies)
 *  - Series · En TV hoy  (TVMaze, sin clave)
 *
 * Los IDs de proveedores (watch providers, fuente JustWatch a través de TMDB)
 * y de compañías son los públicos de TMDB. Puedes ajustarlos aquí abajo.
 */

const config = require('./config');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');

// ─────────────────────────────────────────────────────────────────────────────
// Plataformas (JustWatch provider ids en TMDB)
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORMS = [
  { key: 'netflix',    name: 'Netflix',       providers: '8' },
  { key: 'prime',      name: 'Prime Video',   providers: '9' },
  { key: 'disney',     name: 'Disney+',       providers: '337' },
  { key: 'max',        name: 'Max (HBO)',     providers: '1899|384' },
  { key: 'appletv',    name: 'Apple TV+',     providers: '350' },
  { key: 'paramount',  name: 'Paramount+',    providers: '531' },
  { key: 'starplus',   name: 'Star+',         providers: '619' },
  { key: 'crunchyroll',name: 'Crunchyroll',   providers: '283' },
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

// ─────────────────────────────────────────────────────────────────────────────
// Construcción programática de la lista de catálogos
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG_DEFS = [];

// Base: Tendencias / Populares / Top — películas y series
for (const mediaType of ['movie', 'series']) {
  const prefix = mediaType === 'movie' ? 'cine' : 'tv';
  const label = mediaType === 'movie' ? 'Películas' : 'Series';
  CATALOG_DEFS.push(
    { id: `${prefix}_tendencias`, type: mediaType, name: `${label} · Tendencias`,      kind: 'tendencias', mediaType },
    { id: `${prefix}_popular`,    type: mediaType, name: `${label} · Populares`,       kind: 'popular',    mediaType },
    { id: `${prefix}_top`,        type: mediaType, name: `${label} · Top Valoradas`,   kind: 'top',        mediaType },
  );
}

// Por plataforma: películas y series
for (const platform of PLATFORMS) {
  CATALOG_DEFS.push(
    { id: `cine_${platform.key}`, type: 'movie',  name: `Películas · ${platform.name}`, kind: 'platform', mediaType: 'movie',  providers: platform.providers },
    { id: `tv_${platform.key}`,   type: 'series', name: `Series · ${platform.name}`,    kind: 'platform', mediaType: 'series', providers: platform.providers },
  );
}

// Por estudio: solo películas
for (const studio of STUDIOS) {
  CATALOG_DEFS.push({
    id: `cine_estudio_${studio.key}`,
    type: 'movie',
    name: `Películas · ${studio.name}`,
    kind: 'studio',
    mediaType: 'movie',
    company: studio.company,
  });
}

// TVMaze: series emitidas hoy en TV/streaming (no requiere clave)
CATALOG_DEFS.push({
  id: 'tvmaze_hoy',
  type: 'series',
  name: 'Series · En TV hoy (TVMaze)',
  kind: 'tvmaze',
  source: 'tvmaze',
});

const catalogById = new Map(CATALOG_DEFS.map((def) => [def.id, def]));

/** Catálogos declarados en el manifest de Stremio. */
function manifestCatalogs() {
  return CATALOG_DEFS.map((def) => ({ id: def.id, type: def.type, name: def.name }));
}

/** Resuelve un catálogo y devuelve { metas } listo para Stremio. Nunca lanza. */
async function resolveCatalog(type, id) {
  const def = catalogById.get(id);
  if (!def || def.type !== type) return [];

  try {
    if (def.source === 'tvmaze') {
      return await tvmaze.airingToday();
    }
    if (!config.tmdbConfigured) {
      console.warn(`[Catálogo] TMDB no configurado; "${id}" devolverá lista vacía. Revisa TMDB_API_KEY/TMDB_ACCESS_TOKEN.`);
      return [];
    }
    return await tmdb.catalogItems(def);
  } catch (err) {
    console.error(`[Catálogo] Error resolviendo "${id}" ->`, err.message);
    return [];
  }
}

module.exports = { CATALOG_DEFS, manifestCatalogs, resolveCatalog, PLATFORMS, STUDIOS };
