'use strict';

// Diagnóstico acotado de estos dos adaptadores, con las mismas comprobaciones
// de identidad que producción. No imprime HTML, tokens, URLs ni cookies.
const { load } = require('cheerio');
const { fetchText } = require('../lib/http');
const { providerHttp } = require('../lib/providerHttp');
const { lookupPlayLatin, normalizeSources } = require('../lib/playlatin');
const { findFuegoPlayer } = require('../lib/fuegocine');
const { unpackPacked } = require('../lib/vimeos');
const { annotate } = require('./providers-live');

const playCases = [
  { title: 'El rey león', mediaType: 'movie', imdbId: 'tt0110357' },
  { title: 'Matrix', mediaType: 'movie', imdbId: 'tt0133093' },
  { title: 'Breaking Bad', mediaType: 'series', imdbId: 'tt0903747', season: 1, episode: 1 },
  { title: 'Friends', mediaType: 'series', imdbId: 'tt0108778', season: 1, episode: 2 },
];
const fuegoCases = [
  { title: 'Toy Story 5', year: '2026', mediaType: 'movie' },
  { title: 'Ratatouille', year: '2007', mediaType: 'movie' },
  { title: 'VisionQuest', year: '2026', mediaType: 'series', season: 1, episode: 1 },
];
const probeHosts = new Set([
  'dropload.to', 'dropload.io', 'dr0pstream.com', 'doodstream.com', 'mixdrop.co', 'mxdrop.to',
  'fcplayer2.blogspot.com', 'player.abyssplayer.com', 'unlimplay.com', 'embedorigin.cc', 'videro.my',
]);

function safeUrl(value, page) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, page);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function reportError(error) {
  return error.challenge ? 'challenge' : error.timeout ? 'timeout' : error.status ? `HTTP ${error.status}` : 'error de red o formato';
}

function urlKind(raw, page) {
  const url = safeUrl(raw, page);
  if (!url) return 'sin URL HTTPS';
  const path = url.pathname.split('/').filter(Boolean).map((part) => {
    if (/^(?:embed|e|v|f|d|player|watch|video)$/i.test(part)) return part;
    if (/\.(?:m3u8|mp4|html|js)$/i.test(part)) return `:id${part.slice(part.lastIndexOf('.'))}`;
    return ':id';
  }).join('/');
  let shape = '';
  if (url.hostname === 'fcplayer2.blogspot.com') {
    shape = [...url.searchParams.entries()].slice(0, 12).map(([key, value]) => {
      if (!/^[a-z]{1,16}$/i.test(key)) return 'otro';
      let source = safeUrl(value);
      let kind = 'literal';
      if (!source && /^[\w+/=-]{10,4096}$/.test(value)) {
        source = safeUrl(Buffer.from(value, 'base64').toString('utf8'));
        kind = 'base64';
      }
      return `${key}:${source?.pathname.match(/\.(?:mp4|m3u8|vtt|srt)$/i) ? `${kind}-${source.hostname}${source.pathname.slice(source.pathname.lastIndexOf('.'))}` : source ? `${kind}-${source.hostname}` : 'sin-medio'}`;
    }).join(',');
  }
  return `${url.hostname}/${path}${shape ? ` (${shape})` : ''}`;
}

function playerShape($, page) {
  const videos = $('video[src],video source[src],video[data-src],video source[data-src]').toArray()
    .map((el) => urlKind($(el).attr('src') || $(el).attr('data-src'), page));
  const frames = $('iframe[src],iframe[data-src]').toArray()
    .map((el) => urlKind($(el).attr('data-src') || $(el).attr('src'), page));
  const scripts = $('script:not([src])').toArray().map((el) => $(el).html() || '');
  const markup = scripts.map((s) => unpackPacked(s) || s).join('\n');
  const signals = [...new Set([...markup.matchAll(/\b(file|src|hls|wurl|url)\s*[:=]\s*['"]((?:https?:)?\/\/[^'"\s<>]+)['"]/gi)]
    .filter((m) => /\.m3u8|\.mp4|\bwurl\b/i.test(`${m[1]} ${m[2]}`)).map((m) => `${m[1]}:${urlKind(m[2], page)}`))];
  const markers = ['jwplayer', 'videojs', 'Playerjs', 'Clappr', 'sources', 'm3u8', 'mp4', 'm3u8Url', 'data-src']
    .filter((key) => new RegExp(`\\b${key}\\b`, 'i').test(markup));
  const bits = (list) => [...new Set(list)].slice(0, 8).join(', ') || '—';
  return `video=${bits(videos)}; iframes=${bits(frames)}; literales=${bits(signals)}; señales=${bits(markers)}`;
}

