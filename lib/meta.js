'use strict';

/**
 * Constructor de metadatos (meta handler).
 * Encadena fuentes con degradación elegante:
 *   1) TMDB  (ficha principal + créditos)   — requiere clave TMDB
 *   2) TVMaze (series: argumento, géneros, runtime) — sin clave
 *   3) OMDB  (IMDB / Rotten Tomatoes / Metacritic)  — requiere clave OMDB
 *   4) Watchmode (dónde ver en streaming)    — requiere clave Watchmode
 *
 * IDs soportados:
 *   tt1234567            → IMDb id (flujo normal de Stremio)
 *   tmdb:movie:123 / tmdb:tv:123 → id de TMDB (fallback del catálogo)
 *   tvmaze:123           → id de TVMaze (catálogo «En TV hoy»)
 */

const config = require('./config');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');
const omdb = require('./omdb');
const watchmode = require('./watchmode');

function yearOf(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : '';
}

async function buildFromTmdb(type, tmdbId, originalId) {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const append = mediaType === 'movie' ? 'credits' : 'aggregate_credits';
  const details = await tmdb.tmdbGet(`/${mediaType}/${tmdbId}`, { append_to_response: append }, config.cacheTtl);
  if (!details) return null;

  let imdbId = details.imdb_id || null;
  if (!imdbId) {
    const ext = await tmdb.externalIds(mediaType, tmdbId);
    imdbId = ext && ext.imdb_id ? ext.imdb_id : null;
  }

  const [omdbData, availability] = await Promise.all([
    imdbId ? omdb.getByImdbId(imdbId) : Promise.resolve(null),
    imdbId ? watchmode.availabilityByImdb(imdbId) : Promise.resolve(null),
  ]);

  const title = details.title || details.name || originalId;
  const date = details.release_date || details.first_air_date || '';
  const year = yearOf(date);
  const genres = Array.isArray(details.genres) ? details.genres.map((g) => g.name) : [];
  const runtimeMin =
    details.runtime ||
    (Array.isArray(details.episode_run_time) && details.episode_run_time[0]) ||
    null;

  const credits = details.credits || details.aggregate_credits || {};
  const cast = Array.isArray(credits.cast)
    ? credits.cast.slice(0, 6).map((c) => c.name).filter(Boolean)
    : [];
  const directors = Array.isArray(credits.crew)
    ? credits.crew.filter((c) => c.job === 'Director').map((c) => c.name)
    : [];

  const ratingLine =
    omdb.ratingsSummary(omdbData) ||
    (details.vote_average ? `⭐ TMDB ${Number(details.vote_average).toFixed(1)}/10` : null);

  const descriptionLines = [details.overview || ''];
  if (ratingLine) descriptionLines.push('', ratingLine);
  if (directors.length) descriptionLines.push(`🎬 Dirección: ${directors.join(', ')}`);
  if (cast.length) descriptionLines.push(`🎭 Reparto: ${cast.join(', ')}`);
  if (availability && availability.names.length) {
    descriptionLines.push(
      '',
      `📺 Disponible en ${availability.region}: ${availability.names.join(' · ')}`
    );
  }

  return {
    id: originalId,
    type,
    name: title,
    poster: tmdb.image(details.poster_path),
    background: tmdb.image(details.backdrop_path, 'w1280'),
    logo: undefined,
    description: descriptionLines.filter((l) => l !== null && l !== undefined).join('\n').trim(),
    releaseInfo: year,
    year,
    runtime: runtimeMin ? `${runtimeMin} min` : undefined,
    genre: genres,
    director: directors.length ? directors : undefined,
    cast: cast.length ? cast : undefined,
    imdbRating: omdbData && omdbData.imdbRating && omdbData.imdbRating !== 'N/A'
      ? omdbData.imdbRating
      : details.vote_average
        ? Number(details.vote_average).toFixed(1)
        : undefined,
    website: details.homepage || undefined,
    status: details.status || undefined,
    country: Array.isArray(details.production_countries) && details.production_countries.length
      ? details.production_countries.map((c) => c.name).join(', ')
      : undefined,
    awards: omdbData && omdbData.Awards && omdbData.Awards !== 'N/A' ? omdbData.Awards : undefined,
    links: imdbId ? [{ name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}/` }] : undefined,
  };
}

/** Fallback desde solo OMDB (cuando TMDB no está configurado o falló). */
async function buildFromOmdb(type, imdbId) {
  const data = await omdb.getByImdbId(imdbId);
  if (!data) return null;
  const availability = await watchmode.availabilityByImdb(imdbId);

  const lines = [data.Plot && data.Plot !== 'N/A' ? data.Plot : ''];
  const ratingLine = omdb.ratingsSummary(data);
  if (ratingLine) lines.push('', ratingLine);
  if (data.Director && data.Director !== 'N/A') lines.push(`🎬 Dirección: ${data.Director}`);
  if (data.Actors && data.Actors !== 'N/A') lines.push(`🎭 Reparto: ${data.Actors}`);
  if (availability && availability.names.length) {
    lines.push('', `📺 Disponible en ${availability.region}: ${availability.names.join(' · ')}`);
  }

  return {
    id: imdbId,
    type,
    name: data.Title || imdbId,
    poster: data.Poster && data.Poster !== 'N/A' ? data.Poster : undefined,
    description: lines.filter(Boolean).join('\n').trim(),
    releaseInfo: data.Released && data.Released !== 'N/A' ? yearOf(data.Released) || data.Year : data.Year,
    year: data.Year && data.Year !== 'N/A' ? String(data.Year).slice(0, 4) : undefined,
    runtime: data.Runtime && data.Runtime !== 'N/A' ? data.Runtime : undefined,
    genre: data.Genre && data.Genre !== 'N/A' ? data.Genre.split(',').map((g) => g.trim()) : [],
    director: data.Director && data.Director !== 'N/A' ? data.Director.split(',').map((d) => d.trim()) : undefined,
    cast: data.Actors && data.Actors !== 'N/A' ? data.Actors.split(',').map((a) => a.trim()) : undefined,
    imdbRating: data.imdbRating && data.imdbRating !== 'N/A' ? data.imdbRating : undefined,
    awards: data.Awards && data.Awards !== 'N/A' ? data.Awards : undefined,
    links: [{ name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}/` }],
  };
}

