'use strict';

// Tomar huellas del HTML público, no ejecutar scripts de las páginas ni
// imprimir su contenido (puede contener firmas, tokens y URLs de medios).
const { load } = require('cheerio');
const { fetchText } = require('../lib/http');
const { annotate } = require('./providers-live');

const controls = [
  ['FlixLatam búsqueda', 'https://flixlatam.com/search?s=Matrix'],
  ['FlixLatam película', 'https://flixlatam.com/pelicula/matrix'],
  ['FlixLatam serie', 'https://flixlatam.com/serie/breaking-bad'],
  ['Cuevana ficha', 'https://cuevanas3.pro/peliculas/matrix-1999'],
  ['CineCalidad ficha', 'https://www.cinecalidad.am/ver-pelicula/matrix/'],
  ['FuegoCine ficha', 'https://fuegocine.com/movies/details/toy-story-5/157'],
  ['FuegoCine serie', 'https://fuegocine.com/shows/details/visionquest/24'],
];

const selectors = {
  article: 'article', pframe: '.pframe', iframe: 'iframe[src],iframe[data-src]',
  video: 'video[src],video source[src]', audio: '[data-language],[data-lang]',
  episodes: '#seasons .se-c .episodios li', watch: 'a[href*="/watch/"]',
  seasonLinks: 'a[href*="/season/"],a[href*="/episodes/"]',
};

function shape(html, url) {
  const $ = load(html);
  const presence = Object.entries(selectors).map(([name, selector]) => `${name}=${$(selector).length}`).join(' ');
  const inline = $('script:not([src])').toArray().map((e) => $(e).html() || '').join('\n');
  const signals = ['dataLink', 'sortedEmbeds', 'video_language', 'sources', 'servers', 'season', 'episode', 'fetch', 'iframe', 'Anubis', '__NEXT_DATA__']
    .filter((key) => new RegExp(`\\b${key}\\b`, 'i').test(inline)).join(',') || '—';
  const ep = $('a[href="#s1-e1"]').first();
  const options = $('button,li,a,div,iframe').toArray().filter((e) => {
    const el = $(e);
    return /^(?:Audio latino|Latino|Castellano|Vimeos(?:\s*Recomendado)?|Uqload)$/i.test(el.text().trim())
      || /vimeos|uqload/i.test(el.attr('src') || el.attr('data-src') || '');
  }).slice(0, 12).map((e) => `${e.name}:${Object.keys(e.attribs).filter((k) => /^(?:data-|src|href|on|title|id|class)/.test(k)).join(',')}`);
  const schemas = $('script[type="application/ld+json"]').toArray().length;
  const same = (raw) => {
    try { const u = new URL(raw, url); return u.origin === new URL(url).origin ? u.pathname.replace(/\/\d+(?=\/|$)/g, '/:n') : null; } catch { return null; }
  };
  const nav = [...new Set($('a[href]').toArray().map((e) => same($(e).attr('href'))).filter((p) => p && /\/(?:watch|season|episodes|search|browse)\//.test(p)))].slice(0, 8).join(',') || '—';
  const attrs = ep.length ? [...new Set([ep[0], ...ep.parents('li,.episodiotitle').toArray()].flatMap((e) => Object.keys(e.attribs)))].join(',') : '—';
  return `${presence}; jsonld=${schemas}; script=${signals}; episodio=${attrs}; opciones=${[...new Set(options)].join(';') || '—'}; nav=${nav}`;
}

async function probe([label, url]) {
  try {
    const html = await fetchText(url, { timeoutMs: 8000, redirect: 'manual' });
    annotate(label, shape(html, url));
  } catch (err) {
    annotate(label, `sin HTML: ${err.challenge ? 'challenge' : err.status ? `HTTP ${err.status}` : err.timeout ? 'timeout' : 'error de red'}`);
  }
}

Promise.all(controls.map(probe)).catch(() => { process.exitCode = 1; });
