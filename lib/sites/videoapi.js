'use strict';

/**
 * videoapi.la — API de embeds por TMDb ID (`/e/movie/<id>` y
 * `/e/tv/<id>/<temporada>/<episodio>`).
 *
 * Comparte el mismo reproductor y visor Vimeos que `pelisjuanita.js`:
 *   1. `GET https://videoapi.la/e/movie/<tmdb_id>` (o `/e/tv/<tmdb_id>/<S>/<E>`)
 *      con `Referer: https://videoapi.la/` → `<iframe id="frame">` de `vimeos.net`.
 *   2. El embed de Vimeos entrega el HLS firmado (`master.m3u8?t=…&e=…`),
 *      declara la versión en `subDub` (`sub`, `lat`, `dub`, `cas`) y publica los
 *      subtítulos `.vtt` en `default_subs`.
 */

const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { UA } = require('../extractors');
const { audioOf, frameOf, subDubOf, mediaOfEmbed } = require('./pelisjuanita');

const BASE = 'https://videoapi.la';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9',
};
const MAX_HTML = 1024 * 1024;

function playerUrlOf(resolved) {
  const tmdbId = Number(resolved?.tmdbId);
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
  if (resolved.mediaType === 'movie') return `${BASE}/e/movie/${tmdbId}`;
  const season = Number(resolved?.season);
  const episode = Number(resolved?.episode);
  if (!(season > 0 && episode > 0)) return null;
  return `${BASE}/e/tv/${tmdbId}/${season}/${episode}`;
}

async function searchVideoApi(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(Number(resolved.season) > 0 && Number(resolved.episode) > 0)) return { skipped: 'episode-required' };
  const playerUrl = playerUrlOf(resolved);
  if (!playerUrl) return { hits: [], reason: 'no-tmdb-id' };

  const http = providerHttp(timeoutMs, 4);

  let page;
  try {
    page = await http.text(playerUrl, { headers: { ...HEADERS, Referer: `${BASE}/` }, maxBytes: MAX_HTML });
  } catch (err) {
    if (isNotFound(err, playerUrl)) return { hits: [], reason: 'no-players' };
    throw err;
  }

  const frame = frameOf(page);
  if (!frame) return { hits: [], reason: 'no-players' };

  let embed;
  try {
    embed = await http.text(frame, { headers: { ...HEADERS, Referer: `${BASE}/` }, maxBytes: MAX_HTML });
  } catch (err) {
    if (isNotFound(err, frame)) return { hits: [], reason: 'no-extractable-embed' };
    throw err;
  }

  const audio = audioOf(subDubOf(embed));
  const media = mediaOfEmbed(embed);
  if (!media) return { hits: [], reason: 'no-extractable-embed' };
  if (!audio) return { hits: [], reason: 'audio-unverified', notes: { subDub: subDubOf(embed) || null } };

  const ep = series ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}` : '';
  return {
    hits: [{
      provider: 'videoapi',
      title: `${resolved.title || 'VideoAPI'}${ep} VideoAPI`,
      url: media.master,
      quality: 'HLS',
      resolution: media.resolution || null,
      audioLabel: audio,
      ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}),
      subtitles: media.subtitles || [],
    }],
  };
}

module.exports = {
  BASE,
  playerUrlOf,
  searchVideoApi,
};
