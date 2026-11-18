'use strict';

/**
 * Regresión: Stremio usa "series" pero TMDB usa "tv".
 * Antes, los catálogos de series llamaban a /trending/series/week y
 * /discover/series (404 -> metas vacías). Solo TVMaze mostraba algo.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.TMDB_API_KEY;
delete process.env.TMDB_ACCESS_TOKEN;

const { tmdbMediaType } = require('../lib/tmdb');

test('tmdbMediaType mapea Stremio -> TMDB', () => {
  assert.equal(tmdbMediaType('series'), 'tv');
  assert.equal(tmdbMediaType('tv'), 'tv'); // idempotente
  assert.equal(tmdbMediaType('movie'), 'movie');
  assert.equal(tmdbMediaType('anything-else'), 'movie'); // nunca 'undefined' en URL
});

test('metas TMDB de series generan ids canónicos tv, no series', () => {
  const { mapTmdbItem } = require('../lib/tmdb');
  const meta = mapTmdbItem({ id: 1399, name: 'Una serie' }, 'series');
  assert.equal(meta.id, 'tmdb:tv:1399');
  assert.equal(meta.type, 'series');
  assert.equal(mapTmdbItem({ id: 550, title: 'Una película' }, 'movie').id, 'tmdb:movie:550');
});

test('la tarjeta del catálogo no repite el año y resume los votos en una línea', () => {
  const { mapTmdbItem } = require('../lib/tmdb');
  const meta = mapTmdbItem({
    id: 157336, title: 'Interestelar', release_date: '2014-11-05', vote_average: 8.4, vote_count: 38000,
    overview: 'Sinopsis.', poster_path: '/p.jpg',
  }, 'movie');
  assert.equal(meta.releaseInfo, '2014');
  assert.equal(meta.imdbRating, '8.4');
  assert.equal(meta.description, 'Sinopsis.\n\n⭐ TMDB 8.4/10 · 38,000 votos');
  assert.doesNotMatch(meta.description, /🗓/, 'el año ya va en releaseInfo');
  // Sin sinopsis ni votos la tarjeta sigue siendo válida (nunca vacía).
  assert.equal(mapTmdbItem({ id: 1, title: 'X', vote_average: 0 }, 'movie').description, '⭐ TMDB 0.0/10');
});
