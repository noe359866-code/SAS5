'use strict';

/**
 * Constructor de metadatos (meta handler).
 * Encadena fuentes con degradación elegante:
 *   1) TMDB    (ficha principal + créditos)     — requiere clave TMDB
 *   2) TVMaze  (series: argumento, géneros)     — sin clave
 *   3) OMDB    (IMDB / Rotten Tomatoes / MC)    — requiere clave OMDB
 *
 * IDs soportados:
 *   tt1234567               → IMDb id (flujo normal de Stremio)
 *   tmdb:movie:123 / tmdb:tv:123 → id de TMDB (fallback del catálogo)
 *   tmdb:123 (sin tipo)     → se desambigua con el `type` de la petición
 *   tvmaze:123              → id de TVMaze (catálogo «En TV hoy»)
 */

const config = require('./config');
const cache = require('./cache');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');
const omdb = require('./omdb');
const { cinemetaVideos, tmdbVideos, tvmazeVideos } = require('./episodes');
const { cleanTitle, cleanOverviewLimited } = require('./sanitize');
const { languageLabel, countryLabel, durationText, boxOfficeText, akaText } = require('./metaText');

function yearOf(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : '';
}

async function buildFromTmdb(type, tmdbId, originalId, cfg) {
  const lang = cfg && cfg.lang;
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const append = mediaType === 'movie' ? 'credits' : 'aggregate_credits,external_ids';
  const details = await tmdb.tmdbGet(`/${mediaType}/${tmdbId}`, { append_to_response: append }, config.cacheTtl, lang);
  if (!details) return null;

  // Productoras: la ficha de TMDB ya incluye sus nombres, así que no hace
  // falta ninguna petición extra.
  const productionCompanies = (Array.isArray(details.production_companies) ? details.production_companies : [])
    .map((company) => cleanTitle(company?.name) || company?.name)
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .slice(0, 4);

  let imdbId = /^tt\d+$/.test(originalId) ? originalId : details.imdb_id || details.external_ids?.imdb_id;
  if (!imdbId && mediaType === 'movie') {
    const ext = await tmdb.externalIds(mediaType, tmdbId);
    imdbId = ext && ext.imdb_id ? ext.imdb_id : null;
  }

  const [omdbData, videos] = await Promise.all([
    imdbId ? omdb.getByImdbId(imdbId) : null,
    mediaType === 'tv' ? tmdbVideos(originalId, imdbId, tmdbId, details.seasons, lang) : undefined,
  ]);

  // Saneado: TMDB es editable y a veces el título o la sinopsis llevan
  // publicidad incrustada. Ver lib/sanitize.js.
  const title = cleanTitle(details.title || details.name || '') || originalId;
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
  // En series, `aggregate_credits.crew` no trae `job`: la creación llega en
  // `created_by`. Antes la ficha de una serie salía sin dirección ni creador.
  const directors = Array.isArray(credits.crew) && mediaType === 'movie'
    ? credits.crew.filter((c) => c.job === 'Director').map((c) => c.name).filter(Boolean)
    : [];
  const creators = Array.isArray(details.created_by)
    ? details.created_by.map((c) => c?.name).filter(Boolean)
    : [];
  const directorsLabel = directors.length ? 'Dirección' : 'Creación';
  const directorNames = directors.length ? directors : creators;

  const ratingLine =
    omdb.ratingsSummary(omdbData) ||
    (details.vote_average ? `⭐ TMDB ${Number(details.vote_average).toFixed(1)}/10` : null);

  // Línea de ficha técnica: lo que el usuario necesita para decidir sin abrir
  // otra app (idioma original, país, duración). Cada dato solo si existe.
  const countries = Array.isArray(details.production_countries)
    ? details.production_countries.map((c) => c?.name || c?.iso_3166_1).filter(Boolean)
    : [];
  const language = languageLabel(details.original_language);
  // La duración no se repite aquí: Stremio ya la pinta junto al año con el
  // campo `runtime`. Sí se usa `durationText` en la ficha de OMDB, que no
  // tiene ese campo estructurado.
  const techLine = [
    language ? `🌐 Idioma original: ${language}` : '',
    countries.length ? `📍 ${countryLabel(countries) || countries.slice(0, 3).join(', ')}` : '',
  ].filter(Boolean).join('  ·  ');

  // Próximo episodio: `next_episode_to_air` ya viene en la ficha de TMDB, sin
  // peticiones extra. Se anuncia en la descripción porque Stremio no tiene un
  // campo propio para «el próximo capítulo».
  const next = mediaType === 'tv' ? details.next_episode_to_air : null;
  const nextLine = next && Number.isFinite(next.season_number) && Number.isFinite(next.episode_number)
    ? `📅 Próximo episodio: T${next.season_number}E${next.episode_number}`
      + (next.air_date ? ` · ${next.air_date}` : '')
      + (cleanTitle(next.name) ? ` · «${cleanTitle(next.name)}»` : '')
    : '';

  // Sinopsis con tope: 700 caracteres (ver lib/sanitize.js).
  const descriptionLines = [cleanOverviewLimited(details.overview) || ''];
  if (ratingLine) descriptionLines.push('', ratingLine);
  if (techLine) descriptionLines.push(techLine);
  const money = mediaType === 'movie' ? boxOfficeText(details) : '';
  if (money) descriptionLines.push(money);
  const aka = akaText(title, details.original_title || details.original_name);
  if (aka) descriptionLines.push(aka);
  if (nextLine) descriptionLines.push(nextLine);
  if (directorNames.length) descriptionLines.push(`🎬 ${directorsLabel}: ${directorNames.join(', ')}`);
  if (cast.length) descriptionLines.push(`🎭 Reparto: ${cast.join(', ')}`);

  // Fecha completa de estreno: Stremio ordena y agrupa por `released`, y con
  // `releaseInfo` («2010») no puede situar la obra en una cronología.
  const released = Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined;
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
    ...(released ? { released } : {}),
    runtime: runtimeMin ? `${runtimeMin} min` : undefined,
    genre: genres,
    director: directorNames.length ? directorNames : undefined,
    cast: cast.length ? cast : undefined,
    ...(productionCompanies.length ? { productionCompanies } : {}),
    imdbRating: omdbData && omdbData.imdbRating && omdbData.imdbRating !== 'N/A'
      ? omdbData.imdbRating
      : details.vote_average
        ? Number(details.vote_average).toFixed(1)
        : undefined,
    website: details.homepage || undefined,
    status: details.status || undefined,
    // Nombre del país en español (TMDB solo da el código ISO cuando la ficha
    // llega en crudo); si el código no está en la tabla, se usa el de la API.
    country: countries.length
      ? countries.map((code) => countryLabel(code) || code).filter((name, i, list) => list.indexOf(name) === i).join(', ')
      : undefined,
    awards: omdbData && omdbData.Awards && omdbData.Awards !== 'N/A' ? omdbData.Awards : undefined,
    links: imdbId ? [{ name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}/` }] : undefined,
    ...(videos ? { videos } : {}),
  };
}



/** Fallback desde solo OMDB (cuando TMDB no está configurado o falló). */
async function buildFromOmdb(type, imdbId) {
  const data = await omdb.getByImdbId(imdbId);
  if (!data) return null;

  const lines = [data.Plot && data.Plot !== 'N/A' ? data.Plot : ''];
  const ratingLine = omdb.ratingsSummary(data);
  if (ratingLine) lines.push('', ratingLine);
  if (data.Director && data.Director !== 'N/A') lines.push(`🎬 Dirección: ${data.Director}`);
  if (data.Actors && data.Actors !== 'N/A') lines.push(`🎭 Reparto: ${data.Actors}`);

  return {
    id: imdbId,
    type,
    name: data.Title || imdbId,
    poster: data.Poster && data.Poster !== 'N/A' ? data.Poster : undefined,
    description: lines.filter(Boolean).join('\n').trim(),
    releaseInfo: data.Released && data.Released !== 'N/A' ? yearOf(data.Released) || data.Year : data.Year,
    year: data.Year && data.Year !== 'N/A' ? String(data.Year).slice(0, 4) : undefined,
    // OMDB da la fecha en texto («16 Jul 2010»); se publica solo si se puede
    // interpretar, sin adivinar el formato.
    ...(Number.isFinite(Date.parse(data.Released)) ? { released: new Date(data.Released).toISOString() } : {}),
    runtime: data.Runtime && data.Runtime !== 'N/A' ? data.Runtime : undefined,
    genre: data.Genre && data.Genre !== 'N/A' ? data.Genre.split(',').map((g) => g.trim()) : [],
    director: data.Director && data.Director !== 'N/A' ? data.Director.split(',').map((d) => d.trim()) : undefined,
    cast: data.Actors && data.Actors !== 'N/A' ? data.Actors.split(',').map((a) => a.trim()) : undefined,
    imdbRating: data.imdbRating && data.imdbRating !== 'N/A' ? data.imdbRating : undefined,
    awards: data.Awards && data.Awards !== 'N/A' ? data.Awards : undefined,
    ...(type === 'series' ? { videos: await cinemetaVideos(imdbId, imdbId) } : {}),
    links: [{ name: 'IMDb', category: 'imdb', url: `https://www.imdb.com/title/${imdbId}/` }],
  };
}