/** Fallback desde solo TVMaze (series sin clave TMDB). */
async function buildFromTvmaze(tvmazeId, originalId, type) {
  const show = await tvmaze.showById(tvmazeId);
  if (!show) return null;
  const meta = tvmaze.mapShowToMeta(show);
  const imdb = show.externals && show.externals.imdb;
  const [omdbData, availability] = await Promise.all([
    imdb ? omdb.getByImdbId(imdb) : Promise.resolve(null),
    imdb ? watchmode.availabilityByImdb(imdb) : Promise.resolve(null),
  ]);
  const lines = [meta.description];
  const ratingLine = omdb.ratingsSummary(omdbData);
  if (ratingLine) lines.push('', ratingLine);
  if (availability && availability.names.length) {
    lines.push('', `📺 Disponible en ${availability.region}: ${availability.names.join(' · ')}`);
  }
  return {
    ...meta,
    id: originalId,
    type: type || 'series',
    description: lines.filter(Boolean).join('\n').trim(),
    imdbRating: omdbData && omdbData.imdbRating && omdbData.imdbRating !== 'N/A'
      ? omdbData.imdbRating
      : undefined,
  };
}

/** Punto de entrada: construye el meta para cualquier id soportado. */
async function buildMeta(type, id) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;

  // ── IDs de TMDB explícitos ──────────────────────────────────────────────
  const tmdbMatch = cleanId.match(/^tmdb:(movie|tv):(\d+)$/);
  if (tmdbMatch) {
    const mediaType = tmdbMatch[1];
    const tmdbId = tmdbMatch[2];
    const metaType = mediaType === 'tv' ? 'series' : 'movie';
    return buildFromTmdb(metaType, tmdbId, cleanId);
  }

  // ── IDs de TVMaze explícitos ────────────────────────────────────────────
  const tvmazeMatch = cleanId.match(/^tvmaze:(\d+)$/);
  if (tvmazeMatch) {
    return buildFromTvmaze(tvmazeMatch[1], cleanId, type || 'series');
  }

  // ── IMDb ids (flujo estándar de Stremio) ────────────────────────────────
  if (cleanId.startsWith('tt')) {
    if (config.tmdbConfigured) {
      const { movie, tv } = await tmdb.findByImdbId(cleanId);
      const preferred = type === 'series' ? tv : movie;
      const fallback = type === 'series' ? movie : tv;
      const hit = preferred || fallback;
      if (hit) {
        const mediaType = preferred ? (type === 'series' ? 'tv' : 'movie') : (fallback === tv ? 'tv' : 'movie');
        const resolvedType = mediaType === 'tv' ? 'series' : 'movie';
        return buildFromTmdb(resolvedType, hit.id, cleanId);
      }
    }
    // Sin TMDB: series vía TVMaze, películas vía OMDB
    if (type === 'series') {
      const show = await tvmaze.showLookupByImdb(cleanId);
      if (show) return buildFromTvmaze(show.id, cleanId, 'series');
    }
    const fromOmdb = await buildFromOmdb(type || 'movie', cleanId);
    if (fromOmdb) return fromOmdb;
    // Último recurso: ficha mínima válida
    return {
      id: cleanId,
      type: type || 'movie',
      name: cleanId,
      description: 'Metadatos no disponibles. Revisa las claves TMDB_API_KEY / OMDB_API_KEY.',
    };
  }

  return null;
}

module.exports = { buildMeta };
