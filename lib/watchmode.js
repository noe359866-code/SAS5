'use strict';

/**
 * Cliente Watchmode (disponibilidad en plataformas).
 * Requiere WATCHMODE_API_KEY. Sin clave, devuelve null sin romper nada.
 * Flujo: IMDb id -> title_id (cacheado 7 días) -> fuentes (cacheado 12h).
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson } = require('./http');

const BASE_URL = 'https://api.watchmode.com/v1';
// Tipos de fuente que interesan para "dónde ver" (suscripción/gratis/con anuncios)
const PREFERRED_TYPES = new Set(['sub', 'free', 'ads']);

async function titleIdByImdb(imdbId) {
  const url = `${BASE_URL}/title/find-by-external-id/${encodeURIComponent(
    imdbId
  )}/ids?apiKey=${encodeURIComponent(config.watchmodeApiKey)}`;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  try {
    const data = await fetchJson(url, { timeoutMs: 8000 });
    const id = Array.isArray(data) && data.length > 0 ? data[0].title_id : null;
    cache.set(url, id, 7 * 24 * 3600);
    return id;
  } catch (err) {
    console.error('[Watchmode] find-by-external-id falló para', imdbId, '->', err.message);
    return null;
  }
}

/**
 * Devuelve { region, names[] } con las plataformas de suscripción/gratis.
 * Prefiere la región configurada (WATCH_REGION); si no hay, usa US; si no, cualquiera.
 */
async function availabilityByImdb(imdbId, regionOverride) {
  if (!config.watchmodeConfigured) return null;
  if (!imdbId || !imdbId.startsWith('tt')) return null;

  const titleId = await titleIdByImdb(imdbId);
  if (!titleId) return null;

  const url = `${BASE_URL}/title/${titleId}/sources/?apiKey=${encodeURIComponent(
    config.watchmodeApiKey
  )}`;
  const cached = cache.get(url);
  let sources = cached;
  if (sources === undefined) {
    try {
      sources = await fetchJson(url, { timeoutMs: 8000 });
      cache.set(url, sources, 12 * 3600);
    } catch (err) {
      console.error('[Watchmode] sources falló para title_id', titleId, '->', err.message);
      return null;
    }
  }
  if (!Array.isArray(sources) || sources.length === 0) return null;

  const preferred = sources.filter((s) => PREFERRED_TYPES.has(s.type));
  const pool = preferred.length > 0 ? preferred : sources;

  const preferredRegion = (regionOverride || config.watchRegion || 'US').toUpperCase();
  const byRegion = (region) => pool.filter((s) => (s.region || '').toUpperCase() === region);
  let region = preferredRegion;
  let regionSources = byRegion(region);
  if (regionSources.length === 0 && region !== 'US') {
    region = 'US';
    regionSources = byRegion('US');
  }
  if (regionSources.length === 0) {
    regionSources = pool;
    region = (pool[0].region || '').toUpperCase() || '—';
  }

  const names = [...new Set(regionSources.map((s) => s.name).filter(Boolean))].sort();
  if (names.length === 0) return null;
  return { region, names };
}

module.exports = { availabilityByImdb };
