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
  const apiKey = config.watchmodeApiKey;
  const url = `${BASE_URL}/search/?search_field=imdb_id&search_value=${encodeURIComponent(imdbId)}`;
  const cacheKey = `watchmode:${apiKey}:${url}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const data = await fetchJson(url, { timeoutMs: 8000, headers: { 'X-API-Key': apiKey } });
    if (!data || !Array.isArray(data.title_results)) throw new Error('respuesta de búsqueda inválida');
    const id = Array.isArray(data && data.title_results) && data.title_results.length > 0
      ? data.title_results[0].id : null;
    cache.set(cacheKey, id, 7 * 24 * 3600);
    return id;
  } catch (err) {
    console.error('[Watchmode] búsqueda por IMDb falló para', imdbId, '->', err.message);
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

  const apiKey = config.watchmodeApiKey;
  const titleId = await titleIdByImdb(imdbId);
  if (!titleId) return null;

  const url = `${BASE_URL}/title/${titleId}/sources/`;
  const cacheKey = `watchmode:${apiKey}:${url}`;
  const cached = cache.get(cacheKey);
  let sources = cached;
  if (sources === undefined) {
    try {
      sources = await fetchJson(url, { timeoutMs: 8000, headers: { 'X-API-Key': apiKey } });
      if (!Array.isArray(sources)) throw new Error('respuesta de fuentes inválida');
      cache.set(cacheKey, sources, 12 * 3600);
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
    region = (pool[0].region || '').toUpperCase() || '—';
    regionSources = region === '—' ? pool.filter((s) => !s.region) : byRegion(region);
  }

  const names = [...new Set(regionSources.map((s) => s.name).filter(Boolean))].sort();
  if (names.length === 0) return null;
  return { region, names };
}

module.exports = { availabilityByImdb };
