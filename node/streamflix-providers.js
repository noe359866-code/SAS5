'use strict';

// Las fuentes web solo devuelven fichas públicas en su propio dominio.
// No se consultan iframes, servidores de vídeo ni enlaces de descarga.
const { load } = require('cheerio');
const { providerHttp } = require('../lib/providerHttp');
const { normalizeText, titleQueries, titleScore, yearOf } = require('../lib/providerTitles');

const PELISFLIX = 'https://pelisflixhd.love';
const SERIESFLIX = 'https://seriesflixhd.boats';
const MOVIE_PATH = /^\/pelicula\/[a-z0-9-]+\/?$/;
const SERIES_PATH = /^\/serie\/[a-z0-9-]+\/?$/;
const SEASON_PATH = /^\/temporada\/[a-z0-9-]+\/?$/;
const EPISODE_PATH = /^\/episodio\/[a-z0-9-]+\/?$/;

function pageUrl(value, origin, path) {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !path.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

async function page(url, http) {
  const html = await http.text(url.href, { headers: { Accept: 'text/html' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 2000 });
  const $ = load(html);
  if (/^(?:just a moment|attention required)/i.test($('title').text().trim()) || $('[id="cf-browser-verification"]').length) {
    throw new Error('Challenge del proveedor');
  }
  return $;
}

function completeNames(title) {
  const text = title.trim();
  const parts = /^(.*?)\s*\(([^()]+)\)$/.exec(text);
  return parts && !yearOf(parts[2]) ? [text, parts[1].trim(), parts[2].trim()] : [text];
}

function selectCard(cards, titles, year) {
  const unique = new Map();
  for (const card of cards) {
    if (!card.url || (card.year && card.year !== year)) continue;
    const titleMatch = titleScore(completeNames(card.title), titles);
    if (!titleMatch) continue;
    const key = card.url.pathname.replace(/\/$/, '');
    const score = (card.year ? 3 : 0) + titleMatch;
    if (score > (unique.get(key)?.score || 0)) unique.set(key, { ...card, score });
  }
  const [first, second] = [...unique.values()].sort((a, b) => b.score - a.score);
  if (!first || first.score === second?.score) return null;
  return first;
}

function readYear($, selector) {
  const el = $(selector).first();
  return yearOf(el.attr('content') || el.attr('datetime') || el.text().trim());
}

function readAudio(labels) {
  const audio = new Set();
  for (const label of labels) {
    const value = normalizeText(label).replace(/reproducir|idioma/g, ' ');
    if (/\b(?:subtitulado|vose|trailer)\b/.test(value)) continue;
    if (/\b(?:latino|lat)\b/.test(value)) audio.add('Latino');
    if (/\bcastellano\b/.test(value)) audio.add('Castellano');
  }
  return [...audio];
}

async function moviePage(query, titles, year, http) {
  const search = new URL(`/busqueda/${encodeURIComponent(query)}`, PELISFLIX);
  const $ = await page(search, http);
  const cards = $('a[href*="/pelicula/"]:has(.item-detail), a[href*="/pelicula/"]:has(img[alt])').toArray().map((el) => {
    const card = $(el);
    return {
      url: pageUrl(card.attr('href'), PELISFLIX, MOVIE_PATH),
      title: card.find('.item-detail p').first().text() || (card.find('img[alt]').first().attr('alt') || '').replace(/^poster\s+/i, ''),
      year: yearOf(card.find('.card-hover-year, .item-picture .year').first().text().trim()),
    };
  });
  const match = selectCard(cards, titles, year);
  if (!match) return null;
  const detail = await page(match.url, http);
  const reportedYear = readYear(detail, 'article.backdrop-info [itemprop="datePublished"]');
  if ((reportedYear || match.year) !== year) return null;
  const labels = detail('#player li[data-server]').toArray().flatMap((el) => {
    const option = detail(el);
    return option.attr('data-server')?.trim() ? [option.text()] : [];
  });
  const audio = readAudio(labels);
  return audio.length ? { externalUrl: match.url.href, audio } : null;
}

function onlyLink($, links, hrefOf) {
  const found = new Map();
  for (const element of links.toArray()) {
    const url = hrefOf($(element));
    if (url) found.set(url.pathname.replace(/\/$/, ''), url);
  }
  return found.size === 1 ? found.values().next().value : null;
}

async function episodePage(query, titles, year, http, { season, episode }) {
  const search = new URL('/', SERIESFLIX);
  search.searchParams.set('s', query);
  const $ = await page(search, http);
  const cards = $('article.TPost.B').toArray().map((el) => {
    const card = $(el);
    return {
      url: pageUrl(card.find('a[href*="/serie/"]').first().attr('href'), SERIESFLIX, SERIES_PATH),
      title: card.find('h2.Title').first().text(),
      year: yearOf(card.find('.Year, .Date').first().text().trim()),
    };
  });
  const match = selectCard(cards, titles, year);
  if (!match) return null;
  const detail = await page(match.url, http);
  const reportedYear = readYear(detail, 'article.TPost.A .Info .Date, [itemprop="datePublished"]');
  if ((reportedYear || match.year) !== year) return null;
  const slug = match.url.pathname.split('/')[2];
  const seasonLink = onlyLink(detail, detail('a[href*="/temporada/"]'), (link) => {
    const url = pageUrl(link.attr('href'), SERIESFLIX, SEASON_PATH);
    return url?.pathname.replace(/\/$/, '') === `/temporada/${slug}-${season}`
      && new RegExp(`\\bTemporada\\s+${season}\\b`, 'i').test(link.text()) ? url : null;
  });
  if (!seasonLink) return null;
  const episodes = await page(seasonLink, http);
  const episodeLink = onlyLink(episodes, episodes('section.SeasonBx .TPTblCn tr'), (row) => {
    if (row.find('.Num').text().trim() !== String(episode)) return null;
    const url = pageUrl(row.find('.MvTbTtl a[href]').first().attr('href'), SERIESFLIX, EPISODE_PATH);
    return url?.pathname.replace(/\/$/, '') === `/episodio/${slug}-${season}x${episode}` ? url : null;
  });
  if (!episodeLink) return null;
  const detailEpisode = await page(episodeLink, http);
  const labels = detailEpisode('.optns-bx .drpdn').toArray().flatMap((el) => {
    const group = detailEpisode(el);
    const hasOption = group.find('.Button.sgty[data-url]').toArray().some((opt) => detailEpisode(opt).attr('data-url')?.trim());
    return hasOption ? [group.find('button.bstd').first().text()] : [];
  });
  const audio = readAudio(labels);
  return audio.length ? { externalUrl: episodeLink.href, audio } : null;
}

const PROVIDERS = [
  { key: 'pelisflixhd', name: 'PelisflixHD', type: 'movie', lookup: moviePage },
  { key: 'seriesflix', name: 'SeriesFlix', type: 'series', lookup: episodePage },
];

async function findWebPage(provider, resolved) {
  const titles = [resolved.title, resolved.altTitle].filter(Boolean);
  const year = yearOf(resolved.year);
  if (!year || provider.type !== resolved.mediaType) return null;
  if (provider.type === 'series' && !(resolved.season > 0 && resolved.episode > 0)) return null;
  // Hasta dos búsquedas de título. Un rechazo HTTP o challenge termina el
  // intento, sin cambiar de IP, dominio ni de cabeceras.
  const http = providerHttp(5000, 5);
  for (const query of titleQueries(titles).filter((title) => title.length <= 160).slice(0, 2)) {
    const result = await provider.lookup(query, titles, year, http, resolved);
    if (result) return result;
  }
  return null;
}

module.exports = { PROVIDERS, findWebPage };
