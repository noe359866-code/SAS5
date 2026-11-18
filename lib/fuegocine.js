'use strict';

const { load } = require('cheerio');
const config = require('./config');
const cache = require('./cache');
const { providerHttp } = require('./providerHttp');
const { mediaCollector, collectElements, expandMedia } = require('./htmlPlayers');
const { allowedVideoUrl } = require('./vimeos');

const BASE = 'https://fuegocine.com';
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const comparableTitle = (s) => norm(String(s || '').replace(/\s*\((?:19|20)\d{2}\)\s*$/, ''));
const none = (reason) => ({ hits: [], reason });

function parseUrl(raw, base = BASE) {
  if (!raw) return null;
  try { return new URL(raw, base); } catch { return null; }
}

function localUrl(raw) {
  const url = parseUrl(raw);
  return url?.origin === BASE && !url.username && !url.password ? url : null;
}

function detailsLink(url, category, mode) {
  const match = new RegExp(`^/${category}/${mode}/([^/]+)/(\\d+)/?$`).exec(url.pathname);
  return match ? { url: BASE + url.pathname, slug: match[1], id: match[2] } : null;
}

function showLinks($, category, titles) {
  const matches = new Map();
  for (const node of $('a[href]').toArray()) {
    const el = $(node);
    const url = localUrl(el.attr('href'));
    const detail = url && detailsLink(url, category, 'details');
    if (detail && [el.attr('title'), el.text(), el.find('img').first().attr('alt')].some((name) => titles.has(comparableTitle(name)))) {
      matches.set(detail.url, detail);
    }
  }
  return [...matches.values()];
}

async function sitemapLinks(category, http) {
  const key = `fuegocine:sitemap:${category}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `${BASE}/${category === 'shows' ? 'sitemap-show.xml' : 'sitemap-movies.xml'}`;
  const xml = await http.text(url, { timeoutMs: 1600, maxBytes: 512 * 1024, headers: { Accept: 'application/xml,text/xml' } });
  const $ = load(xml, { xml: true });
  const entries = $('urlset > url > loc').toArray().map((el) => localUrl($(el).text().trim()))
    .filter(Boolean).map((detail) => detailsLink(detail, category, 'details')).filter(Boolean);
  const unique = [...new Map(entries.map((detail) => [detail.url, detail])).values()];
  if (unique.length) cache.set(key, unique, 15 * 60);
  return unique;
}

function slugTitle(slug) {
  try { return comparableTitle(decodeURIComponent(slug)); } catch { return ''; }
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

async function findFuegoPlayer(resolved, title, http) {
  const series = resolved.mediaType === 'series';
  if (series && ![resolved.season, resolved.episode].every((n) => Number.isSafeInteger(n) && n > 0)) return { skipped: 'episode-required' };
  const category = series ? 'shows' : 'movies';
  const wanted = new Set([title, resolved.title, resolved.altTitle].map(comparableTitle).filter(Boolean));
  if (!wanted.size) return none('no-match');
  const get = async (url, referer = BASE) => load(await http.text(url, { headers: { Accept: 'text/html', Referer: referer }, maxBytes: 2 * 1024 * 1024 }));
  // El sitemap oficial es más pequeño que la portada y cubre obras antiguas.
  // La ruta de búsqueda de la web no siempre está disponible.
  const indexed = await sitemapLinks(category, http).catch((err) => {
    if (err.challenge || [401, 403, 429].includes(err.status)) throw err;
    return [];
  });
  let matches = indexed.filter((detail) => wanted.has(slugTitle(detail.slug)));
  let catalog = 'sitemap';
  if (!matches.length) {
    matches = showLinks(await get(`${BASE}/`), category, wanted);
    catalog = 'home';
  }
  if (!matches.length) {
    matches = showLinks(await get(`${BASE}/${category}`), category, wanted);
    catalog = 'list';
  }
  if (matches.length !== 1) return none(matches.length ? 'ambiguous-title' : 'no-match');
  const [detail] = matches;
  const ficha = await get(detail.url);
  if (catalog === 'sitemap' && !ficha('h1,h2,title').toArray().some((node) => wanted.has(comparableTitle(ficha(node).text().split(' | ')[0])))) return none('identity-mismatch');
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
  return { player, watch, category, catalog };
}

async function searchFuegoCine(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  if (title && title === resolved.altTitle && title !== resolved.title) return { skipped: 'ya se consultaron ambos títulos' };
  const http = providerHttp(timeoutMs);
  const located = await findFuegoPlayer(resolved, title, http);
  const { player, watch, category } = located;
  if (!player) return located;

  // Si la página separa el visor de otros contenidos, no leer medios de
  // banners, recomendaciones ni tráileres fuera de ese visor.
  const prefix = player('.multi-server-player').length ? '.multi-server-player ' : '';
  const within = (selectors) => selectors.map((selector) => prefix + selector).join(',');
  const video = within(['video[src]', 'video[data-src]', 'video source[src]', 'video source[data-src]', 'a[data-src]', 'button[data-src]']);
  const iframe = within(['iframe[src]', 'iframe[data-src]']);
  const media = mediaCollector(watch, 'fuegocine', resolved.title);
  collectElements(player, media.add, { selector: video, defaultLabel: pageAudio(player, category) });
  collectElements(player, (raw, label, quality) => {
    const url = parseUrl(raw, watch);
    if (url && allowedVideoUrl(url.href) && /^(?:\/embed[-/]|.*\.m3u8$)/i.test(url.pathname)) media.add(url.href, label, quality);
  }, { selector: iframe });
  const hits = await expandMedia(media, http);
  return hits.length ? hits : none(player(iframe).length ? 'embeds-only' : 'no-compatible-media');
}

module.exports = { searchFuegoCine, findFuegoPlayer };