/** Fallback desde solo TVMaze (series sin clave TMDB). */
async function buildFromTvmaze(show, originalId, type) {
  if (!show) return null;
  const meta = tvmaze.mapShowToMeta(show);
  const imdb = show.externals && show.externals.imdb;
  const [omdbData, videos] = await Promise.all([
    imdb ? omdb.getByImdbId(imdb) : null,
    tvmazeVideos(originalId, show.id),
  ]);
  const lines = [meta.description];
  const ratingLine = omdb.ratingsSummary(omdbData);
  if (ratingLine) lines.push('', ratingLine);
  return {
    ...meta,
    id: originalId,
    type: type || 'series',
    videos,
    description: lines.filter(Boolean).join('\n').trim(),
    imdbRating: omdbData && omdbData.imdbRating && omdbData.imdbRating !== 'N/A'
      ? omdbData.imdbRating
      : undefined,
  };
}

/** Punto de entrada: construye el meta para cualquier id soportado (cacheado + coalescido). */
async function buildMeta(type, id, cfg) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  const effLang = (cfg && cfg.lang) || config.tmdbLanguage || 'es';
  const effRegion = (cfg && cfg.region) || config.watchRegion || 'NI';
  const apiFp = `${config.tmdbConfigured ? 1 : 0}${config.omdbConfigured ? 1 : 0}`;
  const cacheKey = `meta:v1:${type || ''}:${cleanId}:${effLang}:${effRegion}:${apiFp}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  return cache.coalesce(`load:${cacheKey}`, async () => {
    const again = cache.get(cacheKey);
    if (again !== undefined) return again;
    const result = await buildMetaUncached(type, cleanId, cfg);
    if (result && result.name && result.name !== cleanId && (result.type !== 'series' || result.videos?.length)) {
      cache.set(cacheKey, result, Math.max(3600, config.cacheTtl || 21600));
    }
    return result;
  });
}

async function buildMetaUncached(type, cleanId, cfg) {
  const lang = cfg && cfg.lang;

  // ── IDs de TMDB explícitos ──────────────────────────────────────────────
  const tmdbMatch = cleanId.match(/^tmdb:(movie|tv|series):(\d+)$/);
  if (tmdbMatch) {
    const mediaType = tmdbMatch[1];
    const tmdbId = tmdbMatch[2];
    const metaType = mediaType === 'movie' ? 'movie' : 'series';
    return buildFromTmdb(metaType, tmdbId, cleanId, cfg);
  }

  // ── `tmdb:<num>` sin tipo (lo que emite el propio catálogo cuando el ítem
  //    no tiene IMDb id): el `type` de la petición desambigua película/serie.
  const bareTmdb = cleanId.match(/^tmdb:(\d+)$/);
  if (bareTmdb) {
    return buildFromTmdb(type === 'series' ? 'series' : 'movie', bareTmdb[1], cleanId, cfg);
  }

  // ── `tvdb:` no está soportado (sin cliente TVDB desde 1c568f6). Se deja
  //    constancia en vez de devolver null sin explicación.
  if (/^tvdb:/.test(cleanId)) {
    console.warn('[Meta] id de TVDB no soportado:', type, cleanId);
    return null;
  }

  // ── IDs de TVMaze explícitos ────────────────────────────────────────────
  const tvmazeMatch = cleanId.match(/^tvmaze:(\d+)$/);
  if (tvmazeMatch) {
    return buildFromTvmaze(await tvmaze.showById(tvmazeMatch[1]), cleanId, type || 'series');
  }

  // ── IMDb ids (flujo estándar de Stremio) ────────────────────────────────
  if (cleanId.startsWith('tt')) {
    if (config.tmdbConfigured) {
      const { movie, tv } = await tmdb.findByImdbId(cleanId, lang);
      const preferred = type === 'series' ? tv : movie;
      const fallback = type === 'series' ? movie : tv;
      const hit = preferred || fallback;
      if (hit) {
        const mediaType = preferred ? (type === 'series' ? 'tv' : 'movie') : (fallback === tv ? 'tv' : 'movie');
        const resolvedType = mediaType === 'tv' ? 'series' : 'movie';
        const fromTmdb = await buildFromTmdb(resolvedType, hit.id, cleanId, cfg);
        if (fromTmdb) return fromTmdb;
      }
    }
    // Sin TMDB: series vía TVMaze, resto vía OMDB
    if (type === 'series') {
      const show = await tvmaze.showLookupByImdb(cleanId);
      if (show) return buildFromTvmaze(show, cleanId, 'series');
    }
    const fromOmdb = await buildFromOmdb(type || 'movie', cleanId);
    if (fromOmdb) return fromOmdb;
    // Último recurso: ficha mínima válida
    return {
      id: cleanId,
      type: type || 'movie',
      name: cleanId,
      // Solo se indica la causa cuando el despliegue realmente no tiene
      // claves; si las tiene, este texto culparía a una configuración correcta.
      description: config.tmdbConfigured || config.omdbConfigured
        ? 'Metadatos no disponibles para este título en las fuentes consultadas.'
        : 'Metadatos no disponibles. Revisa las claves TMDB_API_KEY / OMDB_API_KEY.',
    };
  }

  return null;
}

module.exports = { buildMeta };
