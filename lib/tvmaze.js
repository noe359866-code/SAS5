'use strict';

/**
 * Cliente TVMaze (https://www.tvmaze.com/api — gratuita, sin clave).
 * Usos: catálogo "En TV hoy" (web schedule) y ficha de series por IMDb id
 * o por id de TVMaze.
 */

const cache = require('./cache');
const { fetchJson } = require('./http');

const BASE_URL = 'https://api.tvmaze.com';

async function getJson(path, ttlSeconds, timeoutMs = 8000) {
  const url = BASE_URL + path;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  return cache.coalesce(`load:${url}`, async () => {
    const again = cache.get(url);
    if (again !== undefined) return again;
    try {
      const data = await fetchJson(url, { timeoutMs });
      cache.set(url, data, ttlSeconds);
      return data;
    } catch (err) {
      if (err.status === 404 && (path.startsWith('/lookup/shows?') || path.startsWith('/shows/'))) {
        cache.set(url, null, 3600);
        return null;
      }
      console.error('[TVMaze] Error en', path, '->', err.message);
      return null;
    }
  });
}

const { cleanTitle, cleanOverview } = require('./sanitize');

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function showById(id) {
  return getJson(`/shows/${id}`, 24 * 3600);
}

async function showEpisodes(id, timeoutMs) {
  return getJson(`/shows/${id}/episodes`, 6 * 3600, timeoutMs);
}

/** Busca una serie por IMDb id (tt...). Devuelve null si no existe. */
async function showLookupByImdb(imdbId, timeoutMs = 8000) {
  if (!imdbId || !imdbId.startsWith('tt')) return null;
  return getJson(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, 24 * 3600, timeoutMs);
}

function mapShowToMeta(show, extraDescription) {
  if (!show) return null;
  const imdb = show.externals && show.externals.imdb ? show.externals.imdb : null;
  const channel = (show.network && show.network.name) || (show.webChannel && show.webChannel.name) || '';
  return {
    id: imdb || `tvmaze:${show.id}`,
    type: 'series',
    // TVMaze también es editable: mismo saneado que en TMDB.
    name: cleanTitle(show.name) || show.name,
    poster: show.image ? show.image.original || show.image.medium : undefined,
    description:
      extraDescription ||
      cleanOverview(stripHtml(show.summary)) ||
      (channel ? `Serie en emisión en ${channel}` : 'Serie'),
    releaseInfo: show.premiered ? show.premiered.slice(0, 4) : '',
    // Fecha completa: Stremio ordena y agrupa por `released`. Solo si el día
    // es real: `Date.parse('2020')` da el 1 de enero y eso inventaría un
    // estreno. `premiered` a veces llega como «2020».
    ...(isFullDate(show.premiered) ? { released: new Date(show.premiered).toISOString() } : {}),
    genre: Array.isArray(show.genres) ? show.genres : [],
    runtime: show.averageRuntime ? `${show.averageRuntime} min` : undefined,
    website: show.officialSite || undefined,
  };
}

/** `2020-03-01` sí; `2020`, `01/03/2020` o vacío, no. */
function isFullDate(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value || '')) && Number.isFinite(Date.parse(value));
}

/**
 * Catálogo "Series en TV/Streaming hoy" (web schedule).
 * Empareja emisiones del día con su serie y deduplica.
 */
async function airingToday() {
  const date = new Date().toISOString().slice(0, 10);
  let episodes = await getJson(`/schedule/web?date=${date}`, 3600);
  if (!Array.isArray(episodes) || episodes.length === 0) {
    episodes = await getJson(`/schedule?country=US&date=${date}`, 3600);
  }
  if (!Array.isArray(episodes) || episodes.length === 0) return [];

  const episodesByShow = new Map();
  const showByIdMap = new Map();

  for (const ep of episodes) {
    let showId = null;
    let embeddedShow = null;
    if (ep._embedded && ep._embedded.show) embeddedShow = ep._embedded.show;
    else if (ep.show) embeddedShow = ep.show;
    else if (ep._links && ep._links.show && ep._links.show.href) {
      const tail = ep._links.show.href.split('/').filter(Boolean).pop();
      showId = tail ? parseInt(tail, 10) : null;
    }
    if (embeddedShow) showId = embeddedShow.id;
    if (!showId || Number.isNaN(showId)) continue;

    if (embeddedShow) showByIdMap.set(showId, embeddedShow);
    if (!episodesByShow.has(showId)) episodesByShow.set(showId, []);
    episodesByShow.get(showId).push(ep);
  }

  const showIds = [...episodesByShow.keys()].slice(0, 60);
  await Promise.all(
    showIds.map(async (id) => {
      if (!showByIdMap.has(id)) showByIdMap.set(id, await showById(id));
    })
  );

  const metas = [];
  for (const id of showIds) {
    const show = showByIdMap.get(id);
    if (!show) continue;
    const channel =
      (show.network && show.network.name) || (show.webChannel && show.webChannel.name) || 'TV';
    const todayEpisodes = (episodesByShow.get(id) || []).slice(0, 3);
    const episodeLines = todayEpisodes.map((ep) => {
      const code = ep.season != null ? `S${ep.season}E${ep.number}` : '';
      return `• ${ep.airtime || ''} ${code} ${ep.name || ''}`.replace(/\s+/g, ' ').trim();
    });
    const description = [
      `Hoy en ${channel}:`,
      ...episodeLines,
      '',
      cleanOverview(stripHtml(show.summary)),
    ]
      .filter((line) => line !== undefined)
      .join('\n')
      .trim();
    metas.push(mapShowToMeta(show, description));
    if (metas.length >= 40) break;
  }
  return metas;
}

module.exports = { airingToday, showLookupByImdb, showById, showEpisodes, mapShowToMeta, stripHtml };
