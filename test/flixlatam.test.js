'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const { activeProviders } = require('../lib/streams');
const { findShow, directSources, searchFlixLatam } = require('../lib/flixlatam');

const card = (url, year) => `<article><h3><a href="${url}">El título</a></h3><span class="year">${year}</span></article>`;
const player = (audio, link) => `<script>const dataLink = ${JSON.stringify([{ video_language: audio, sortedEmbeds: [{ servername: 'CDN', link }] }])};</script>`;

test('FlixLatam exige título, tipo, año y origen compatibles', () => {
  const html = card('/pelicula/remake', 2026) + card('/serie/titulo', 2001) + card('/pelicula/original', 2001);
  const resolved = { mediaType: 'movie', year: '2001' };
  assert.equal(findShow(html, 'El titulo', resolved), 'https://flixlatam.com/pelicula/original');
  assert.equal(findShow(html, 'El título', { mediaType: 'movie' }), null);
  assert.equal(findShow(card('https://other.example/pelicula/titulo', 2001), 'El título', resolved), null);
});

test('FlixLatam descarta audio no permitido, reproductores HTML, publicidad y tokens', () => {
  const html = player('Latino', 'https://cdn.example/manifest.m3u8') + player('Latino Inglés', '/dual.mp4')
    + player('Castellano', '/dub.mp4') + player('Latino', '/player') + player('Latino', '/ads/video.mp4')
    + player('Latino', 'header.payload.signature') + player('', '/unknown.mp4');
  assert.deepEqual(directSources(html, 'https://flixlatam.com/peliculas/test', 'Título').map((hit) => hit.url), ['https://cdn.example/manifest.m3u8', 'https://flixlatam.com/dub.mp4']);
});

test('FlixLatam es opt-in y busca el episodio exacto con peticiones limitadas al origen', async (t) => {
  const previous = { enabled: config.flixlatamEnabled, providers: config.streamProviders };
  t.after(() => { config.flixlatamEnabled = previous.enabled; config.streamProviders = previous.providers; });
  const resolved = { title: 'El título', mediaType: 'series', year: '2001', season: 2, episode: 3 };
  config.flixlatamEnabled = false;
  assert.equal(activeProviders().includes('flixlatam'), false);
  assert.deepEqual(await searchFlixLatam('', resolved), { skipped: 'disabled' });
  config.flixlatamEnabled = true;
  config.streamProviders = ['flixlatam'];
  assert.deepEqual(activeProviders(), ['flixlatam']);
  const pages = [card('/serie/titulo', 2001), `<div id="seasons"><div class="se-c"><div class="se-q"><span class="se-t">2</span></div>
    <ul class="episodios"><li><span class="numerando">2 - 3</span><span class="episodiotitle"><a href="/episodio/2x3">Capítulo</a></span></li></ul></div></div>`,
    '<div class="pframe"><iframe src="https://other.example/embed"></iframe><iframe src="/embed/2x3"></iframe></div>',
    player('Español Latino', 'https://cdn.example/episode.mp4')];
  const requests = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    assert.equal(init.redirect, 'error');
    requests.push(url);
    return new Response(pages.shift());
  });
  assert.deepEqual(await searchFlixLatam('', { ...resolved, episode: null }), { skipped: 'episode-required' });
  const hits = await searchFlixLatam('', resolved);
  assert.deepEqual(requests, ['https://flixlatam.com/search?s=El+t%C3%ADtulo', 'https://flixlatam.com/serie/titulo',
    'https://flixlatam.com/episodio/2x3', 'https://flixlatam.com/embed/2x3']);
  assert.equal(hits[0].url, 'https://cdn.example/episode.mp4');
});

test('FlixLatam resuelve un embed público Uqload sin ejecutar JavaScript', async (t) => {
  const previous = config.flixlatamEnabled;
  config.flixlatamEnabled = true;
  t.after(() => { config.flixlatamEnabled = previous; });
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'error');
    if (url.includes('/search?')) return new Response(card('/pelicula/titulo', 2001));
    if (url.endsWith('/pelicula/titulo')) return new Response('<div class="pframe"><iframe title="Castellano" src="https://uqload.vc/embed-abc.html"></iframe><iframe title="Latino" src="https://uqload.vc.evil.example/embed-abc.html"></iframe><iframe title="Uqload" src="https://uqload.vc/embed-unlabeled.html"></iframe></div>');
    assert.equal(url, 'https://uqload.vc/embed-abc.html');
    assert.equal(init.headers.Referer, 'https://flixlatam.com/pelicula/titulo');
    return new Response(`<script>setup({file:'https://cdn.example/video.mp4'})</script>`);
  });
  const hits = await searchFlixLatam('', { title: 'El título', mediaType: 'movie', year: '2001' });
  assert.equal(calls.length, 3);
  assert.deepEqual(hits.map(({ url, referer, audioLabel }) => ({ url, referer, audioLabel })), [{
    url: 'https://cdn.example/video.mp4', referer: 'https://uqload.vc/', audioLabel: 'Castellano',
  }]);
});
