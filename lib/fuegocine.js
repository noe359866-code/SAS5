'use strict';

const { load } = require('cheerio');
const config = require('./config');
const { providerHttp } = require('./providerHttp');
const { mediaCollector, collectElements, expandMedia } = require('./htmlPlayers');

const BASE = 'https://fuegocine.com';
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const comparableTitle = (s) => norm(String(s || '').replace(/\s*\((?:19|20)\d{2}\)\s*$/, ''));
const none = (reason) => ({ hits: [], reason });

function localUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, BASE);
    return url.origin === BASE && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function detailsLink(url, category, mode) {
  const match = new RegExp(`^/${category}/${mode}/([^/]+)/(\\d+)/?$`).exec(url.pathname);
  return match ? { url: BASE + url.pathname, slug: match[1], id: match[2] } : null;
}

function showLinks($, category, title) {
  const matches = new Map();
  for (const node of $('a[href]').toArray()) {
    const el = $(node);
    const url = localUrl(el.attr('href'));
    const detail = url && detailsLink(url, category, 'details');
    if (detail && [el.attr('title'), el.text(), el.find('img').first().attr('alt')].some((name) => comparableTitle(name) === title)) {
      matches.set(detail.url, detail);
    }
  }
  return [...matches.values()];
}

function oneLink($, matches) {
  const links = new Set($('a[href]').toArray().map((el) => localUrl($(el).attr('href')))
    .filter((url) => url && matches(url)).map((url) => BASE + url.pathname));
  return links.size === 1 ? [...links][0] : null;
}

function episodeLink($, slug, season, episode) {
  return oneLink($, (url) => {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 4 || parts[0] !== 'shows' || parts[1] !== slug || !/^\d+$/.test(parts[3])) return false;
    const m = /^(\d+)x(\d+)(?:-|$)/i.exec(parts[2]);
    return m && Number(m[1]) === season && Number(m[2]) === episode;
  });
}

function seasonLink($, slug, season) {
  return oneLink($, (url) => {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 5 || parts[0] !== 'shows' || parts[1] !== slug || parts[2] !== 'seasons' || !/^\d+$/.test(parts[4])) return false;
    const m = /^temporada-(\d+)$/.exec(parts[3]);
    return m && Number(m[1]) === season;
  });
}

function compatibleYear($, declared, requireEvidence) {
  if (!declared) return true;
  const year = String(declared);
  if (!/^(?:19|20)\d{2}$/.test(year)) return false;
  const metadata = [$('title').text(), ...$('h1,h2,time,[datetime]').toArray().map((el) => $(el).attr('datetime') || $(el).text())];
  const explicit = metadata.map((text) => /(?:\(|^)((?:19|20)\d{2})(?:\)|[-/]|$)/.exec(text.trim())?.[1]).filter(Boolean);
  if (explicit.length) return explicit.every((value) => value === year);
  // La ficha de una serie no siempre incluye fecha de estreno (las de sus
  // episodios son distintas). Las películas sí deben confirmar el año.
  const dates = $('body').text().match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:19|20)\d{2}\b/gi) || [];
  return !requireEvidence || dates.some((value) => value.endsWith(year));
}

function pageAudio($, category) {
  // FuegoCine etiqueta el audio de la obra en la ficha del visor junto a
  // sus géneros. Usarla solo para <video> directos si hay una única etiqueta.
  const labels = new Set();
  for (const el of $(`a[href^="/${category}?lang_id="]`).toArray()) {
    const label = $(el).text().trim();
    if (label) labels.add(label);
  }
  return labels.size === 1 ? [...labels][0] : '';
}

async function searchFuegoCine(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  const series = resolved.mediaType === 'series';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const category = series ? 'shows' : 'movies';
  const wanted = comparableTitle(title);
  if (!wanted) return none('no-match');
  const http = providerHttp(timeoutMs);
  const get = async (url, referer = BASE) => load(await http.text(url, { headers: { Accept: 'text/html', Referer: referer } }));
  const index = await get(`${BASE}/`);
  let matches = showLinks(index, category, wanted);
  if (!matches.length) matches = showLinks(await get(`${BASE}/${category}`), category, wanted);
  if (matches.length !== 1) return none(matches.length ? 'ambiguous-title' : 'no-match');
  const [detail] = matches;
  const ficha = await get(detail.url);
  let referer = detail.url;
  let watch;
  if (series) {
    if (!compatibleYear(ficha, resolved.year, false)) return none('identity-mismatch');
    const season = seasonLink(ficha, detail.slug, resolved.season);
    if (!season) return none('no-season');
    watch = episodeLink(await get(season, detail.url), detail.slug, resolved.season, resolved.episode);
    referer = season;
  } else {
    watch = oneLink(ficha, (url) => {
      const link = detailsLink(url, category, 'watch');
      return link && link.slug === detail.slug && link.id === detail.id;
    });
  }
  if (!watch) return none(series ? 'no-episode' : 'missing-player');
  const player = await get(watch, referer);
  if (!series && !compatibleYear(player, resolved.year, true)) return none('identity-mismatch');
  const media = mediaCollector(watch, 'fuegocine', resolved.title);
  collectElements(player, media.add, { defaultLabel: pageAudio(player, category) });
  const hits = await expandMedia(media, http);
  return hits.length ? hits : none(player('iframe[src],iframe[data-src]').length ? 'embeds-only' : 'no-compatible-media');
}

module.exports = { searchFuegoCine };
