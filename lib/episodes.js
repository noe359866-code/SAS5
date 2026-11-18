'use strict';

const config = require('./config');
const cinemeta = require('./cinemeta');
const tmdb = require('./tmdb');
const tvmaze = require('./tvmaze');
const { cleanTitle, cleanOverview } = require('./sanitize');

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/** Mantiene el ID de la ficha: esos son los IDs que entiende /stream/series/. */
function toVideos(showId, episodes) {
  const videos = new Map();
  for (const { season, episode, title, aired, overview, thumbnail } of episodes) {
    if (!positiveInteger(season) || !positiveInteger(episode)) continue;
    const id = `${showId}:${season}:${episode}`;
    if (videos.has(id)) continue;
    const date = Date.parse(aired || '');
    videos.set(id, {
      id, season, episode,
      title: cleanTitle(title) || `Episodio ${episode}`,
      released: Number.isFinite(date) ? new Date(date).toISOString() : undefined,
      overview: cleanOverview(overview) || undefined,
      thumbnail,
    });
  }
  return [...videos.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

async function cinemetaVideos(showId, imdbId) {
  const meta = await cinemeta.lookup('series', imdbId, config.streamFallbackTimeoutMs);
  if (!Array.isArray(meta?.videos)) return [];
  return toVideos(showId, meta.videos.filter(Boolean).map((video) => ({
    season: video.season, episode: video.episode ?? video.number,
    title: video.title || video.name, aired: video.released || video.firstAired,
    overview: video.overview, thumbnail: video.thumbnail,
  })));
}

async function tmdbVideos(showId, imdbId, tmdbId, seasons, lang) {
  // Con IMDb se obtiene la lista y la numeración de Stremio en un solo GET.
  const fromCinemeta = await cinemetaVideos(showId, imdbId);
  if (fromCinemeta.length || !Array.isArray(seasons)) return fromCinemeta;

  // Series sin lista en Cinemeta: usa episodios reales de TMDB, sin superar
  // el presupuesto de subpeticiones del Worker ni adivinar por episode_count.
  const numbers = [...new Set(seasons.map((season) => season?.season_number).filter(positiveInteger))]
    .sort((a, b) => a - b).slice(0, 12);
  const episodes = [];
  for (let i = 0; i < numbers.length; i += 4) {
    const batch = await Promise.all(numbers.slice(i, i + 4).map((season) => (
      tmdb.tmdbGet(`/tv/${tmdbId}/season/${season}`, {}, config.cacheTtl, lang, config.streamFallbackTimeoutMs)
    )));
    for (const result of batch) {
      if (Array.isArray(result?.episodes)) episodes.push(...result.episodes);
    }
  }
  return toVideos(showId, episodes.filter(Boolean).map((ep) => ({
    season: ep.season_number, episode: ep.episode_number, title: ep.name, aired: ep.air_date,
    overview: ep.overview, thumbnail: tmdb.image(ep.still_path, 'w300'),
  })));
}

async function tvmazeVideos(showId, tvmazeId) {
  const episodes = await tvmaze.showEpisodes(tvmazeId, config.streamFallbackTimeoutMs);
  if (!Array.isArray(episodes)) return [];
  return toVideos(showId, episodes.filter(Boolean).map((ep) => ({
    season: ep.season, episode: ep.number, title: ep.name, aired: ep.airstamp || ep.airdate,
    overview: tvmaze.stripHtml(ep.summary), thumbnail: ep.image?.medium,
  })));
}

module.exports = { cinemetaVideos, tmdbVideos, tvmazeVideos };
