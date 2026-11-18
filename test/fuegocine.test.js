'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEARCHERS } = require('../lib/streams');

test('FuegoCine abre el reproductor de la misma película y exige doblaje por fuente', async (t) => {
  const paths = ['/', '/movies/details/demo/15', '/movies/watch/demo/15'];
  const pages = [
    '<a href="/movies/details/demo/15" title="Demo"></a>',
    '<a href="/movies/watch/demo/99">Otro</a><a href="/movies/watch/demo/15">Ver</a>',
    '<h1>Demo (2026)</h1><video data-lang="Latino"><source src="https://cdn.example/demo.mp4"></video><video src="https://cdn.example/unknown.mp4"></video>',
  ];
  t.mock.method(global, 'fetch', async (raw, init) => {
    assert.equal(new URL(raw).origin, 'https://fuegocine.com');
    assert.equal(new URL(raw).pathname, paths.shift());
    assert.equal(init.redirect, 'error');
    return new Response(pages.shift());
  });
  const hits = await SEARCHERS.fuegocine('', { title: 'Demo', year: '2026', mediaType: 'movie' });
  assert.deepEqual(hits.map((hit) => hit.url), ['https://cdn.example/demo.mp4']);
  assert.deepEqual(await SEARCHERS.fuegocine('', { title: 'Demo', mediaType: 'series' }), { skipped: 'solo películas' });
});
