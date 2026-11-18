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
    assert.equal(init.redirect, 'manual');
    return new Response(pages.shift());
  });
  const hits = await SEARCHERS.fuegocine('', { title: 'Demo', year: '2026', mediaType: 'movie' });
  assert.deepEqual(hits.map((hit) => hit.url), ['https://cdn.example/demo.mp4']);
  assert.deepEqual(await SEARCHERS.fuegocine('', { title: 'Demo', mediaType: 'series' }), { skipped: 'episode-required' });
});

test('FuegoCine verifica la serie, la temporada y el episodio antes de leer el vídeo', async (t) => {
  const pages = new Map([
    ['/', '<a href="/shows/details/demo/24" title="Demo"></a>'],
    ['/shows/details/demo/24', '<h1>Demo (2026)</h1><a href="/shows/otra/seasons/temporada-2/17"></a><a href="/shows/demo/seasons/temporada-2/55"></a>'],
    ['/shows/demo/seasons/temporada-2/55', '<a href="/shows/demo/01x01-otro/12"></a><a href="/shows/otra/02x01-piloto/14"></a><a href="/shows/demo/02x01-episodio/55"></a>'],
    ['/shows/demo/02x01-episodio/55', '<a href="/shows?lang_id=8">Latino</a><video><source src="https://cdn.example/episodio.mp4"></video><section id="trailer"><video src="https://cdn.example/trailer.mp4"></video></section>'],
  ]);
  t.mock.method(global, 'fetch', async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://fuegocine.com');
    assert.ok(pages.has(url.pathname), url.pathname);
    assert.equal(init.redirect, 'manual');
    const html = pages.get(url.pathname);
    pages.delete(url.pathname);
    return new Response(html);
  });
  const hits = await SEARCHERS.fuegocine('', { title: 'Demo', year: '2026', mediaType: 'series', season: 2, episode: 1 });
  assert.deepEqual(hits.map(({ url }) => url), ['https://cdn.example/episodio.mp4']);
  assert.equal(pages.size, 0);
});

test('FuegoCine encuentra en el sitemap una obra fuera de portada y no consulta enlaces externos', async (t) => {
  const pages = new Map([
    ['/', '<a href="/movies/details/otra/13">Otra</a>'],
    ['/sitemap-movies.xml', '<?xml version="1.0"?><urlset><url><loc>https://otra.example/movies/details/el-pequeno/87</loc></url><url><loc>https://fuegocine.com/movies/details/el-peque%C3%B1o/32</loc></url><url><loc>https://fuegocine.com/shows/details/el-pequeno/9</loc></url></urlset>'],
    ['/movies/details/el-peque%C3%B1o/32', '<title>El pequeño | Fuego Cine</title><a href="/movies/watch/el-peque%C3%B1o/32">Play</a>'],
    ['/movies/watch/el-peque%C3%B1o/32', '<h2>El pequeño (2007)</h2><video data-language="Latino" src="https://cdn.example/movie.mp4"></video>'],
  ]);
  const cache = require('../lib/cache');
  t.after(() => cache.deletePrefix('fuegocine:sitemap:'));
  t.mock.method(global, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(new URL(url).origin, 'https://fuegocine.com');
    assert.equal(init.redirect, 'manual');
    assert.ok(pages.has(path), path);
    const html = pages.get(path);
    pages.delete(path);
    return new Response(html);
  });
  const hits = await SEARCHERS.fuegocine('', { title: 'El pequeño', year: '2007', mediaType: 'movie' });
  assert.deepEqual(hits.map(({ url }) => url), ['https://cdn.example/movie.mp4']);
  assert.equal(pages.size, 0);
});
