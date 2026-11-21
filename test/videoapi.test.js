'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { BASE, playerUrlOf, searchVideoApi } = require('../lib/sites/videoapi');

const FIXTURES = path.join(__dirname, 'fixtures', 'sites');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

function withMockFetch(handler, fn) {
  const previous = global.fetch;
  global.fetch = async (url, init = {}) => {
    const out = await handler(String(url), init);
    return {
      ok: (out.status || 200) >= 200 && (out.status || 200) < 300,
      status: out.status || 200,
      url: out.url || String(url),
      headers: new Headers(out.headers || { 'content-type': 'text/html; charset=utf-8' }),
      text: async () => out.body || '',
    };
  };
  return Promise.resolve().then(fn).finally(() => { global.fetch = previous; });
}

test('videoapi: construye URLs de reproductor por TMDb ID para película y serie', () => {
  assert.equal(playerUrlOf({ mediaType: 'movie', tmdbId: 550 }), `${BASE}/e/movie/550`);
  assert.equal(playerUrlOf({ mediaType: 'series', tmdbId: 1399, season: 1, episode: 2 }), `${BASE}/e/tv/1399/1/2`);
  assert.equal(playerUrlOf({ mediaType: 'movie' }), null);
  assert.equal(playerUrlOf({ mediaType: 'series', tmdbId: 1399 }), null);
});

test('videoapi película: player → Vimeos → HLS y subtítulos', async () => {
  const playerHtml = readFixture('pelisjuanita-player.html');
  const embedHtml = readFixture('pelisjuanita-embed.html');
  const seen = [];

  await withMockFetch((url, init) => {
    seen.push({ url, referer: init?.headers?.Referer || init?.headers?.referer || null });
    if (url === `${BASE}/e/movie/969681`) return { body: playerHtml };
    if (url.includes('vimeos.net/')) return { body: embedHtml };
    return { status: 404, body: '' };
  }, async () => {
    const res = await searchVideoApi('Spider-Man', {
      mediaType: 'movie',
      title: 'Spider-Man: Un nuevo día',
      tmdbId: 969681,
    });
    assert.equal(res.hits.length, 1);
    assert.equal(res.hits[0].provider, 'videoapi');
    assert.equal(res.hits[0].quality, 'HLS');
    assert.equal(res.hits[0].audioLabel, 'Subtitulado');
    assert.match(res.hits[0].url, /master\.m3u8/);
    assert.ok(res.hits[0].subtitles.length >= 1);
    assert.equal(seen[0].referer, `${BASE}/`);
  });
});

test('videoapi serie: player /e/tv/<id>/<S>/<E> → Vimeos → HLS', async () => {
  const playerHtml = readFixture('pelisjuanita-player-episodio.html');
  const embedHtml = readFixture('pelisjuanita-embed-episodio.html');

  await withMockFetch((url) => {
    if (url === `${BASE}/e/tv/250307/1/1`) return { body: playerHtml };
    if (url.includes('vimeos.net/')) return { body: embedHtml };
    return { status: 404, body: '' };
  }, async () => {
    const res = await searchVideoApi('Serie', {
      mediaType: 'series',
      title: 'El caballero',
      tmdbId: 250307,
      season: 1,
      episode: 1,
    });
    assert.equal(res.hits.length, 1);
    assert.equal(res.hits[0].provider, 'videoapi');
    assert.match(res.hits[0].title, /S01E01 VideoAPI$/);
  });
});

test('videoapi: sin tmdbId o sin episodio devuelve razón clara sin consultar red', async () => {
  const noTmdb = await searchVideoApi('Algo', { mediaType: 'movie', title: 'Algo' });
  assert.deepEqual(noTmdb, { hits: [], reason: 'no-tmdb-id' });

  const noEp = await searchVideoApi('Serie', { mediaType: 'series', title: 'Serie', tmdbId: 123 });
  assert.deepEqual(noEp, { skipped: 'episode-required' });
});
