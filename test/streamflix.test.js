'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const cache = require('../lib/cache');
const config = require('../lib/config');
const { mountStreamflix } = require('../node/streamflix');

const MOVIES = 'https://pelisflixhd.love';
const SERIES = 'https://seriesflixhd.boats';
const MATRIX = `${MOVIES}/pelicula/the-matrix-zgdg/`;
const EPISODE = `${SERIES}/episodio/breaking-bad-zpya-1x2/`;
const META = 'https://v3-cinemeta.strem.io/meta/movie/tt0133093.json';
const TV_META = 'https://api.tvmaze.com/lookup/shows?imdb=tt0903747';
const MOVIE_SEARCH = `${MOVIES}/busqueda/The%20Matrix`;
const SERIES_SEARCH = `${SERIES}/?s=Breaking+Bad`;
const SLUG = '/streamflix/stream';
const movieMeta = () => Response.json({ meta: { name: 'The Matrix', releaseInfo: '1999' } });
const card = (url, name, year = '') => `<a href="${url}"><div class="item-detail"><p>${name}</p></div><span class="card-hover-year">${year}</span></a>`;
const movie = (year, options) => `<article class="backdrop-info"><time itemprop="datePublished">${year}</time></article><div id="player">${options}</div>`;
const serverOption = (label) => `<li data-server="aHR0cHM6Ly9leGFtcGxlLmludmFsaWQvZml4dHVyZQ=="><span>${label}</span><button>Reproducir</button></li>`;

