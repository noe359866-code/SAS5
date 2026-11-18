'use strict';

// Huellas del HTML público. Nunca se imprime HTML, respuesta JSON, firmas o
// contenido de scripts; solo selectores, rutas públicas y tipos de valores.
const { load } = require('cheerio');
const { fetchText } = require('../lib/http');
const { annotate } = require('./providers-live');

const controls = [
  ['FlixLatam película', 'https://flixlatam.com/pelicula/matrix'],
  ['FlixLatam serie', 'https://flixlatam.com/serie/breaking-bad'],
  ['Cuevana ficha', 'https://cuevanas3.pro/peliculas/matrix-1999/'],
  ['CineCalidad búsqueda', 'https://www.cinecalidad.am/page/1?s=Matrix'],
  ['CineCalidad ficha', 'https://www.cinecalidad.am/ver-pelicula/matrix/'],
  ['FuegoCine Visor', 'https://fuegocine.com/movies/watch/toy-story-5/157'],
  ['FuegoCine Episodio', 'https://fuegocine.com/shows/visionquest/01x01-sin-ataduras/49'],
  ['AnimeOnlineNinja búsqueda', 'https://ww4.animeonline.ninja/search/?s=Naruto'],
  ['AnimeOnlineNinja episodio', 'https://ww4.animeonline.ninja/episodio/naruto-cap-1/'],
];

function shape(html, url) {
  const $ = load(html);
  const origin = new URL(url).origin;
  const marker = (node) => `${node.name}${(node.attribs.class || '').split(/\s+/).slice(0, 3).filter(Boolean).map((v) => `.${v.replace(/[^\w-]/g, '')}`).join('')}`;
  const kind = (value) => {
    if (!value) return 'vacío';
    if (value.startsWith('#')) return 'ancla';
    if (/^javascript:/i.test(value)) return 'js';
    if (/^\d+$/.test(value)) return 'número';
    if (/^\w{1,24}$/.test(value)) return 'identificador';
    if (/^https?:\/\/|^\/(?!\/)/i.test(value)) {
      try {
        const target = new URL(value, url);
        const type = /\.(?:mp4|m3u8)$/i.exec(target.pathname)?.[0] || '';
        return target.origin === origin ? `ruta${type}` : `${target.hostname}${type}`;
      } catch { /* valor opaco */ }
    }
    return /<iframe\b/i.test(value) ? 'iframe' : /^[\w/+=-]{32,}$/.test(value) ? 'opaco' : 'texto';
  };
  const describe = (e) => `${marker(e)}(${Object.keys(e.attribs).filter((k) => /^(?:data-|src|href|onclick)/.test(k))
    .map((k) => `${k}:${k === 'onclick' ? /^[\w.$]+(?=\()/i.exec(e.attribs[k])?.[0] || 'js' : kind(e.attribs[k])}`).join(',')})`;
  const nodes = (selector, n) => [...new Set($(selector).toArray().slice(0, n).map(describe))].join(' ') || '—';
  const inline = $('script:not([src])').toArray().map((e) => $(e).html() || '').join('\n');
  const routes = [...new Set([...inline.matchAll(/\b(?:fetch|\.get|\.post)\(\s*['"](\/[a-z][\w/-]{2,55})[?'"`]/gi)]
    .map((match) => match[1]).filter((route) => !/token|session|challenge|login|account/.test(route)))].slice(0, 8).join(',') || '—';
  const signals = ['dataLink', 'sortedEmbeds', 'video_language', 'sources', 'servers', 'episode', 'fetch', 'iframe', 'Anubis', 'atob']
    .filter((key) => new RegExp(`\\b${key}\\b`, 'i').test(inline)).join(',') || '—';
  const row = $('#seasons .episodios li').first();
  const options = $('[data-option],.ODDIV li[onclick],.pframe,[data-embed]').toArray().slice(0, 10).map(describe).join(' ') || '—';
  const headline = $('a[href*="/ver-pelicula/matrix/"],a[href*="/online/naruto-100724/"]').first();
  const headings = headline.find('h2,h3,.title,.year,time,span').toArray().slice(0, 8).map(marker).join(',') || '—';
  return `scripts=${signals}; rutas=${routes}; video=${nodes('video,video source', 6)}; iframes=${nodes('iframe', 6)}; opciones=${options}; episodio=${row.length ? [describe(row[0]), ...row.find('a,button').toArray().slice(0, 5).map(describe)].join(' ') : '—'}; enlaces=${headings}`;
}

async function probe([label, url]) {
  try {
    const html = await fetchText(url, { timeoutMs: 8000, redirect: 'manual', maxBytes: 2 * 1024 * 1024 });
    annotate(label, shape(html, url));
  } catch (err) {
    annotate(label, `sin HTML: ${err.challenge ? 'challenge' : err.status ? `HTTP ${err.status}` : err.timeout ? 'timeout' : 'error de red'}`);
  }
}

Promise.all(controls.map(probe)).catch(() => { process.exitCode = 1; });