const checked = new Set();
async function inspectOnce(raw, page, label) {
  const target = safeUrl(raw, page);
  if (!target || !probeHosts.has(target.hostname) || checked.has(target.hostname) || (target.pathname === '/' && !target.search)) return;
  checked.add(target.hostname);
  try {
    const html = await fetchText(target.href, { timeoutMs: 4000, maxBytes: 512 * 1024, redirect: 'manual', headers: { Referer: page } });
    annotate(`${label}: ${target.hostname}`, playerShape(load(html), target.href));
  } catch (error) {
    annotate(`${label}: ${target.hostname}`, reportError(error));
  }
}

const versionNames = new Set(['latino', 'castellano', 'subtitulado']);
const kindNames = new Set(['embed', 'iframe', 'mp4', 'hls', 'webm']);
async function probeLatin() {
  for (const fixture of playCases) {
    const label = `PlayLatinSRC / ${fixture.title}`;
    try {
      const { payload, page, reason } = await lookupPlayLatin(fixture, providerHttp(8000));
      if (!payload) { annotate(label, reason); continue; }
      const list = Array.isArray(payload.sources) ? payload.sources : [];
      const types = list.slice(0, 16).map((source) => `${urlKind(source?.url, page)}:${kindNames.has(source?.kind) ? source.kind : 'sin-tipo'}:${versionNames.has(source?.version) ? source.version : 'sin-idioma'}`);
      const keys = (obj) => Object.keys(obj || {}).filter((key) => /^[a-z_]{1,25}$/i.test(key)).join(',');
      annotate(label, `directos=${normalizeSources(payload).length}; fuentes=${list.length}; ${[...new Set(types)].join(', ') || '—'}; proxy anunciado=${list.filter((s) => typeof s?.proxy_url === 'string' && s.proxy_url).length}; campos=${keys(payload)}/${keys(list[0])}`);
      await Promise.all(list.slice(0, 16).filter((entry) => versionNames.has(entry?.version) && entry.version !== 'subtitulado').map((entry) => inspectOnce(entry.url, page, 'PlayLatinSRC')));
    } catch (error) { annotate(label, reportError(error)); }
  }
}

async function inspectLatinSeries() {
  const page = 'https://playlatinsrc.co/serial/tt0903747';
  try {
    const $ = load(await fetchText(page, { redirect: 'manual', timeoutMs: 5000, maxBytes: 1024 * 1024 }));
    const labels = $('span,div,button,strong').toArray().filter((node) => /^latino$|^castellano$|^subtitulado$/i.test($(node).text().trim()))
      .slice(0, 12).map((node) => `${node.name}${$(node).parent().attr('class') ? ` bajo ${$(node).parent().attr('class')}` : ''}: ${(node.attribs.class || '').slice(0, 70)}`);
    const tags = $('[data-version],[data-lang],[data-language],[data-imdb],[data-imdb-id]').toArray().slice(0, 12)
      .map((el) => `${el.name}: ${Object.keys(el.attribs).filter((k) => /^data-/.test(k)).join(',')}`);
    annotate('PlayLatinSRC / ficha estándar de serie', `etiquetas=${[...new Set(labels)].join('; ')}; atributos=${[...new Set(tags)].join('; ')}`);
  } catch (error) { annotate('PlayLatinSRC / ficha estándar de serie', reportError(error)); }
}

async function probeFuego() {
  for (const fixture of fuegoCases) {
    const label = `FuegoCine / ${fixture.title}`;
    try {
      const { player: $, watch, reason, skipped, catalog } = await findFuegoPlayer(fixture, fixture.title, providerHttp(8000));
      if (!$) { annotate(label, reason || skipped); continue; }
      const frames = $('iframe[src],iframe[data-src]').toArray();
      const containers = frames.map((node) => $(node).parents().toArray().slice(0, 3).map((parent) => $(parent).attr('class'))
        .filter((classes) => classes && /^[\w -]{1,100}$/.test(classes)).join(' > ')).filter(Boolean);
      annotate(label, `catálogo=${catalog}; ${playerShape($, watch)}; contenedores=${[...new Set(containers)].join(' | ') || '—'}`);
      await Promise.all(frames.slice(0, 8).map((node) => inspectOnce($(node).attr('data-src') || $(node).attr('src'), watch, 'FuegoCine')));
    } catch (error) { annotate(label, reportError(error)); }
  }
}

// Separar pasos: Actions trunca las anotaciones de un paso largo.
const group = process.argv[2];
const jobs = {
  playlatin: () => Promise.all([probeLatin(), inspectLatinSeries()]),
  fuegocine: probeFuego,
};
(group && jobs[group] ? jobs[group]() : Promise.all([probeLatin(), inspectLatinSeries(), probeFuego()]))
  .catch(() => { process.exitCode = 1; });