async function setup(t, sources, pages = {}) {
  config.reload({});
  cache.deletePrefix('streamflix-web:v1:');
  cache.del(META);
  cache.del(TV_META);
  const seen = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    const href = String(url);
    seen.push(href);
    assert.ok(Object.hasOwn(pages, href), `Petición inesperada a ${href}`);
    if (href.startsWith(MOVIES) || href.startsWith(SERIES)) {
      assert.equal(init.redirect, 'manual');
      assert.deepEqual(init.headers, { Accept: 'text/html' });
    }
    const body = pages[href];
    return typeof body === 'function' ? body() : new Response(body);
  });
  const app = express();
  mountStreamflix(app, sources);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    config.reload();
    await new Promise((resolve) => server.close(resolve));
  });
  // La petición local no comparte el mock que controla el tráfico saliente.
  const { get } = require('node:http');
  const request = (path) => new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${server.address().port}${path}`, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
      res.on('error', reject);
    }).on('error', reject);
  });
  return { request, seen };
}

test('fuentes web de Node: off no instala rutas ni consulta proveedores', async (t) => {
  const { request, seen } = await setup(t, 'off,pelisflixhd');
  assert.equal((await request('/streamflix/manifest.json')).status, 404);
  assert.equal((await request(`${SLUG}/movie/tt0133093.json`)).status, 404);
  assert.deepEqual(seen, []);
});

test('PelisflixHD: enlace externo de la película exacta con audio anunciado y caché propia', async (t) => {
  const { request, seen } = await setup(t, 'pelisflixhd', {
    [META]: movieMeta,
    [MOVIE_SEARCH]: card('/pelicula/the-matrix-reloaded/', 'The Matrix Reloaded', '1999')
      + card('/pelicula/remake/', 'The Matrix', '2026')
      + card('https://example.invalid/pelicula/matrix/', 'The Matrix', '1999')
      + card(MATRIX, 'The Matrix', '1999'),
    [MATRIX]: movie('1999-03-31', serverOption('Opción 1 · Latino') + serverOption('Opción 2 · Español Castellano') + serverOption('Subtitulado')),
  });
  const manifest = (await request('/streamflix/manifest.json')).json();
  assert.notEqual(manifest.id, 'org.comunidad.catalogos.plus');
  assert.deepEqual(manifest.resources, ['stream']);
  assert.deepEqual(manifest.types, ['movie']);
  const link = `${SLUG}/movie/tt0133093.json`;
  const [first, second] = await Promise.all([request(link), request(link)]);
  const expected = { streams: [{
    name: 'PelisflixHD · Web', description: 'Abrir en el navegador\nLatino / Castellano (según la ficha)', externalUrl: MATRIX,
  }] };
  assert.equal(first.status, 200);
  assert.deepEqual(first.json(), expected);
  assert.deepEqual(second.json(), expected);
  assert.deepEqual((await request(link)).json(), expected);
  assert.deepEqual(seen, [META, MOVIE_SEARCH, MATRIX]);
});

test('PelisflixHD: un año no confirmado o solo subtítulos no se presenta como resultado', async (t) => {
  for (const [title, year, options] of [
    ['sin año', '', serverOption('Latino')],
    ['año distinto', '2026', serverOption('Latino')],
    ['solo subtítulos', '1999', serverOption('Subtitulado Latino')],
  ]) {
    await t.test(title, async (sub) => {
      const { request } = await setup(sub, 'pelisflixhd', {
        [META]: movieMeta,
        [MOVIE_SEARCH]: card(MATRIX, 'The Matrix'),
        [`${MOVIES}/busqueda/Matrix`]: '',
        [MATRIX]: movie(year, options),
      });
      const reply = await request(`${SLUG}/movie/tt0133093.json`);
      assert.equal(reply.headers['cache-control'], 'no-store');
      assert.deepEqual(reply.json(), { streams: [] });
    });
  }
});

test('SeriesFlix: exige serie, temporada y episodio; no toma el enlace anterior o de otra serie', async (t) => {
  const show = `${SERIES}/serie/breaking-bad-zpya/`;
  const season = `${SERIES}/temporada/breaking-bad-zpya-1/`;
  const { request, seen } = await setup(t, 'seriesflix', {
    [TV_META]: () => Response.json({ name: 'Breaking Bad', premiered: '2008-01-20' }),
    [SERIES_SEARCH]: `<article class="TPost B"><a href="${show}"><h2 class="Title">Breaking Bad</h2><span class="Year">2008</span></a></article>`,
    [show]: '<a href="/temporada/breaking-bad-zpya-2/">Temporada 1</a>'
      + '<a href="/temporada/otra-1/">Temporada 1</a>' + `<a href="${season}">Temporada 1</a>`,
    [season]: '<section class="SeasonBx"><table class="TPTblCn">'
      + `<tr><td class="Num">1</td><td class="MvTbTtl"><a href="${EPISODE}">Anterior</a></td></tr>`
      + '<tr><td class="Num">2</td><td class="MvTbTtl"><a href="/episodio/otra-1x2/">Otro</a></td></tr>'
      + `<tr><td class="Num">2</td><td class="MvTbTtl"><a href="${EPISODE}">El gato está en la bolsa...</a></td></tr>`
      + '</table></section>',
    [EPISODE]: '<div class="optns-bx"><div class="drpdn"><button class="bstd">LATINO<span>Idioma</span></button>'
      + '<a class="Button sgty" data-url="aHR0cHM6Ly9leGFtcGxlLmludmFsaWQvZml4dHVyZQ==">01</a></div></div>',
  });
  for (const path of [`${SLUG}/series/tt0903747.json`, `${SLUG}/series/tmdb:movie:603:1:2.json`, `${SLUG}/series/https%3A%2F%2Fexample.invalid.json`]) {
    assert.deepEqual((await request(path)).json(), { streams: [] });
  }
  assert.deepEqual(seen, []);
  const reply = await request(`${SLUG}/series/tt0903747%3A1%3A2.json`);
  assert.deepEqual(reply.json(), { streams: [{
    name: 'SeriesFlix · Web', description: 'Abrir en el navegador\nLatino (según la ficha)', externalUrl: EPISODE,
  }] });
  assert.deepEqual(seen, [TV_META, SERIES_SEARCH, show, season, EPISODE]);
});

test('fuentes web de Node: ante un challenge o una redirección no reintenta ni sigue destinos', async (t) => {
  for (const [title, response] of [
    ['challenge', () => new Response('No', { status: 403, headers: { 'cf-mitigated': 'challenge' } })],
    ['redirección', () => new Response('', { status: 302, headers: { Location: 'https://example.invalid/movie' } })],
  ]) {
    await t.test(title, async (sub) => {
      const { request, seen } = await setup(sub, 'pelisflixhd,seriesflix', { [META]: movieMeta, [MOVIE_SEARCH]: response });
      assert.deepEqual((await request(`${SLUG}/movie/tt0133093.json`)).json(), { streams: [] });
      assert.deepEqual(seen, [META, MOVIE_SEARCH]);
    });
  }
});
