'use strict';

// Adaptación independiente de la estructura pública observada en FlixLatamProvider.kt.
const { load } = require('cheerio');
const config = require('./config');
const { fetchText, timeoutError } = require('./http');
const { hitMatches } = require('./streamChoices');
const { isDirectMedia } = require('./directMedia');

const BASE = 'https://flixlatam.com';
const normalize = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sameOriginPage(raw, page, path) {
  if (!raw) return null;
  try {
    const url = new URL(raw, page);
    if (url.origin !== BASE || url.username || url.password || !path.test(url.pathname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function findShow(html, title, resolved) {
  const $ = load(html);
  const path = resolved.mediaType === 'movie' ? /^\/pelicula\/[^/]+\/?$/ : /^\/(?:serie|series|anime)\/[^/]+\/?$/;
  const matches = new Set();
  for (const card of $('article').toArray()) {
    const heading = $(card).find('h2,h3,.title').first();
    if (!normalize(title) || normalize(heading.text()) !== normalize(title)) continue;
    const year = $(card).find('.year,.data span,time').toArray()
      .map((el) => /\b(?:19|20)\d{2}\b/.exec($(el).text())?.[0]).find(Boolean);
    if (resolved.year && year !== String(resolved.year)) continue;
    const url = sameOriginPage(heading.find('a').first().attr('href') || $(card).find('a').first().attr('href'), BASE, path);
    if (url) matches.add(url);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function findEpisode(html, page, season, episode) {
  const $ = load(html);
  for (const section of $('#seasons .se-c').toArray()) {
    if (Number($(section).find('.se-q .se-t').first().text().match(/\d+/)?.[0]) !== season) continue;
    for (const row of $(section).find('ul.episodios li').toArray()) {
      const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec($(row).find('.numerando').text());
      if (!match || Number(match[1]) !== season || Number(match[2]) !== episode) continue;
      const url = sameOriginPage($(row).find('.episodiotitle a').first().attr('href'), page, /^\/[^/]+\/.+/);
      if (url) return url;
    }
  }
  return null;
}

function directSources(html, page, title) {
  const $ = load(html);
  const hits = new Map();
  function add(raw, audioLabel) {
    if (typeof raw !== 'string' || !raw || typeof audioLabel !== 'string') return;
    let url;
    try { url = new URL(raw, page).href; } catch { return; }
    if (!url.startsWith('https:') || !isDirectMedia(url, 'flixlatam', false)) return;
    const hit = { provider: 'flixlatam', title, url, audioLabel, referer: page };
    if (hitMatches(hit, null)) hits.set(url, hit);
  }
  for (const script of $('script:not([src])').toArray()) {
    const json = /\bdataLink\s*=\s*(\[[\s\S]*?\])\s*;/.exec($(script).html() || '')?.[1];
    if (!json) continue;
    let groups;
    try { groups = JSON.parse(json); } catch { continue; }
    for (const group of groups) {
      if (!Array.isArray(group?.sortedEmbeds)) continue;
      for (const entry of group.sortedEmbeds) {
        if (!entry || /download|1fichier/i.test(entry.servername || '')) continue;
        // Solo enlaces directos, no tokens, blobs cifrados ni destinos inferidos.
        if (typeof entry.link === 'string' && /^(?:https:\/\/|\/)/i.test(entry.link)) add(entry.link, group.video_language);
      }
    }
  }
  return [...hits.values()];
}

async function searchFlixLatam(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  if (!config.flixlatamEnabled) return { skipped: 'disabled' };
  const series = resolved.mediaType === 'series';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const deadline = Date.now() + timeoutMs;
  async function get(url, referer = BASE) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(url, timeoutMs);
    return fetchText(url, { timeoutMs: remaining, redirect: 'error', headers: { Accept: 'text/html', Referer: referer } });
  }
  const search = new URL('/search', BASE);
  search.searchParams.set('s', title);
  let page = findShow(await get(search.href), title, resolved);
  if (!page) return [];
  let html = await get(page);
  if (series) {
    const episode = findEpisode(html, page, resolved.season, resolved.episode);
    if (!episode) return [];
    html = await get(episode, page);
    page = episode;
  }
  const hits = directSources(html, page, resolved.title);
  if (hits.length) return hits;
  const $ = load(html);
  const iframe = $('div.pframe iframe').toArray()
    .map((el) => sameOriginPage($(el).attr('src'), page, /^\/.+/)).find((url) => url && url !== page);
  return iframe ? directSources(await get(iframe, page), iframe, resolved.title) : [];
}

module.exports = { searchFlixLatam, findShow, findEpisode, directSources };
