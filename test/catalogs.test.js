'use strict';

/** Equilibrio movie/series del manifest: Stremio debe mostrar filas de
 *  series casi tantas como de películas. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildDefs, SERIES_GENRES } = require('../lib/catalogs');

test('manifest equilibrado: series casi tantas como películas', () => {
  const defs = buildDefs(null);
  const movies = defs.filter((d) => d.type === 'movie');
  const series = defs.filter((d) => d.type === 'series');
  assert.ok(series.length >= movies.length - 2, `series=${series.length} películas=${movies.length}`);
});

test('existen los catálogos de series por género y miniseries', () => {
  const ids = buildDefs(null).map((d) => d.id);
  for (const g of SERIES_GENRES) assert.ok(ids.includes(`tv_genero_${g.key}`), g.key);
  assert.ok(ids.includes('tv_miniseries'));
  assert.ok(ids.includes('tv_peacock'), 'plataformas actuales incluidas');
  assert.ok(ids.includes('cine_estudio_a24'), 'estudios actuales incluidos');
});

test('los catálogos de género son de series y llevan genre id', () => {
  const def = buildDefs(null).find((d) => d.id === 'tv_genero_scifi');
  assert.equal(def.type, 'series');
  assert.equal(def.kind, 'genre');
  assert.equal(def.genre, '10765');
});
