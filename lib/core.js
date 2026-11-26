'use strict';

/** Núcleo del addon de Stremio: catálogos y reproducción de canales M3U. */
const config = require('./config');
const { manifestCatalogs, resolveCatalog, PLATFORMS, STUDIOS } = require('./catalogs');
const playlist = require('./livePlaylist');

const CATALOGS = manifestCatalogs();
const DESCRIPTION = 'Canales de TV en vivo agrupados igual que la lista M3U: por país, tema y categoría.';
const STREAM_PROVIDERS_LIST = [];

function buildManifest(logoUrl) {
  const manifest = {
    id: 'net.ramdonlatam.catalogos',
    version: '2.1.0',
    name: 'RamdonLatam Canales',
    description: DESCRIPTION,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    idPrefixes: ['rlch:m3u:'],
    catalogs: manifestCatalogs(),
    behaviorHints: { configurable: false, configurationRequired: false },
  };
  const logo = logoUrl || (config.addonBaseUrl ? `${config.addonBaseUrl}/assets/logo.png` : null);
  if (logo) manifest.logo = logo;
  return manifest;
}

async function handleCatalog(type, id, _cfg, extra = {}) {
  if (type !== 'tv') return { metas: [], cacheMaxAge: 0 };
  try {
    const metas = await resolveCatalog(type, id, null, extra);
    return { metas, cacheMaxAge: metas.length ? config.cacheTtl : 60 };
  } catch (error) {
    console.error(`[Catalog] ${id}:`, error?.message);
    return { metas: [] };
  }
}

async function handleMeta(type, id) {
  if (type !== 'tv') {
    return { meta: { id: String(id || ''), type: 'tv', name: 'Canal no disponible' }, cacheMaxAge: 0 };
  }
  const channel = playlist.playlistChannelById(id);
  if (!channel) {
    return {
      meta: { id: String(id || ''), type: 'tv', name: 'Canal no disponible', description: 'Canal no incluido en la lista M3U.' },
      cacheMaxAge: 60,
    };
  }
  return { meta: playlist.playlistMeta(channel), cacheMaxAge: config.cacheTtl };
}

async function handleStream(type, id) {
  if (type !== 'tv' || !String(id || '').startsWith('rlch:m3u:')) return { streams: [], cacheMaxAge: 0 };
  const streams = playlist.playlistStreams(id);
  return { streams, cacheMaxAge: streams.length ? 240 : 0 };
}

function streamCacheControl(seconds) {
  return seconds > 0 ? `public, max-age=${seconds}, s-maxage=${seconds}, must-revalidate` : 'no-store';
}

module.exports = {
  streamCacheControl, buildManifest, handleCatalog, handleMeta, handleStream,
  CATALOGS, DESCRIPTION, PLATFORMS, STUDIOS, STREAM_PROVIDERS_LIST,
};
