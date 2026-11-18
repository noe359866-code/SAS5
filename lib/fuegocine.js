'use strict';
const { resolutionToken } = require('./resolution');
const { load } = require('cheerio');
const config = require('./config');
const { fetchText, timeoutError } = require('./http');
const { hitMatches } = require('./streamChoices');
const { isDirectMedia } = require('./directMedia');

const BASE = 'https://fuegocine.com';
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function movieLink(raw, mode) {
  if (!raw) return null;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE || url.username || url.password) return null;
    const match = new RegExp(`^/movies/${mode}/([^/]+)/(\\d+)/?$`).exec(url.pathname);
    return match ? { url: BASE + url.pathname, slug: match[1], id: match[2] } : null;
  } catch { return null; }
}

async function searchFuegoCine(_query, resolved, title = resolved.title, timeoutMs = config.streamProviderTimeoutMs) {
  if (resolved.mediaType !== 'movie') return { skipped: 'solo películas' };
  const wanted = norm(title);
  if (!wanted) return [];
  const deadline = Date.now() + timeoutMs;
  async function get(url, referer = BASE) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(url, timeoutMs);
    return load(await fetchText(url, { timeoutMs: remaining, redirect: 'manual', headers: { Accept: 'text/html', Referer: referer } }));
  }
  const index = await get(BASE + '/');
  const matches = new Map();
  for (const node of index('a[href]').toArray()) {
    const el = index(node);
    const detail = movieLink(el.attr('href'), 'details');
    if (detail && [el.attr('title'), el.text(), el.find('img').first().attr('alt')].some((name) => norm(name) === wanted)) matches.set(detail.id, detail);
  }
  if (matches.size !== 1) return [];
  const [detail] = matches.values();
  const ficha = await get(detail.url);
  const watch = ficha('a[href]').toArray().map((node) => movieLink(ficha(node).attr('href'), 'watch'))
    .find((link) => link && link.slug === detail.slug && link.id === detail.id);
  if (!watch) return [];
  const player = await get(watch.url, detail.url);
  if (resolved.year) {
    const year = String(resolved.year);
    if (!/^(?:19|20)\d{2}$/.test(year)) return [];
    const metadata = [player('title').text(), ...player('h1,h2,time').toArray().map((el) => player(el).attr('datetime') || player(el).text())];
    const datePattern = new RegExp(`(?:\\b${year}[-/]\\d{2}|\\b[A-Za-z]{3,9}\\.?\\s+\\d{1,2}\\s+${year}\\b)`);
    if (!metadata.some((value) => new RegExp(`\\b${year}\\b`).test(value)) && !datePattern.test(player('body').text())) return [];
  }
  const hits = new Map();
  for (const node of player('video[src],video source[src]').toArray()) {
    const el = player(node);
    const lang = el.closest('[data-language],[data-lang]');
    const audioLabel = lang.attr('data-language') || lang.attr('data-lang');
    let url;
    try { url = new URL(el.attr('src'), watch.url); } catch { continue; }
    const resolution = resolutionToken(el.attr('data-quality'), el.attr('label'), el.attr('res'));
    const hit = { resolution, provider: 'fuegocine', title: resolved.title, url: url.href, audioLabel, referer: watch.url };
    if (url.protocol === 'https:' && isDirectMedia(url.href, 'fuegocine', false) && hitMatches(hit, null)) hits.set(hit.url, hit);
  }
  return [...hits.values()];
}
module.exports = { searchFuegoCine };
