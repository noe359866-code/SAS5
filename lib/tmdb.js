'use strict';

/**
 * Cliente TMDB (The Movie Database).
 * Acepta clave v3 (TMDB_API_KEY) o token v4 (TMDB_ACCESS_TOKEN).
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson } = require('./http');

const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/';

function image(path, size = 'w500') {
  return path ? `${IMG_BASE}${size}${path}` : undefined;
}

/**
 * GET genérico a TMDB con caché. Devuelve null si no hay clave o hay error.
 */
async function tmdbGet(path, params = {}, ttlSeconds = config.cacheTtl, lang) {
  if (!config.tmdbConfigured) return null;

  const url = new URL(BASE_URL + path);
  if (config.tmdbApiKey) url.searchParams.set('api_key', config.tmdbApiKey);
  url.searchParams.set('language', lang || config.tmdbLanguage || 'es');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const headers = config.tmdbAccessToken ? { Authorization: `Bearer ${config.tmdbAccessToken}` } : {};
  try {
    const data = await fetchJson(cacheKey, { headers });
    cache.set(cacheKey, data, ttlSeconds);
    return data;
  } catch (err) {
    console.error('[TMDB] Error en', path, '->', err.message);
    return null;
  }
}

/** IDs externos (IMDb) de un título. Caché larga: no cambian. */
async function externalIds(mediaType, tmdbId) {
  return tmdbGet(`/${mediaType}/${tmdbId}/external_ids`, {}, 7 * 24 * 3600, 'en');
}

/** Mapea un resultado de TMDB a un meta básico de Stremio. */
function mapTmdbItem(item, mediaType) {
  const type = mediaType === 'movie' ? 'movie' : 'series';
  const date = item.release_date || item.first_air_date || '';
  const year = date ? date.slice(0, 4) : '';
  const rating = Number(item.vote_average || 0);
  const title = item.title || item.name || 'Sin título';
  const meta = {
    id: item.imdb_id || `tmdb:${mediaType}:${item.id}`,
    type,
    name: title,
    poster: image(item.poster_path),
    background: image(item.backdrop_path, 'w1280'),
    description:
      (item.overview ? `${item.overview}\n\n` : '') +
      `⭐ TMDB: ${rating.toFixed(1)}/10` +
      (item.vote_count ? ` (${item.vote_count} votos)` : '') +
      (year ? `\n🗓 ${year}` : ''),
    releaseInfo: year,
    imdbRating: rating > 0 ? rating.toFixed(1) : undefined,
  };
  if (Array.isArray(item.genre_ids)) meta.genreIds = item.genre_ids;
  return meta;
}

/** Añade imdb_id a una lista de resultados (peticiones en paralelo, con caché). */
async function attachImdbIds(items, mediaType) {
  return Promise.all(
    items.map(async (item) => {
      const ext = await externalIds(mediaType, item.id);
      return { ...item, imdb_id: ext && ext.imdb_id ? ext.imdb_id : null };
    })
  );
}

/**
 * Obtiene los resultados de un catálogo TMDB según su definición.
 * kind: tendencias | popular | top | platform | studio
 */
async function catalogItems(def, { lang, region } = {}) {
  const mediaType = def.mediaType;
  const kind = def.kind;
  const effectiveRegion = region || config.watchRegion;
  let results = [];

  if (kind === 'tendencias') {
    const data = await tmdbGet(`/trending/${mediaType}/week`, {}, config.cacheTtl, lang);
    results = (data && data.results) || [];
  } else if (kind === 'estrenos') {
    const data = await tmdbGet('/movie/now_playing', { region: effectiveRegion }, config.cacheTtl, lang);
    results = (data && data.results) || [];
  } else if (kind === 'proximos') {
    const data = await tmdbGet('/movie/upcoming', { region: effectiveRegion }, config.cacheTtl, lang);
    results = (data && data.results) || [];
  } else if (kind === 'en_emision') {
    const data = await tmdbGet('/tv/on_the_air', { page: 1 }, config.cacheTtl, lang);
    results = (data && data.results) || [];
  } else if (kind === 'anime') {
    const data = await tmdbGet(`/discover/${mediaType}`, {
      sort_by: 'popularity.desc',
      with_genres: '16', // Animación
      with_original_language: 'ja',
    }, config.cacheTtl, lang);
    results = (data && data.results) || [];
  } else {
    const params = {};
    if (kind === 'top') {
      params.sort_by = 'vote_average.desc';
      params['vote_count.gte'] = config.minVoteCount;
    } else if (kind === 'popular') {
      params.sort_by = 'popularity.desc';
    } else if (kind === 'platform') {
      params.sort_by = 'popularity.desc';
      params.with_watch_providers = def.providers; // p.ej. "8" o "384|1899"
      params.watch_region = effectiveRegion;
      params.with_watch_monetization_types = 'flatrate|free|ads';
    } else if (kind === 'studio') {
      params.sort_by = 'popularity.desc';
      params.with_companies = def.company; // id de productora en TMDB
    }
    const data = await tmdbGet(`/discover/${kind === 'studio' ? 'movie' : mediaType}`, params, config.cacheTtl, lang);
    results = (data && data.results) || [];
  }

  // Limitar antes de resolver IMDb ids para ahorrar peticiones
  const trimmed = results.slice(0, 30);
  const withIds = await attachImdbIds(trimmed, mediaType);
  return withIds.map((item) => mapTmdbItem(item, mediaType));
}

/** Busca un título por IMDb id (para el meta handler). */
async function findByImdbId(imdbId, lang) {
  const data = await tmdbGet(`/find/${imdbId}`, { external_source: 'imdb_id' }, 24 * 3600, lang);
  if (!data) return { movie: null, tv: null };
  return {
    movie: (data.movie_results && data.movie_results[0]) || null,
    tv: (data.tv_results && data.tv_results[0]) || null,
  };
}

/** Tendencias semanales (para la landing y decoración). */
async function trending(mediaType, lang) {
  return tmdbGet(`/trending/${mediaType}/week`, {}, config.cacheTtl, lang);
}

module.exports = { tmdbGet, externalIds, catalogItems, findByImdbId, image, trending };
