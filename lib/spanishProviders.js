'use strict';
const { load } = require('cheerio');
const config = require('./config');
const { providerHttp } = require('./providerHttp');
const { mediaCollector, collectElements, expandMedia } = require('./htmlPlayers');

const sources = {
  animeonlineninja: { name: 'AnimeOnlineNinja', url: 'https://ww4.animeonline.ninja', search: (q) => `/search/?s=${encodeURIComponent(q)}`, movie: 'pelicula', series: 'online' },
  cuevana3: { name: 'Cuevana 3', url: 'https://cuevanas3.pro', search: (q) => `/search/${encodeURIComponent(q.toLowerCase())}/`, movie: 'peliculas?', series: 'series?', trailingSlash: true },
};

const norm = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const none = (reason) => ({ hits: [], reason });
function localLink(raw, page, path) {
  if (!raw) return null;
  try {
    const url = new URL(raw, page);
    if (url.origin !== new URL(page).origin || url.username || url.password || !path.test(url.pathname)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function yearsOf(value) {
  return [...String(value || '').matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => match[1]);
}

function pickTitle(html, page, path, title, year, source) {
  const $ = load(html);
  const candidates = new Set();
  const wanted = norm(title);
  if (!wanted) return null;
  for (const element of $('a[href]').toArray()) {
    const link = $(element);
    const url = localLink(link.attr('href'), page, path);
    if (!url) continue;
    const card = link.closest('article,li,.result-item,.item,.result,.search-result');
    const headings = 'h2,h3,.title,.entry-title,.poster-title';
    const directNames = link.contents().toArray().filter((el) => el.type === 'text').map((el) => el.data.trim());
    const names = [link.attr('title'), link.find(headings).first().text(), link.find('img').first().attr('alt'),
      card.find(headings).first().text(), card.find('img[alt]').first().attr('alt'), link.text(), ...directNames];
    const matches = names.filter((name) => name && norm(name.replace(/\s*\(\d{4}\)\s*$/, '')) === wanted);
    if (!matches.length) continue;
    const years = new Set(matches.map((name) => /\(((?:19|20)\d{2})\)\s*$/.exec(name)?.[1]).filter(Boolean));
    for (const node of card.find('.year,.date,.release,time,[data-year],[itemprop="datePublished"]').toArray()) {
      const el = $(node);
      for (const y of yearsOf(el.attr('data-year') || el.attr('datetime') || el.attr('content') || el.text())) years.add(y);
    }
    const slugYear = /-((?:19|20)\d{2})\/?$/.exec(url.pathname)?.[1];
    if (slugYear) years.add(slugYear);
    if (year && (years.size !== 1 || !years.has(String(year)))) continue;
    if (source?.trailingSlash && !url.pathname.endsWith('/')) url.pathname += '/';
    candidates.add(url.href);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

function pickEpisode(html, page, season, episode, source) {
  const $ = load(html);
  const matches = new Set();
  for (const element of $('a[href]').toArray()) {
    const link = $(element);
    const url = localLink(link.attr('href'), page, /^\/(?:ver-episodio|episodios?|capitulos?)\//);
    if (!url) continue;
    const numbering = link.closest('li,tr').find('.numerando').first().text().trim();
    const pair = /(?:temporada[-\s]+(\d+)[-\s]+episodio[-\s]+(\d+)|\b(\d+)\s*x\s*(\d+)\b)/i.exec(`${url.pathname} ${link.text()}`) || /^(\d+)\s*-\s*(\d+)$/.exec(numbering);
    if (pair && Number(pair[1] || pair[3]) === season && Number(pair[2] || pair[4]) === episode) {
      if (source?.trailingSlash && !url.pathname.endsWith('/')) url.pathname += '/';
      matches.add(url.href);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function makeSearcher(key) {
  const source = sources[key];
  return async (_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) => {
    const series = resolved.mediaType === 'series';
    if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
    const http = providerHttp(timeoutMs);
    const get = (url, referer = source.url) => http.text(url, { headers: { Accept: 'text/html', Referer: referer }, maxBytes: 2 * 1024 * 1024 });
    const path = new RegExp(`^/(?:${series ? source.series : source.movie})/[^/]+/?$`);
    const names = [...new Set([title, resolved.altTitle].filter(Boolean))];
    let page = null;
    for (const name of names) {
      const search = source.url + source.search(name);
      page = pickTitle(await get(search), search, path, name, resolved.year, source);
      if (page) break;
    }
    if (!page) return none('no-match');
    let html = await get(page);
    if (series) {
      const episode = pickEpisode(html, page, resolved.season, resolved.episode, source);
      if (!episode) return none('no-episode');
      html = await get(episode, page);
      page = episode;
    }
    const $ = load(html);
    const media = mediaCollector(page, key, resolved.title);
    collectElements($, media.add);
    const hits = await expandMedia(media, http);
    const player = $('iframe[src],iframe[data-src],li.dooplay_player_option[data-option]').length;
    return hits.length ? hits : none(player ? 'no-compatible-player' : 'no-compatible-media');
  };
}

module.exports = { sources, makeSearcher, pickTitle, pickEpisode };
