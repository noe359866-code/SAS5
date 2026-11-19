'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchVideoApp, frameFromPage, videoappPath } = require('../lib/videoapp');
const { runProviders } = require('../lib/streams');

const movie = { title: 'Interestelar', mediaType: 'movie', tmdbId: 157336, tmdbType: 'movie' };
const embed = 'https://vimeos.net/embed-voyzexg50uaj.html?cf=fixture-token';
const master = 'https://s9.vimeos.net/fixture/master.m3u8';
const fixture = (attributes = '') => `<iframe id="frame" src="${embed}" ${attributes}></iframe>`;

test('VideoApp: URL por TMDB y validación estricta del iframe', () => {
  assert.equal(videoappPath(movie), '/e/movie/157336');
  assert.equal(videoappPath({ ...movie, mediaType: 'series', tmdbType: 'tv', season: 1, episode: 2 }), '/e/tv/157336/1/2');
  assert.equal(videoappPath({ ...movie, tmdbType: 'tv' }), null);
  assert.equal(videoappPath({ ...movie, tmdbId: '1/../../foo' }), null);
  assert.equal(frameFromPage('<iframe id="frame" src="https://vimeos.net.evil.example/embed-x.html"></iframe>'), null);
  assert.equal(frameFromPage('<iframe id="frame" src="http://vimeos.net/embed-x.html"></iframe>'), null);
  assert.equal(frameFromPage(fixture() + fixture()), null);
  assert.equal(frameFromPage(fixture()).url, embed);
});

test('VideoApp: extrae HLS del iframe y conserva el audio solo cuando está identificado', async (t) => {
  const seen = [];
  t.mock.method(global, 'fetch', async (raw, options) => {
    seen.push(String(raw));
    assert.equal(options.redirect, 'manual');
    if (raw === 'https://videoapp.zip/e/movie/157336') return new Response(fixture('data-lang="Latino"'));
    if (raw === embed) return new Response(`<script>var source = '${master}'</script>`);
    throw new Error('el manifiesto no se descarga');
  });
  const report = {};
  const hits = await runProviders(['videoapp'], '', movie, movie.title, report, 1000);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, master);
  assert.equal('verification' in hits[0], false);
  assert.equal(hits[0].audioLabel, 'Latino');
  assert.equal(seen.length, 2, 'ficha e iframe; el CDN no se toca');
  assert.ok(!JSON.stringify(report).includes('fixture-token'));
});

test('VideoApp: la muestra sin etiqueta de audio no se presenta falsamente como Latino', async (t) => {
  t.mock.method(global, 'fetch', async (raw) => {
    if (raw === 'https://videoapp.zip/e/movie/157336') return new Response(fixture());
    if (raw === embed) return new Response(`<script>var source = '${master}'</script>`);
    throw new Error('el manifiesto no se descarga');
  });
  assert.deepEqual(await searchVideoApp('', movie, movie.title, 1000), { hits: [], reason: 'audio-unverified' });
});

test('VideoApp: rechaza el embed desconocido y no consulta redes externas', async (t) => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return new Response('<iframe id="frame" src="https://external.example/embed-test.html"></iframe>');
  });
  assert.deepEqual(await searchVideoApp('', movie, movie.title, 1000), { hits: [], reason: 'no-supported-embed' });
  assert.equal(calls, 1);
});

test('VideoApp: sin TMDB válido no hace peticiones', async (t) => {
  t.mock.method(global, 'fetch', () => { throw new Error('no debe consultar'); });
  assert.deepEqual(await searchVideoApp('', { ...movie, tmdbId: null }, movie.title, 1000), { skipped: 'tmdb-or-episode-required' });
});
