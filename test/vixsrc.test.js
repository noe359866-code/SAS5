'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { apiPath, embedUrl, playlistFromHtml, searchVixsrc } = require('../lib/vixsrc');
const config = require('../lib/config');
const streams = require('../lib/streams');
const original = global.fetch;
after(() => { global.fetch = original; });
const expiry = Math.floor(Date.now() / 1000) + 1800;
// Representa la estructura descrita por VixSrcExtractor de Streamflix, no una captura HTML real.
const html = `<script>window.video = { id: '214325', }; window.masterPlaylist = { url: '/playlist/214325?b=1', 'token': 'abc123', 'expires': '${expiry}', }; window.canPlayFHD = true;</script>`;
test('rutas TMDB y URL del embed se validan', () => {
  assert.equal(apiPath({ tmdbId: 603, mediaType: 'movie' }), '/api/movie/603?lang=en');
  assert.equal(apiPath({ tmdbId: 1396, mediaType: 'series', season: 1, episode: 1 }), '/api/tv/1396/1/1?lang=en');
  assert.equal(apiPath({ tmdbId: 1396, mediaType: 'series', season: 1 }), null);
  assert.equal(apiPath({ tmdbId: 3, mediaType: 'other', season: 1, episode: 1 }), null);
  assert.equal(embedUrl('//evil.test/embed/5?x=1'), null);
  assert.equal(embedUrl('/embed/214325?token=abc'), 'https://vixsrc.to/embed/214325?token=abc');
});
test('playlist solo a partir de literales válidos y no expirados', () => {
  const result = playlistFromHtml(html);
  const url = new URL(result.url);
  assert.equal(url.pathname, '/playlist/214325');
  assert.equal(url.searchParams.get('token'), 'abc123');
  assert.equal(url.searchParams.get('b'), '1');
  assert.equal(url.searchParams.get('h'), '1');
  assert.equal(result.expiresAt, expiry * 1000);
  assert.equal(playlistFromHtml(html.replace(String(expiry), '1')), null);
  assert.equal(playlistFromHtml('<script>evil()</script>'), null);
});
test('dos fetch y Referer válido', async () => {
  const calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return calls.length === 1 ? Response.json({ src: '/embed/214325?token=abc' }) : new Response(html); };
  const result = await searchVixsrc('', { title: 'Matrix', mediaType: 'movie', tmdbId: 603 }, 'Matrix', 1000);
  assert.equal(calls.length, 2);
  assert.equal(result.hits.length, 1);
  assert.equal(streams.toDirectStream(result.hits[0], {}).behaviorHints.proxyHeaders.request.Referer, 'https://vixsrc.to/embed/214325?token=abc');
});
test('desactivado no hace peticiones', async () => {
  const old = config.vixsrcEnabled;
  try { config.vixsrcEnabled = false; assert.match((await searchVixsrc('', { title: 'Matrix', mediaType: 'movie', tmdbId: 603 }, 'Matrix')).skipped, /desactivado/); }
  finally { config.vixsrcEnabled = old; }
});
