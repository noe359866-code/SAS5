'use strict';
const { resolutionToken } = require('./resolution');
const { load } = require('cheerio');
const config = require('./config');
const { fetchText, timeoutError } = require('./http');
const { hitMatches } = require('./streamChoices');
const { isDirectMedia } = require('./directMedia');

const sources = {
  animeonlineninja: { name: 'AnimeOnlineNinja', url: 'https://ww4.animeonline.ninja', search: (q) => `/search/?s=${q}`, movie: 'pelicula', series: 'online' },
  cuevana3: { name: 'Cuevana 3', url: 'https://cuevanas3.pro', search: (q) => `/search/${encodeURIComponent(decodeURIComponent(q).toLowerCase())}/`, movie: 'peliculas?', series: 'series?' },
  cinecalidad: { name: 'CineCalidad', url: 'https://www.cinecalidad.am', search: (q) => `/page/1?s=${q}`, movie: 'ver-pelicula', series: 'ver-serie' },
  tioplus: { name: 'TioPlus', url: 'https://tioplus.app', search: (q) => `/search/${q}`, movie: 'pelicula', series: 'serie|anime' },
};

const norm = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function localLink(raw, page, path) {
  if (!raw) return null;
  try {
    const url = new URL(raw, page);
    if (url.origin !== new URL(page).origin || url.username || url.password || !path.test(url.pathname)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function pickTitle(html, page, path, title, year) {
  const $ = load(html);
  const candidates = new Set();
  for (const element of $('a[href]').toArray()) {
    const link = $(element);
    const url = localLink(link.attr('href'), page, path);
    if (!url) continue;
    const card = link.closest('article,li,.result-item,.item');
    const names = [link.attr('title'), link.find('h2,h3').first().text(), link.find('img').first().attr('alt'),
      card.find('h2,h3,.title').first().text(), link.text()];
    const matches = names.filter((name) => name && norm(name.replace(/\s*\(\d{4}\)\s*$/, '')) === norm(title));
    if (!matches.length) continue;
    const explicitYear = matches.map((name) => /\((\d{4})\)\s*$/.exec(name)?.[1]).find(Boolean)
      || /\b(?:19|20)\d{2}\b/.exec(card.find('.year,time').first().text())?.[0]
      || /-((?:19|20)\d{2})\/?$/.exec(url.pathname)?.[1];
    if (year && explicitYear !== String(year)) continue;
    candidates.add(url.href);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

function pickEpisode(html, page, season, episode) {
  const $ = load(html);
  const matches = new Set();
  for (const element of $('a[href]').toArray()) {
    const link = $(element);
    const url = localLink(link.attr('href'), page, /^\/(?:ver-episodio|episodios?|capitulos?)\//);
    if (!url) continue;
    const numbering = link.closest('li').find('.numerando').first().text().trim();
    const pair = /(?:temporada[-\s]+(\d+)[-\s]+episodio[-\s]+(\d+)|\b(\d+)\s*x\s*(\d+)\b)/i.exec(`${url.pathname} ${link.text()}`) || /^(\d+)\s*-\s*(\d+)$/.exec(numbering);
    if (pair && Number(pair[1] || pair[3]) === season && Number(pair[2] || pair[4]) === episode) matches.add(url.href);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function readMedia(html, page, title, key) {
  const $ = load(html);
  const hits = new Map();
  for (const element of $('video[src],video source[src],iframe[src],a[data-src],button[data-src]').toArray()) {
    const el = $(element);
    const language = el.closest('[data-language],[data-lang]');
    const audioLabel = language.attr('data-language') || language.attr('data-lang');
    const raw = el.attr('src') || el.attr('data-src');
    if (!raw || el.is('[download]')) continue;
    let url;
    try { url = new URL(raw, page); } catch { continue; }
    const resolution = resolutionToken(el.attr('data-quality'), el.attr('label'), el.attr('res'));
    const hit = { resolution, provider: key, title, url: url.href, audioLabel, referer: page };
    if (url.protocol === 'https:' && isDirectMedia(url.href, key, false) && hitMatches(hit, null)) hits.set(url.href, hit);
  }
  return [...hits.values()];
}

function makeSearcher(key) {
  const source = sources[key];
  return async (_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) => {
    const series = resolved.mediaType === 'series';
    if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
    const deadline = Date.now() + timeoutMs;
    async function get(url, referer = source.url) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError(url, timeoutMs);
      return fetchText(url, { timeoutMs: remaining, redirect: 'manual', headers: { Accept: 'text/html', Referer: referer } });
    }
    const search = source.url + source.search(encodeURIComponent(title));
    const path = new RegExp(`^/(?:${series ? source.series : source.movie})/[^/]+/?$`);
    let page = pickTitle(await get(search), search, path, title, resolved.year);
    if (!page) return [];
    let html = await get(page);
    if (series) {
      const episode = pickEpisode(html, page, resolved.season, resolved.episode);
      if (!episode) return [];
      html = await get(episode, page);
      page = episode;
    }
    return readMedia(html, page, resolved.title, key);
  };
}

module.exports = { sources, makeSearcher, pickTitle, pickEpisode, readMedia };
