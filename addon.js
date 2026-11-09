'use strict';

/**
 * Addon de Stremio «Catálogos+»
 * Catálogos de películas y series: Tendencias, Populares, Top Valoradas,
 * por plataforma de streaming y por estudio. Metadatos enriquecidos con
 * TMDB, TVMaze, OMDB y Watchmode.
 */

const { addonBuilder } = require('stremio-addon-sdk');
const config = require('./lib/config');
const { manifestCatalogs, resolveCatalog, PLATFORMS, STUDIOS } = require('./lib/catalogs');
const { buildMeta } = require('./lib/meta');

const catalogs = manifestCatalogs();

const manifest = {
  id: 'org.comunidad.catalogos.plus',
  version: '1.0.0',
  name: config.addonName,
  description:
    'Catálogos de películas y series: Tendencias, Populares, Top Valoradas, por plataforma ' +
    '(Netflix, Prime Video, Disney+, Max, Apple TV+, Paramount+, Star+, Crunchyroll) y por estudio ' +
    '(Marvel, Pixar, A24, Ghibli...). Enriquecido con TMDB, TVMaze, OMDB (IMDb/Rotten Tomatoes/Metacritic) ' +
    'y disponibilidad en streaming con Watchmode.',
  logo: config.addonBaseUrl ? `${config.addonBaseUrl}/assets/logo.png` : undefined,
  background: 'https://dl.strem.io/bg.jpg',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:', 'tvmaze:'],
  catalogs,
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
};

// El manifest no debe llevar campos undefined (rompe algunos clientes)
for (const key of Object.keys(manifest)) {
  if (manifest[key] === undefined) delete manifest[key];
}

const builder = new addonBuilder(manifest);

// ── Handler de catálogos ────────────────────────────────────────────────────
builder.defineCatalogHandler(async ({ type, id }) => {
  try {
    const metas = await resolveCatalog(type, id);
    return { metas, cacheMaxAge: config.cacheTtl };
  } catch (err) {
    console.error(`[CatalogHandler] type=${type} id=${id} ->`, err.message);
    return { metas: [] };
  }
});

// ── Handler de metadatos ────────────────────────────────────────────────────
builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const meta = await buildMeta(type, id);
    if (meta) return { meta, cacheMaxAge: config.cacheTtl };
  } catch (err) {
    console.error(`[MetaHandler] type=${type} id=${id} ->`, err.message);
  }
  // Ficha mínima válida para que Stremio no falle
  return {
    meta: {
      id: String(id || ''),
      type: type || 'movie',
      name: String(id || 'Desconocido'),
      description: 'Metadatos no disponibles. Revisa las claves de API del addon.',
    },
  };
});

module.exports = builder.getInterface();
module.exports.manifestCatalogs = catalogs;
module.exports.PLATFORMS = PLATFORMS;
module.exports.STUDIOS = STUDIOS;
