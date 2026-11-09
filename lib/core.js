'use strict';

/**
 * Núcleo agnóstico de plataforma: manifest + handlers de catálogo y meta.
 * Lo usan tanto el servidor Node/Vercel (addon.js / api/index.js, vía
 * stremio-addon-sdk) como el Cloudflare Worker (worker.mjs).
 */

const config = require('./config');
const { manifestCatalogs, resolveCatalog } = require('./catalogs');
const { buildMeta } = require('./meta');

const CATALOGS = manifestCatalogs();

const DESCRIPTION =
  'Catálogos de películas y series: Tendencias, Populares, Top Valoradas, por plataforma ' +
  '(Netflix, Prime Video, Disney+, Max, Apple TV+, Paramount+, Star+, Crunchyroll) y por estudio ' +
  '(Marvel, Pixar, A24, Ghibli...). Enriquecido con TMDB, TVMaze, OMDB (IMDb/Rotten Tomatoes/Metacritic) ' +
  'y disponibilidad en streaming con Watchmode.';

/** Manifest de Stremio. `logoUrl` opcional para el logo absoluto. */
function buildManifest(logoUrl) {
  const manifest = {
    id: 'org.comunidad.catalogos.plus',
    version: '1.0.0',
    name: config.addonName,
    description: DESCRIPTION,
    background: 'https://dl.strem.io/bg.jpg',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:', 'tvmaze:', 'tvdb:'],
    catalogs: CATALOGS.map((c) => ({ ...c })),
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  };
  const logo = logoUrl || (config.addonBaseUrl ? `${config.addonBaseUrl}/assets/logo.png` : null);
  if (logo) manifest.logo = logo;
  return manifest;
}

/** Handler de catálogos. Nunca lanza. */
async function handleCatalog(type, id) {
  try {
    const metas = await resolveCatalog(type, id);
    return { metas, cacheMaxAge: config.cacheTtl };
  } catch (err) {
    console.error(`[Catalog] type=${type} id=${id} ->`, err.message);
    return { metas: [] };
  }
}

/** Handler de metadatos. Siempre devuelve una ficha válida. */
async function handleMeta(type, id) {
  try {
    const meta = await buildMeta(type, id);
    if (meta) return { meta, cacheMaxAge: config.cacheTtl };
  } catch (err) {
    console.error(`[Meta] type=${type} id=${id} ->`, err.message);
  }
  return {
    meta: {
      id: String(id || ''),
      type: type || 'movie',
      name: String(id || 'Desconocido'),
      description: 'Metadatos no disponibles. Revisa las claves de API del addon.',
    },
  };
}

module.exports = { buildManifest, handleCatalog, handleMeta, CATALOGS, DESCRIPTION };
