'use strict';

/** Catálogos de Stremio, uno por cada group-title de la lista M3U. */
const playlist = require('./livePlaylist');

// Se conservan las exportaciones vacías para que los enlaces de configuración
// antiguos se puedan decodificar sin reactivar catálogos de películas/series.
const PLATFORMS = [];
const STUDIOS = [];
const PLATFORM_KEYS = [];
const STUDIO_KEYS = [];
const PAGE_SIZE = 100;
const MAX_SKIP = 20000;

function buildDefs() {
  return playlist.playlistGroups().map((group) => ({
    id: group.id,
    type: 'tv',
    name: group.name,
    kind: 'playlist-group',
    group: group.name,
  }));
}

function manifestCatalogs() {
  return buildDefs().map(({ id, type, name }) => ({
    id, type, name, extraSupported: ['skip'],
  }));
}

async function resolveCatalog(type, id, _cfg, extra = {}) {
  const def = buildDefs().find((candidate) => candidate.id === id);
  if (!def || type !== 'tv' || def.type !== type) return [];
  const skip = Number(extra.skip || 0);
  if (!Number.isSafeInteger(skip) || skip < 0 || skip >= MAX_SKIP) return [];
  return playlist.playlistMetas(def.group, { skip, limit: PAGE_SIZE });
}

module.exports = {
  PLATFORMS, STUDIOS, PLATFORM_KEYS, STUDIO_KEYS, PAGE_SIZE,
  buildDefs, manifestCatalogs, resolveCatalog,
};
