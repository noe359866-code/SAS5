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
