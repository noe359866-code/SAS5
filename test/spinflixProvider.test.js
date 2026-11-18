'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runProviders } = require('../lib/streams');

test('SpinFlix verifica la ficha y devuelve solo HLS con doblaje válido', async (t) => {
  const master = 'https://s9.vimeos.net/fixture/master.m3u8';
  const embed = 'https://vimeos.net/embed-fixture';
  const movie = { imdb_id: 'tt900101', title: 'Prueba SpinFlix', year: 2025, slug: 'prueba-spinflix', type: 'movies' };
  const calls = [];
  t.mock.method(global, 'fetch', async (raw, init) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    assert.equal(init.redirect, 'manual');
    if (url.pathname === '/search') return Response.json({ results: [movie] });
    if (url.pathname === '/pelicula/prueba-spinflix') return Response.json({ ...movie, embeds: { video: [
      { link: 'https://vimeos.net/embed-english', language: 'Inglés' },
      { link: 'https://vimeos.net.evil.example/embed', language: 'Latino' },
      { link: embed, language: 'Castellano' },
    ] } });
    assert.equal(url.pathname, '/streamurl');
    assert.equal(url.searchParams.get('url'), embed);
    return Response.json({ qualities: [{ url: master }] });
  });
  const resolved = { title: movie.title, year: '2025', mediaType: 'movie', imdbId: movie.imdb_id };
  const hits = await runProviders(['spinflix'], movie.title, resolved, movie.title, {});
  assert.deepEqual(calls, ['/search', '/pelicula/prueba-spinflix', '/streamurl']);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'spinflix');
  assert.equal(hits[0].audioLabel, 'Castellano');
  assert.equal(hits[0].directUrl, master);
});
