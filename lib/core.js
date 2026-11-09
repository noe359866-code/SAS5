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
const { searchStreams, PROVIDERS: STREAM_PROVIDERS_LIST } = require('./streams');

const CATALOGS = manifestCatalogs(null);

const DESCRIPTION =
  'Catálogos de películas y series: Tendencias, Populares, Top Valoradas, por plataforma ' +
  '(Netflix, Disney+, Max, Prime Video, Paramount+, Hulu, ViX, Filmin, Plex...) y por estudio ' +
  '(Marvel, Pixar, Warner, Lionsgate, A24, Ghibli, MAPPA...), con streams torrent. ' +
  'Elige idioma, región, plataformas, estudios y proveedores en /configure.';

/**
 * Manifest de Stremio.
 * @param {string|null} logoUrl  Logo absoluto (host actual).
 * @param {object|null} cfg      Config de usuario normalizada (o null = por defecto).
 */
function buildManifest(logoUrl, cfg) {
  const catalogs = manifestCatalogs(cfg ?? null);
  const manifest = {
    id: 'org.comunidad.catalogos.plus',
    version: '1.3.0',
    name: cfg && !cfg.isDefault ? `${config.addonName} · ${cfg.region}` : config.addonName,
    description: DESCRIPTION,
    background: 'https://dl.strem.io/bg.jpg',
    resources: ['catalog', 'meta', 'stream'],
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

/** Handler de streams (proveedores de contenido). Nunca lanza. */
async function handleStream(type, id, cfg) {
  try {
    const streams = await searchStreams(type, id, cfg ?? null);
    return { streams, cacheMaxAge: 3600 };
  } catch (err) {
    console.error(`[Stream] type=${type} id=${id} ->`, err.message);
    return { streams: [] };
  }
}

module.exports = { buildManifest, handleCatalog, handleMeta, handleStream, CATALOGS, DESCRIPTION, PLATFORMS, STUDIOS, STREAM_PROVIDERS_LIST };
