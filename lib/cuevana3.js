'use strict';

const { load } = require('cheerio');
const config = require('./config');
const { providerHttp } = require('./providerHttp');
const { hitMatches } = require('./streamChoices');
const { resolveVimeosEmbed, proxiedHls, REFERER } = require('./vimeos');

const BASE = 'https://cuevanas3.pro';
const PLAYER_ALIAS = 'https://cuevana3.gs';
const VIMEOS_ORIGIN = new URL(REFERER).origin;
const noResult = (reason) => ({ hits: [], reason });
const SLUG = /^[a-z0-9-]{1,180}$/i;
const YEAR = /\s*\(((?:19|20)\d{2})\)\s*$/;
const norm = (value) => typeof value === 'string'
  ? value.replace(YEAR, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';

function idOf(value) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function api(http, path, params, referer = BASE + '/') {
  const url = new URL(`/wp-api/v1/${path}`, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const payload = JSON.parse(await http.text(url.href, { headers: { Accept: 'application/json', Referer: referer }, maxBytes: 512 * 1024 }));
  if (payload?.error === true && payload.message === 'empty') return null;
  if (payload?.error !== false || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('Respuesta inesperada de la API pública de Cuevana 3');
  }
  return payload.data;
}

function matchesTitle(post, type, wanted, year) {
  if (post?.type !== type || !idOf(post._id) || typeof post.slug !== 'string' || !SLUG.test(post.slug)) return false;
  if (![norm(post.title), norm(post.original_title)].includes(wanted)) return false;
  const years = new Set([YEAR.exec(post.title)?.[1], /^(\d{4})-\d\d-\d\d$/.exec(post.release_date)?.[1]].filter(Boolean));
  return !year || (years.size === 1 && years.has(String(year)));
}

function uniquePosts(posts, matches) {
  return [...new Map(posts.filter(matches).map((post) => [`${idOf(post._id)}:${post.slug}`, post])).values()];
}

function episodeMatches(post, resolved) {
  return post?.type === 'episodes' && idOf(post._id) && typeof post.slug === 'string' && SLUG.test(post.slug)
    && idOf(post.season_number) === idOf(resolved.season) && idOf(post.episode_number) === idOf(resolved.episode)
    && !(idOf(resolved.tmdbId) && idOf(post.show_id) && idOf(post.show_id) !== idOf(resolved.tmdbId));
}

async function exactEpisode(http, show, resolved, showPage) {
  const showId = idOf(show._id);
  let found;
  for (let page = 1; page <= 3; page++) {
    const listing = await api(http, 'single/episodes/list', { _id: showId, season: resolved.season, page, postsPerPage: 12 }, showPage);
    if (!listing) break;
    if (!Array.isArray(listing.posts)) throw new Error('Lista de episodios inesperada de Cuevana 3');
    const candidates = uniquePosts(listing.posts, (post) => episodeMatches(post, resolved));
    if (candidates.length > 1) break;
    if (candidates.length === 1) { found = candidates[0]; break; }
    if (!(idOf(listing.pagination?.last_page) > page)) break;
  }
  if (!found) return null;
  const page = `${BASE}/episodio/${found.slug}/`;
  const detail = await api(http, 'single/episodes', { slug: found.slug, postType: 'episodes' }, page);
  if (detail?.serie?.type !== 'tvshows' || idOf(detail.serie._id) !== showId || detail.serie.slug !== show.slug
      || !episodeMatches(detail.episode, resolved) || idOf(detail.episode._id) !== idOf(found._id) || detail.episode.slug !== found.slug) return null;
  return { id: idOf(found._id), page };
}

function playerUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    const query = url.searchParams;
    if (![BASE, PLAYER_ALIAS].includes(url.origin) || url.username || url.password || url.hash || url.pathname !== '/player.php'
        || [...query].length !== 2 || !/^[a-z0-9_-]{16,512}$/i.test(query.get('t') || '') || query.get('server') !== 'vimeos') return null;
    // Alias publicado en la API; su redirect observado conserva ruta y query.
    // Se usa el destino canónico fijo, sin seguir un Location arbitrario.
    return BASE + url.pathname + url.search;
  } catch { return null; }
}

