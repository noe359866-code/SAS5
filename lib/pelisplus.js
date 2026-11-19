'use strict';

// Adaptador experimental para el HTML público de PelisPlus. No ejecuta scripts.
const { load } = require('cheerio');
const config = require('./config');
const { providerHttp, stopProvider } = require('./providerHttp');
const { titleScore, titleQueries, yearOf } = require('./providerTitles');
const { hitMatches } = require('./streamChoices');
const { unpackPacked } = require('./vimeos');
const { isDirectMedia } = require('./directMedia');

const BASE = 'https://pelisplushd.la';
const STREAMWISH_HOSTS = ['streamwish.to', 'streamwish.com', 'filelions.to', 'filelions.live',
  'wish-redirect.aiavh.com', 'dhcplay.com', 'hglink.to', 'playnixes.com', 'niramirus.com',
  'medixiru.com', 'hgplaycdn.com', 'hglamioz.com', 'kravaxxa.com', 'davioad.com',
  'haxloppd.com', 'tryzendm.com', 'dumbalag.com',
  // Alias públicos observados en los extractores VidHide y Dropload de Streamflix.
  'dhtpre.com', 'peytonepre.com', 'vidhideplus.com', 'dingtezuni.com',
  'dintezuvio.com', 'minochinos.com', 'moflix-stream.click', 'morencius.com',
  'dropload.tv', 'dropload.io', 'dropload.pro', 'dr0pstream.com'];

function publicHttps(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.') ||
        /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|home|lan|test|example)$/.test(host)) return null;
    return url;
  } catch { return null; }
}
function embedUrl(raw) {
  const url = publicHttps(raw);
  return url && STREAMWISH_HOSTS.some((host) => url.hostname === host) ? url.href : null;
}
function mediaUrl(raw, base) {
  let value;
  try { value = new URL(raw, base).href; } catch { return null; }
  const url = publicHttps(value);
  return url && /\.(?:m3u8|mp4)$/i.test(url.pathname) && isDirectMedia(url.href) ? url.href : null;
}

function searchCandidates(html, resolved) {
  const $ = load(html);
  const found = new Set();
  for (const node of $('a.Posters-link[href]').toArray()) {
    const el = $(node);
    let url;
    try { url = new URL(el.attr('href'), BASE); } catch { continue; }
    if (url.origin !== BASE || url.search || url.hash || !/^\/pelicula\/[a-z0-9-]+\/?$/i.test(url.pathname)) continue;
    const title = el.attr('data-title') || el.find('.listing-content p').first().text();
    if (titleScore([title], [resolved.title, resolved.altTitle]) > 0) found.add(url.href);
    if (found.size >= 3) break;
  }
  return [...found];
}

function matchingMovie($, resolved) {
  const title = $('h1').first().text().trim();
  const original = $('p.text-opacity').first().text().replace(/^\s*@\s*/, '').trim();
  if (!titleScore([title, original], [resolved.title, resolved.altTitle])) return false;
  const wanted = yearOf(resolved.year);
  // Exigir un año explícito de la ficha para evitar homónimos y falsos positivos.
  const release = $('a[href^="/year/"]').first().text().trim() || $('.font-size-18.text-info').first().text().trim();
  return Boolean(wanted && yearOf(release) === wanted);
}

function playerEmbeds($) {
  const found = new Map();
  for (const node of $('li.playurl[data-url]').toArray()) {
    const el = $(node);
    const audioLabel = el.attr('data-name') || '';
    const url = embedUrl(el.attr('data-url'));
    if (url && hitMatches({ audioLabel }, null) && !found.has(url)) found.set(url, audioLabel);
    if (found.size >= 3) break;
  }
  return [...found].map(([url, audioLabel]) => ({ url, audioLabel }));
}

