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
const { channelById, channelMeta } = require('./sportsChannels');
const { liveChannelById, liveMeta } = require('./liveChannels');

const CATALOGS = manifestCatalogs(null);

const DESCRIPTION =
  'Películas y series por plataforma, con streams directos en español latino. ' +
  'Personaliza tus catálogos en /configure. Gratis.';

/**
 * Manifest de Stremio.
 * @param {string|null} logoUrl  Logo absoluto (host actual).
 * @param {object|null} cfg      Config de usuario normalizada (o null = por defecto).
 */
function buildManifest(logoUrl, cfg) {
  const catalogs = manifestCatalogs(cfg ?? null);
  const manifest = {
    id: 'net.ramdonlatam.catalogos',
    version: '1.7.0',
    name: cfg && !cfg.isDefault ? `${config.addonName} · ${cfg.region}` : config.addonName,
    description: DESCRIPTION,
    background: 'https://dl.strem.io/bg.jpg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'tv'],
    idPrefixes: ['tt', 'tmdb:', 'tvmaze:', 'rlch:'],
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
async function handleCatalog(type, id, cfg, extra = {}) {
  try {
    const metas = await resolveCatalog(type, id, cfg ?? null, extra);
    return { metas, cacheMaxAge: metas.length ? config.cacheTtl : 60 };
  } catch (err) {
    console.error(`[Catalog] type=${type} id=${id} ->`, err.message);
    return { metas: [] };
  }
}

/** Handler de metadatos. Siempre devuelve una ficha válida. */
async function handleMeta(type, id, cfg) {
  try {
    if (type === 'tv') {
      const channel = channelById(id);
      if (channel) return { meta: channelMeta(channel), cacheMaxAge: config.cacheTtl };
      const live = liveChannelById(id);
      if (live) return { meta: liveMeta(live), cacheMaxAge: config.cacheTtl };
    }
    const meta = await buildMeta(type, id, cfg ?? null);
    if (meta) {
      // Stremio consultaría el ID de la serie entera si la ficha no tiene episodios.
      const cacheMaxAge = meta.type === 'series' && !meta.videos?.length ? 0
        : meta.name === String(id || '') ? 60 : config.cacheTtl;
      return { meta, cacheMaxAge };
    }
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
async function handleStream(type, id, cfg, runtime = {}) {
  try {
    const status = {};
    const streams = await searchStreams(type, id, cfg ?? null, status, runtime);
    // Las respuestas parciales no se guardan y las que omiten una fuente
    // temporalmente en pausa solo duran lo que dura esa pausa.
    let cacheMaxAge = streams.length ? 300 : 0;
    if (status.partial) cacheMaxAge = 0;
    else if (status.stale) cacheMaxAge = 60;
    else if (status.paused) cacheMaxAge = Math.min(cacheMaxAge, config.streamProviderCooldownSeconds);
    return { streams, cacheMaxAge: Math.min(cacheMaxAge, status.maxAge ?? Infinity) };
  } catch (err) {
    console.error(`[Stream] type=${type} id=${id} ->`, err.message);
    return { streams: [], cacheMaxAge: 0 };
  }
}

// Una respuesta de streams puede llevar firmas de vida corta. A diferencia
// de catálogos y fichas, nunca se sirve vencida desde la caché HTTP.
function streamCacheControl(seconds) {
  return seconds > 0 ? `public, max-age=${seconds}, s-maxage=${seconds}, must-revalidate` : 'no-store';
}

module.exports = { streamCacheControl, buildManifest, handleCatalog, handleMeta, handleStream, CATALOGS, DESCRIPTION, PLATFORMS, STUDIOS, STREAM_PROVIDERS_LIST };
