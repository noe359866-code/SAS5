'use strict';

// VideoApp ofrece un iframe Vimeos por TMDB, no un enlace directo de Stremio.
const { load } = require('cheerio');
const config = require('./config');
const { providerHttp } = require('./providerHttp');
const { allowedVideoUrl, resolveVimeosEmbed } = require('./vimeos');
const { hitMatches } = require('./streamChoices');

const BASE = 'https://videoapp.zip';

function videoappPath(resolved) {
  const id = Number(resolved?.tmdbId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const series = resolved.mediaType === 'series';
  if (resolved.tmdbType && resolved.tmdbType !== (series ? 'tv' : 'movie')) return null;
  if (!series) return `/e/movie/${id}`;
  if (!Number.isSafeInteger(resolved.season) || resolved.season < 1 ||
      !Number.isSafeInteger(resolved.episode) || resolved.episode < 1) return null;
  return `/e/tv/${id}/${resolved.season}/${resolved.episode}`;
}

function frameFromPage(html) {
  const $ = load(html);
  const frames = $('iframe#frame').toArray();
  if (frames.length !== 1) return null;
  const frame = $(frames[0]);
  const src = frame.attr('src');
  if (!src || !allowedVideoUrl(src)) return null;
  const url = new URL(src);
  // Solo el visor conocido, no URLs de seguimiento, anuncios o medios arbitrarios.
  if (!/^\/embed-[a-z0-9]+\.html$/i.test(url.pathname)) return null;
  return { url: url.href, audioLabel: frame.attr('data-language') || frame.attr('data-lang') || '' };
}

async function searchVideoApp(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const path = videoappPath(resolved);
  if (!path) return { skipped: 'tmdb-or-episode-required' };
  const http = providerHttp(timeoutMs, 4);
  const html = await http.text(BASE + path, { headers: { Accept: 'text/html' }, maxBytes: 1024 * 1024 });
  const frame = frameFromPage(html);
  if (!frame) return { hits: [], reason: 'no-supported-embed' };
  const media = await resolveVimeosEmbed(frame.url, `${BASE}/`, http);
  if (!media) return { hits: [], reason: 'no-supported-media' };
  // La página de muestra no indica el idioma; los subtítulos no prueban el audio.
  if (!hitMatches({ audioLabel: frame.audioLabel }, null)) return { hits: [], reason: 'audio-unverified' };
  const ep = resolved.mediaType === 'series' ? ` S${String(resolved.season).padStart(2, '0')}E${String(resolved.episode).padStart(2, '0')}` : '';
  return { hits: [{ provider: 'videoapp', title: `${resolved.title}${ep} VideoApp`, url: media.master,
    quality: 'HLS', resolution: media.resolution, verification: media.verification, expiresAt: media.expiresAt,
    audioLabel: frame.audioLabel, subtitles: media.subtitles || [], relevant: true }] };
}

module.exports = { BASE, videoappPath, frameFromPage, searchVideoApp };
