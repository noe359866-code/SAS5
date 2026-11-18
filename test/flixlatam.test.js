'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('FlixLatam busca el episodio exacto con peticiones limitadas al origen', async (t) => {
  const resolved = { title: 'El título', mediaType: 'series', year: '2001', season: 2, episode: 3 };
  const pages = [card('/serie/titulo', 2001), `<div id="seasons"><div class="se-c"><div class="se-q"><span class="se-t">2</span></div>
    <ul class="episodios"><li><span class="numerando">2 - 3</span><span class="episodiotitle"><a href="/episodio/2x3">Capítulo</a></span></li></ul></div></div>`,
    '<div class="pframe"><iframe src="https://other.example/embed"></iframe><iframe src="/embed/2x3"></iframe></div>',
    player('Español Latino', 'https://cdn.example/episode.mp4')];
  const requests = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    assert.equal(init.redirect, 'manual');
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
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'manual');
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

test('FlixLatam no confunde un ancla #s1-e2 con una página de episodio', async (t) => {
  const pages = [card('/serie/titulo', 2001), `<div id="seasons"><div class="se-c"><div class="se-q"><span class="se-t">1</span></div>
    <ul class="episodios"><li><span class="numerando">1 - 2</span><span class="episodiotitle"><a href="#s1-e2">Capítulo</a></span></li></ul></div></div>
    ${player('Latino', '/reproductor-general.mp4')}`];
  t.mock.method(global, 'fetch', async () => {
    assert.ok(pages.length > 0, 'no debe volver a buscar la ficha general');
    return new Response(pages.shift());
  });
  assert.deepEqual(await searchFlixLatam('', { title: 'El título', year: 2001, mediaType: 'series', season: 1, episode: 2 }), { hits: [], reason: 'no-episode-player' });
  assert.equal(pages.length, 0);
});

test('FlixLatam admite enlaces de episodio y paneles locales solo cuando concuerdan temporada y episodio', async (t) => {
  const { findEpisode } = require('../lib/flixlatam');
  const page = 'https://flixlatam.com/serie/titulo';
  const rows = '<div id="seasons"><ul class="episodios"><li><span class="numerando">1 - 1</span><a class="episode-link" href="/episodio/titulo-1x1">Uno</a></li><li><span class="numerando">1 - 2</span><a class="episode-link" href="#s1-e2">Dos</a></li></ul></div>';
  const html = rows + `<section id="s1-e2">${player('Latino', '/episodio-dos.mp4')}</section>${player('Latino', '/general.mp4')}`;
  assert.deepEqual(findEpisode(html, page, 1, 1), { page: 'https://flixlatam.com/episodio/titulo-1x1' });
  assert.equal(findEpisode(html, page, 2, 1), null);
  t.mock.method(global, 'fetch', async (url) => new Response(url.includes('/search?') ? card('/serie/titulo', 2001) : html));
  const hits = await searchFlixLatam('', { title: 'El título', year: 2001, mediaType: 'series', season: 1, episode: 2 });
  assert.deepEqual(hits.map(({ url }) => url), ['https://flixlatam.com/episodio-dos.mp4']);
});

const show = { title: 'El título', year: 2001, mediaType: 'series', season: 1, episode: 2 };
const showPage = 'https://flixlatam.com/serie/titulo';
const routerPage = `<div id="item-context" data-type="serie" data-slug="titulo"></div><div id="episode-container" hidden></div>
  <div id="seasons"><ul class="episodios">
  <li><span class="numerando">1 - 1</span><a class="episode-link" href="#s1-e1">Uno</a></li>
  <li><span class="numerando">1 - 2</span><a class="episode-link" href="${showPage}#s1-e2">Dos</a></li></ul></div>
  ${player('Latino', '/general.mp4')}`;

for (const [identity, expected] of [
  [{}, ['https://flixlatam.com/capitulo-2.mp4']],
  [{ episodio: 1 }, { hits: [], reason: 'episode-mismatch' }],
  [{ temporada: 2 }, { hits: [], reason: 'episode-mismatch' }],
  [{ slug: 'otra-serie' }, { hits: [], reason: 'episode-mismatch' }],
]) {
  test(`FlixLatam valida la identidad del fragmento del router (${JSON.stringify(identity)})`, async (t) => {
    const urls = [];
    t.mock.method(global, 'fetch', async (url, init) => {
      urls.push(url);
      assert.equal(init.redirect, 'manual');
      if (url.includes('/search?')) return new Response(card('/serie/titulo', 2001));
      if (url === showPage) return new Response(routerPage);
      assert.equal(url, 'https://flixlatam.com/api/episodio/serie/titulo/1/2');
      assert.equal(init.headers.Accept, 'application/json');
      assert.equal(init.headers.Referer, showPage);
      return Response.json({ success: true, html: player('Latino', '/capitulo-2.mp4'), type: 'serie',
        slug: 'titulo', temporada: 1, episodio: 2, ...identity });
    });
    const result = await searchFlixLatam('', show);
    assert.deepEqual(Array.isArray(result) ? result.map((hit) => hit.url) : result, expected);
    assert.equal(urls.length, 3);
  });
}

test('FlixLatam no solicita el fragmento si la fila o el contexto del router no concuerdan', async (t) => {
  const { findEpisode } = require('../lib/flixlatam');
  assert.equal(findEpisode(routerPage.replace('data-slug="titulo"', 'data-slug="otra-serie"'), showPage, 1, 2), null);
  assert.equal(findEpisode(routerPage.replace(`${showPage}#s1-e2`, 'https://other.example/serie/titulo#s1-e2'), showPage, 1, 2), null);
  assert.equal(findEpisode(routerPage, showPage, 2, 2), null);
});

test('FlixLatam descarta iframes con extensión de vídeo, tráilers y el reproductor caducado de Uqload', () => {
  const html = `<div class="pframe"><iframe title="Latino" src="https://other.example/fake.mp4"></iframe>
    <div class="trailer"><video data-lang="Latino" src="/teaser.mp4"></video></div>
    <video data-lang="Latino" data-src="/media.mp4"></video></div>`;
  assert.deepEqual(directSources(html, showPage, 'Título').map((hit) => hit.url), ['https://flixlatam.com/media.mp4']);
  const { uqloadMedia } = require('../lib/flixlatam');
  assert.equal(uqloadMedia(`<div>File is no longer available as it expired or has been deleted.</div>
    <script>setup({file:'https://cdn.example/stale.mp4'})</script>`, 'https://uqload.vc/embed-abc.html'), null);
});