async function readPlayer(url, audioLabel, item, title, http) {
  const html = await http.text(url, { headers: { Accept: 'text/html', Referer: item.page }, maxBytes: 512 * 1024 });
  const $ = load(html);
  const frames = new Set();
  for (const el of $('iframe[src],iframe[data-src]').toArray()) {
    const frameEl = $(el);
    if (frameEl.closest('[download],[id*="trailer" i],[class*="trailer" i]').length) continue;
    try {
      const frame = new URL(frameEl.attr('data-src') || frameEl.attr('src'), url);
      if (frame.origin === VIMEOS_ORIGIN && !frame.username && !frame.password && !frame.hash
          && /^\/embed[-/][a-z0-9_-]{1,128}(?:\.html)?\/?$/i.test(frame.pathname)) frames.add(frame.href);
    } catch { /* no es un visor HTTPS publicado */ }
  }
  if (frames.size !== 1) return noResult('embeds-only');
  const media = await resolveVimeosEmbed([...frames][0], BASE + '/', http);
  if (!media || media.verification !== 'manifest-ok') return noResult(media?.verification || 'manifest-unavailable');
  return { hits: [{ provider: 'cuevana3', title, audioLabel, url: proxiedHls(media.master), directUrl: media.master,
    referer: REFERER, quality: 'HLS', resolution: media.resolution, expiresAt: media.expiresAt,
    verification: media.verification, subtitles: media.subtitles }] };
}

async function searchCuevana3(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  const series = resolved.mediaType === 'series';
  if (series && !(idOf(resolved.season) && idOf(resolved.episode))) return { skipped: 'episode-required' };
  const http = providerHttp(timeoutMs);
  const postType = series ? 'tvshows' : 'movies';
  let post;
  for (const name of new Set([title, resolved.altTitle].filter(Boolean))) {
    const wanted = norm(name);
    if (wanted.length < 3) continue;
    const data = await api(http, 'search', { q: name.trim(), page: 1, postType, postsPerPage: 18 });
    if (!data) continue;
    if (!Array.isArray(data.posts)) throw new Error('Búsqueda inesperada de Cuevana 3');
    const candidates = uniquePosts(data.posts, (item) => matchesTitle(item, postType, wanted, resolved.year));
    if (candidates.length === 1) { post = candidates[0]; break; }
  }
  if (!post) return noResult('no-match');
  const page = `${BASE}/${series ? 'series' : 'peliculas'}/${post.slug}/`;
  const item = series ? await exactEpisode(http, post, resolved, page) : { id: idOf(post._id), page };
  if (!item) return noResult('no-episode');
  const player = await api(http, 'player', { postId: item.id, demo: 0 }, item.page);
  if (!player) return noResult('no-compatible-player');
  if (!Array.isArray(player.embeds)) throw new Error('Lista de reproductores inesperada de Cuevana 3');
  const frames = new Map();
  for (const entry of player.embeds) {
    const url = playerUrl(entry?.url);
    if (url && typeof entry.lang === 'string' && !/\b(?:dual|tr[aá]iler|descarga|download)\b/i.test(entry.lang)
        && hitMatches({ url, audioLabel: entry.lang }, null)) frames.set(url, entry.lang);
  }
  if (!frames.size) return noResult(player.embeds.length ? 'embeds-only' : 'no-compatible-player');
  const results = await Promise.allSettled([...frames].slice(0, 2).map(([url, audio]) => readPlayer(url, audio, item, resolved.title, http)));
  const checked = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const hits = [...new Map(checked.flatMap((result) => result.hits).map((hit) => [hit.url, hit])).values()];
  if (hits.length) return hits;
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return noResult(checked.find((result) => result.reason !== 'embeds-only')?.reason || 'embeds-only');
}

module.exports = { searchCuevana3, playerUrl };
