'use strict';

/**
 * Núcleo agnóstico de plataforma: manifest + handlers de catálogo y meta.
 * Lo usan tanto el servidor Node/Vercel (Express/SDK) como el Cloudflare
 * Worker. Soporta config de usuario (idioma/región/plataformas/estudios)
 * decodificada del prefijo base64url de la URL.
 */

const config = require('./config');
const { manifestCatalogs, resolveCatalog, PLATFORMS, STUDIOS } = require('./catalogs');
const { buildMeta } = require('./meta');

const CATALOGS = manifestCatalogs(null);

const DESCRIPTION =
  'Catálogos de películas y series: Tendencias, Populares, Top Valoradas, por plataforma ' +
  '(Netflix, Prime Video, Disney+, Max, Apple TV+, Paramount+, Hulu, AMC+, Tubi...) y por estudio ' +
  '(Marvel, Pixar, A24, Ghibli...). Enriquecido con TMDB, TVMaze, OMDB (IMDb/Rotten Tomatoes/Metacritic) ' +
  'y disponibilidad en streaming con Watchmode. Elige idioma, región, plataformas y estudios en /configure.';

/**
 * Manifest de Stremio.
 * @param {string|null} logoUrl  Logo absoluto (host actual).
 * @param {object|null} cfg      Config de usuario normalizada (o null = por defecto).
 */
function buildManifest(logoUrl, cfg) {
  const catalogs = manifestCatalogs(cfg ?? null);
  const manifest = {
    id: 'org.comunidad.catalogos.plus',
    version: '1.2.0',
    name: cfg && !cfg.isDefault ? `${config.addonName} · ${cfg.region}` : config.addonName,
    description: DESCRIPTION,
    background: 'https://dl.strem.io/bg.jpg',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:', 'tvmaze:', 'tvdb:'],
    catalogs,
    behaviorHints: {
      configurable: true, // Stremio mostrará el botón "Configurar" → /configure
      configurationRequired: false,
    },
  };
  const logo = logoUrl || (config.addonBaseUrl ? `${config.addonBaseUrl}/assets/logo.png` : null);
  if (logo) manifest.logo = logo;
  return manifest;
}

/** Handler de catálogos. Nunca lanza. */
async function handleCatalog(type, id, cfg) {
  try {
    const metas = await resolveCatalog(type, id, cfg ?? null);
    return { metas, cacheMaxAge: config.cacheTtl };
  } catch (err) {
    console.error(`[Catalog] type=${type} id=${id} ->`, err.message);
    return { metas: [] };
  }
}

/** Handler de metadatos. Siempre devuelve una ficha válida. */
async function handleMeta(type, id, cfg) {
  try {
    const meta = await buildMeta(type, id, cfg ?? null);
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

module.exports = { buildManifest, handleCatalog, handleMeta, CATALOGS, DESCRIPTION, PLATFORMS, STUDIOS };
