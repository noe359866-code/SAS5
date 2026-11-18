'use strict';

// Adaptación independiente de la estructura pública observada en FlixLatamProvider.kt.
const { load } = require('cheerio');
const config = require('./config');
const { providerHttp } = require('./providerHttp');
const { hitMatches } = require('./streamChoices');
const { allowedVideoUrl, unpackPacked } = require('./vimeos');
const { mediaCollector, collectElements, expandMedia } = require('./htmlPlayers');
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
  const matches = new Map();
  const context = $('#item-context');
  const [, type, slug] = /^\/(serie|anime)\/([a-z0-9-]{1,180})\/?$/i.exec(new URL(page).pathname) || [];
  // El router público del tema usa estos dos nodos para cargar el fragmento.
  const hasRouter = type && context.length === 1 && $('#episode-container').length === 1
    && context.attr('data-type') === type && context.attr('data-slug') === slug;
  for (const row of $('#seasons .episodios li').toArray()) {
    const linkRow = $(row);
    const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(linkRow.find('.numerando').text());
    if (!match || Number(match[1]) !== season || Number(match[2]) !== episode) continue;
    const expectedHash = `#s${season}-e${episode}`;
    for (const link of linkRow.find('a.episode-link[href],.episodiotitle a[href]').toArray()) {
      const raw = $(link).attr('href');
      const url = sameOriginPage(raw, page, /^\/(?:episodios?|capitulos?)\/[^/]+(?:\/[^/]+)*\/?$/);
      if (url && url !== page) matches.set(url, { page: url });
      // Un ancla sola nunca identifica un reproductor en la ficha general.
      try {
        const linkUrl = new URL(raw, page);
        const hash = linkUrl.hash;
        linkUrl.hash = '';
        if (linkUrl.href !== page || hash !== expectedHash) continue;
        if ($(expectedHash).length === 1) {
          matches.set(expectedHash, { page, html: $(expectedHash).html() || '' });
        } else if (hasRouter && $(link).hasClass('episode-link')) {
          const api = `${BASE}/api/episodio/${type}/${slug}/${season}/${episode}`;
          matches.set(expectedHash, { page, fragment: { api, type, slug } });
        }
      } catch { /* href inválido */ }
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

const UQLOAD = new Set(['uqload.cx', 'uqload.is', 'uqload.vc']);

function mediaUrl(raw, page) {
  try {
    const url = new URL(raw, page);
    return url.protocol === 'https:' && isDirectMedia(url.href, 'flixlatam', false) ? url.href : null;
  } catch { return null; }
}

function playerSources(html, page, title) {
  const $ = load(html);
  const media = mediaCollector(page, 'flixlatam', title);
  const embeds = new Map();
  function add(raw, audioLabel, quality, embedOnly = false) {
    if (typeof raw !== 'string' || !raw.trim() || typeof audioLabel !== 'string') return;
    let url;
    try { url = new URL(raw, page); } catch { return; }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return;
    const hit = { provider: 'flixlatam', title, url: url.href, audioLabel, referer: page };
    if (!hitMatches(hit, null) || /\b(?:trailer|descarga|download)\b/i.test(audioLabel)) return;
    if (UQLOAD.has(url.host) && /^\/embed-[a-z0-9]+(?:\.html)?$/i.test(url.pathname)) embeds.set(url.href, hit);
    else if (!embedOnly || (allowedVideoUrl(url.href) && /^\/embed[-/]/i.test(url.pathname))) media.add(url.href, audioLabel, quality);
  }
  collectElements($, add, { selector: '.pframe video[src],.pframe video[data-src],.pframe video source[src],.pframe video source[data-src]' });
  collectElements($, (raw, label, quality) => add(raw, label, quality, true), { selector: '.pframe iframe[src],.pframe iframe[data-src]' });
  for (const el of $('.ODDIV .OD_1 li[onclick]').toArray()) {
    const src = /^\s*go_to_playerVast\(\s*['"]([^'"\s]+)['"]/.exec($(el).attr('onclick'))?.[1];
    add(src, $(el).attr('data-language') || $(el).attr('data-lang') || $(el).text());
  }
  for (const script of $('script:not([src])').toArray()) {
    const json = /\bdataLink\s*=\s*(\[[\s\S]*?\])\s*;/.exec($(script).html() || '')?.[1];
    if (!json) continue;
    let groups;
    try { groups = JSON.parse(json); } catch { continue; }
    for (const group of groups) {
      if (!Array.isArray(group?.sortedEmbeds)) continue;
      for (const entry of group.sortedEmbeds) {
        if (!entry || /download|descarga|trailer|1fichier/i.test(entry.servername || '')) continue;
        // Solo enlaces directos, no tokens, blobs cifrados ni destinos inferidos.
        if (typeof entry.link === 'string' && /^(?:https:\/\/|\/)/i.test(entry.link)) add(entry.link, group.video_language);
      }
    }
  }
  return { media, uqload: [...embeds.values()], iframeCount: $('.pframe iframe[src],.pframe iframe[data-src]').length };
}

function directSources(html, page, title) {
  return [...playerSources(html, page, title).media.hits.values()];
}

function uqloadMedia(html, page) {
  // Solo valores literales del reproductor; nunca se ejecuta su JavaScript.
  if (/file (?:is no longer available|(?:was|has been) (?:removed|deleted)|not found|expired)/i.test(html)) return null;
  const script = unpackPacked(html) || html;
  const raw = /(?:["']?file["']?\s*:\s*|\bsources\s*:\s*\[\s*)["']([^"']+)["']/.exec(script)?.[1];
  return raw ? mediaUrl(raw, page) : null;
}

async function searchFlixLatam(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  const series = resolved.mediaType === 'series';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const http = providerHttp(timeoutMs);
  const get = (url, referer = BASE) => http.text(url, { headers: { Accept: 'text/html', Referer: referer }, maxBytes: 2 * 1024 * 1024 });
  const none = (reason) => ({ hits: [], reason });
  const search = new URL('/search', BASE);
  let page = null;
  for (const name of [...new Set([title, resolved.altTitle].filter(Boolean))]) {
    search.searchParams.set('s', name);
    page = findShow(await get(search.href), name, resolved);
    if (page) break;
  }
  if (!page) return none('no-match');
  let html = await get(page);
  if (series) {
    const episode = findEpisode(html, page, resolved.season, resolved.episode);
    if (!episode) return none('no-episode-player');
    if (episode.fragment) {
      const { api, type, slug } = episode.fragment;
      const data = JSON.parse(await http.text(api, { headers: { Accept: 'application/json', Referer: page }, maxBytes: 512 * 1024 }));
      if (data?.success !== true || typeof data.html !== 'string' || !data.html.trim()) return none('no-episode-player');
      if (data.type !== type || data.slug !== slug || data.temporada !== resolved.season || data.episodio !== resolved.episode) return none('episode-mismatch');
      html = data.html;
    } else {
      html = episode.html ?? await get(episode.page, page);
    }
    page = episode.page;
  }
  const parsed = playerSources(html, page, resolved.title);
  const $ = load(html);
  const iframe = $('.pframe iframe[src],.pframe iframe[data-src]').toArray()
    .map((el) => sameOriginPage($(el).attr('data-src') || $(el).attr('src'), page, /^\/.+/)).find((url) => url && url !== page);
  if (iframe && !parsed.media.hits.size && !parsed.media.embeds.size && !parsed.uqload.length) {
    const nested = playerSources(await get(iframe, page), iframe, resolved.title);
    for (const [key, hit] of nested.media.hits) parsed.media.hits.set(key, hit);
    for (const [key, hit] of nested.media.embeds) parsed.media.embeds.set(key, hit);
    parsed.uqload.push(...nested.uqload);
    parsed.iframeCount += nested.iframeCount;
  }
  const hits = await expandMedia(parsed.media, http);
  const unique = [...new Map(parsed.uqload.map((hit) => [hit.url, hit])).values()].slice(0, 3);
  const results = await Promise.allSettled(unique.map(async (hit) => {
    const source = uqloadMedia(await get(hit.url, hit.referer), hit.url);
    return source ? { ...hit, url: source, referer: new URL(hit.url).origin + '/' } : null;
  }));
  for (const result of results) if (result.status === 'fulfilled' && result.value) hits.push(result.value);
  if (!hits.length) {
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return hits.length ? [...new Map(hits.map((hit) => [hit.url, hit])).values()]
    : none(parsed.iframeCount ? 'no-compatible-player' : 'no-compatible-media');
}

module.exports = { searchFlixLatam, findShow, findEpisode, directSources, uqloadMedia };