function extractPlayer(html, page) {
  const text = unpackPacked(html) || String(html || '');
  const urls = [];
  // Solo campos de fuente conocidos, no URLs sueltas ni ejecutar scripts.
  for (const m of text.matchAll(/(?:["']?(?:file|src|hls[1-4])["']?)\s*:\s*["']([^"']+)["']/gi)) {
    const url = mediaUrl(m[1].replace(/\\\//g, '/'), page);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= 3) break;
  }
  const subtitles = [];
  // Solo pistas declaradas dentro del arreglo tracks y marcadas como captions.
  const tracks = /\btracks\s*:\s*\[([\s\S]*?)\]/i.exec(text)?.[1] || '';
  for (const match of tracks.matchAll(/\{([^{}]{1,2048})\}/g)) {
    const body = match[1];
    const field = (name) => new RegExp(`(?:["']?${name}["']?)\\s*:\\s*["']([^"']+)["']`, 'i').exec(body)?.[1] || '';
    if (!/^(?:captions|subtitles)$/i.test(field('kind'))) continue;
    const label = field('label').slice(0, 80);
    let raw;
    try { raw = new URL(field('file').replace(/\\\//g, '/'), page).href; } catch { continue; }
    const url = publicHttps(raw);
    if (!url || !/\.vtt$/i.test(url.pathname) || !isDirectMediaSubtitle(url.href)) continue;
    if (subtitles.some((entry) => entry.url === url.href)) continue;
    const lang = /span|espa|castellano|latino/i.test(label) ? 'es' : /english|ingles/i.test(label) ? 'en' : 'und';
    subtitles.push({ url: url.href, lang, title: label || 'Subtítulos' });
    if (subtitles.length >= 10) break;
  }
  return { urls, subtitles };
}

// El filtro genérico de media solo admite extensiones de vídeo.
function isDirectMediaSubtitle(raw) {
  const url = publicHttps(raw);
  if (!url) return false;
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  return !/(?:^|\.)(?:ads?|adserver|adservice|advertising|doubleclick|adsterra)(?:\.|$)/i.test(url.hostname)
    && !/(?:^|\/)(?:ads?|advert|advertising|preroll|vast)(?:\/|$)/i.test(path);
}
function streamwishHls(html, page) {
  return extractPlayer(html, page).urls.filter((url) => /\.m3u8$/i.test(new URL(url).pathname));
}

async function searchPelisPlus(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  if (resolved.mediaType !== 'movie') return { skipped: 'series-not-supported' };
  if (!yearOf(resolved.year)) return { skipped: 'year-required' };
  const http = providerHttp(timeoutMs, 8);
  const seen = new Set();
  let matched = false;
  for (const query of titleQueries([resolved.title, resolved.altTitle]).slice(0, 3)) {
    const search = await http.text(`${BASE}/search?s=${encodeURIComponent(query)}`, { maxBytes: 1024 * 1024 });
    for (const page of searchCandidates(search, resolved)) {
      if (seen.has(page)) continue;
      seen.add(page);
      const detail = await http.text(page, { maxBytes: 1024 * 1024 });
      const $ = load(detail);
      if (!matchingMovie($, resolved)) continue;
      matched = true;
      for (const embed of playerEmbeds($)) {
        try {
          const html = await http.text(embed.url, { headers: { Referer: `${BASE}/`, Origin: BASE }, maxBytes: 1024 * 1024 });
          const { urls, subtitles } = extractPlayer(html, embed.url);
          if (urls.length) return { hits: urls.map((url) => ({ provider: 'pelisplus', url,
            title: `${resolved.title} ${resolved.year} PelisPlus`, audioLabel: embed.audioLabel,
            quality: /\.mp4$/i.test(new URL(url).pathname) ? 'MP4' : 'HLS',
            resolution: null, relevant: true, ...(subtitles.length ? { subtitles } : {}) })) };
        } catch (err) { if (stopProvider(err)) throw err; }
      }
    }
  }
  return { hits: [], reason: matched ? 'no-compatible-media' : 'no-match' };
}
module.exports = { searchPelisPlus, searchCandidates, matchingMovie, playerEmbeds, streamwishHls, extractPlayer, embedUrl };
