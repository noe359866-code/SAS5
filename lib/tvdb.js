'use strict';

/**
 * Cliente TheTVDB API v4 (https://thetvdb.com/api-information)
 * Requiere TVDB_API_KEY. Flujo: POST /v4/login → JWT (válido ~1 mes,
 * cacheado 24 días) → llamadas con `Authorization: Bearer <token>`.
 *
 * Uso en el addon:
 *  - Ficha de serie/película por IMDb id (fallback cuando TMDB/TVMaze no
 *    responden o no están configurados).
 *  - IDs explícitos `tvdb:series:123` / `tvdb:movie:123`.
 *
 * Nota: TVDB no tiene endpoint público de "tendencias/populares", por eso
 * se usa como fuente de metadatos y no de catálogos.
 */

const config = require('./config');
const cache = require('./cache');

const BASE_URL = 'https://api4.thetvdb.com/v4';
const IMAGE_BASE = 'https://artworks.thetvdb.com/banners/';

function authFetch(url, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || config.httpTimeoutMs);
  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
    redirect: 'follow',
  }).finally(() => clearTimeout(timer));
}

/** Login → JWT. Cacheado 24 días (el token dura ~1 mes). */
async function login() {
  const tokenKey = `tvdb:token:${JSON.stringify([config.tvdbApiKey, config.tvdbPin])}`;
  const cached = cache.get(tokenKey);
  if (cached) return cached;
  if (!config.tvdbConfigured) return null;

  return cache.coalesce(`load:${tokenKey}`, async () => {
    const again = cache.get(tokenKey);
    if (again) return again;
    const payload = { apikey: config.tvdbApiKey };
    if (config.tvdbPin) payload.pin = config.tvdbPin; // PIN de suscriptor (plan soportado por usuarios)

    try {
      const res = await authFetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const token = data && data.data && data.data.token;
      if (!token) throw new Error('respuesta de /login sin token');
      cache.set(tokenKey, token, 24 * 24 * 3600);
      return token;
    } catch (err) {
      console.error('[TVDB] login falló ->', err.message);
      return null;
    }
  });
}

/** GET autenticado. Un reintento si el token expiró (401). */
async function tvdbGet(path, ttlSeconds = 24 * 3600, _retried = false) {
  if (!config.tvdbConfigured) return null;
  const tokenKey = `tvdb:token:${JSON.stringify([config.tvdbApiKey, config.tvdbPin])}`;
  const token = await login();
  if (!token) return null;

  const cacheKey = `tvdb:${path}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  return cache.coalesce(`load:${cacheKey}:${_retried ? 'retry' : 'first'}`, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;
    try {
      const res = await authFetch(BASE_URL + path, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && !_retried) {
        cache.set(tokenKey, '', 0); // fuerza re-login
        return tvdbGet(path, ttlSeconds, true);
      }
      if (res.status === 404) {
        cache.set(cacheKey, null, 3600);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache.set(cacheKey, data, ttlSeconds);
      return data;
    } catch (err) {
      console.error('[TVDB]', path, '->', err.message);
      return null;
    }
  });
}

/** Busca un título por IMDb id remoto (type: "series" | "movie"). */
async function searchByRemoteId(imdbId, type = 'series') {
  const clean = String(imdbId || '').trim();
  if (!clean.startsWith('tt')) return null;
  const kind = type === 'movie' ? 'movie' : 'series';
  const data = await tvdbGet(`/search/remoteid/${encodeURIComponent(clean)}`, 24 * 3600);
  const items = (data && Array.isArray(data.data) && data.data) || [];
  // El endpoint puede devolver episodios o temporadas junto a la serie.
  return items.map((item) => item && item[kind]).find((item) => item && item.id) || null;
}

function pickOverview(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return (value.spa || value.eng || Object.values(value).find((v) => typeof v === 'string') || '').trim();
  }
  return '';
}

function genreNames(genres) {
  if (!Array.isArray(genres)) return [];
  return genres
    .map((g) => (typeof g === 'string' ? g : g && (g.name || (g.category && g.category.name)) || ''))
    .filter(Boolean);
}

function yearOf(value) {
  if (!value) return '';
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : '';
}

/** Ficha normalizada por id de TVDB. type: "series" | "movie". */
async function entityById(tvdbId, type = 'series', lang = 'spa') {
  const isMovie = type === 'movie';
  const path = isMovie ? `/movies/${tvdbId}/extended` : `/series/${tvdbId}/extended`;
  const ext = await tvdbGet(path, 7 * 24 * 3600);
  const d = ext && ext.data;
  if (!d) return null;

  // Traducción (español si existe; si no, lo que traiga la ficha extendida)
  let translated = null;
  if (lang) {
    const tr = await tvdbGet(`${isMovie ? '/movies' : '/series'}/${tvdbId}/translations/${lang}`, 7 * 24 * 3600);
    translated = (tr && tr.data) || null;
  }

  const image = d.image
    ? d.image.startsWith('http')
      ? d.image
      : IMAGE_BASE + d.image
    : undefined;

  const dateValue = d.first_air_time || d.firstAirTime || d.first_aired || d.firstAired || d.year || d.released || '';
  const year = yearOf(dateValue);
  const overview = (translated && translated.overview) || pickOverview(d.overview) || '';
  const name = (translated && translated.name) || d.name || `TVDB ${tvdbId}`;
  const runtime = d.averageRuntime || d.average_runtime || d.runtime || null;

  return {
    tvdbId: String(tvdbId),
    type: isMovie ? 'movie' : 'series',
    name,
    poster: image,
    description: overview,
    year,
    genre: genreNames(d.genres),
    runtime: runtime ? (typeof runtime === 'number' ? `${runtime} min` : String(runtime)) : undefined,
    imdbId: d.imdb_id || d.imdbId || null,
    network: (d.originalNetwork && (d.originalNetwork.name || d.originalNetwork)) || undefined,
    status: (d.status && (d.status.name || d.status)) || undefined,
  };
}

/** Busca por IMDb id y devuelve ficha normalizada (o null). */
async function entityByImdb(imdbId, type = 'series') {
  const hit = await searchByRemoteId(imdbId, type);
  if (!hit) return null;
  const id = hit.tvdb_id || hit.id;
  if (!id) return null;
  return entityById(id, type, 'spa');
}

module.exports = { entityByImdb, entityById, searchByRemoteId };
