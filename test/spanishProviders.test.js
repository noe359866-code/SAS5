'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEARCHERS } = require('../lib/streams');
const { pickEpisode } = require('../lib/spanishProviders');

for (const [key, origin, search, path] of [
  ['cuevana3', 'https://cuevanas3.pro', '/search/el%20t%C3%ADtulo/', '/peliculas/titulo-2025'],
  ['cinecalidad', 'https://www.cinecalidad.am', '/page/1?s=El%20t%C3%ADtulo', '/ver-pelicula/titulo-2025'],
  ['animeonlineninja', 'https://ww4.animeonline.ninja', '/search/?s=El%20t%C3%ADtulo', '/pelicula/titulo-2025'],
  ['tioplus', 'https://tioplus.app', '/search/El%20t%C3%ADtulo', '/pelicula/titulo-2025'],
]) {
  test(`${key}: título exacto, mismo origen y solo vídeo con doblaje identificado`, async (t) => {
    const pages = [
      [`${origin}${search}`, `<article><a href="${path}"><h2>El título (2025)</h2></a></article><article><a href="https://other.example${path}">El título (2025)</a></article>`],
      [`${origin}${path}`, `<video data-language="Castellano" src="https://cdn.example/test.mp4"></video>
        <video src="https://cdn.example/unknown.mp4"></video><iframe data-lang="Latino" src="https://example.com/embed"></iframe>`],
    ];
    t.mock.method(global, 'fetch', async (url, init) => {
      const [expected, html] = pages.shift();
      assert.equal(url, expected);
      assert.equal(init.redirect, 'manual');
      return new Response(html);
    });
    const hits = await SEARCHERS[key]('', { title: 'El título', mediaType: 'movie', year: '2025' });
    assert.equal(pages.length, 0);
    assert.deepEqual(hits.map(({ provider, audioLabel, url }) => [provider, audioLabel, url]), [[key, 'Castellano', 'https://cdn.example/test.mp4']]);
  });
}

test('selecciona temporada y episodio explícitos, no solo un número de episodio', () => {
  const page = 'https://cuevanas3.pro/series/demo';
  const html = '<a href="/episodio/demo-temporada-1-episodio-2">1x2</a><a href="/episodio/demo-temporada-2-episodio-2">2x2</a>';
  assert.equal(pickEpisode(html, page, 2, 2), 'https://cuevanas3.pro/episodio/demo-temporada-2-episodio-2');
  assert.equal(pickEpisode(html, page, 3, 2), null);
});


test('AnimeOnlineNinja: distingue temporadas mediante la numeración que acompaña al enlace', () => {
  const page = 'https://ww4.animeonline.ninja/online/naruto-100724/';
  const html = '<li><div class="numerando">1 - 2</div><a href="/episodio/naruto-cap-2/">Episodio</a></li>';
  assert.equal(pickEpisode(html, page, 1, 2), 'https://ww4.animeonline.ninja/episodio/naruto-cap-2/');
  assert.equal(pickEpisode(html, page, 2, 2), null);
});
