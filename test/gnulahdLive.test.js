'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probe } = require('../scripts/gnulahd-live');

const origin = 'https://ww3.gnulahd.nu';
const show = { title: 'Mi serie', year: 2025, slug: 'mi-serie', season: 1, episode: 2 };
const page = (title, year, content = '') => `<title>${title} (${year}) | Gnula</title><h1>${title}</h1>${content}`;

function mockFetch(t, routes) {
  t.after(() => assert.equal(routes.length, 0));
  t.mock.method(global, 'fetch', async (url, init) => {
    const route = routes.shift();
    assert.ok(route, 'no debe consultar descargas, iframes ni episodios que no correspondan');
    assert.equal(url, `${origin}${route[0]}`);
    assert.equal(init.redirect, 'manual');
    return new Response(route[1]);
  });
}

test('GnulaHD: continúa solo por el enlace exacto y confirma el capítulo en la ficha resultante', async (t) => {
  mockFetch(t, [['/ver/mi-serie/', page(show.title, show.year, `
    <a href="/mi-serie-1x01/">Uno</a><a href="/mi-serie-2x02/">Otra temporada</a>
    <a href="https://other.example/mi-serie-1x02/">Otro origen</a><a href="/mi-serie-1x02/">Dos</a>`) ],
  ['/mi-serie-1x02/', '<h1>Ver Mi serie 1×02 Online — Dos</h1><a href="/ver/mi-serie/">Todos</a><iframe src="https://embed.example/view"></iframe>']]);
  const result = await probe(show);
  assert.match(result, /^episodio exacto identificado;/);
  assert.match(result, /etiquetas de vídeo=0; URL en vídeo=—; iframes=1 \(embed\.example\)/);
});

test('GnulaHD: una ficha sin enlace válido no provoca una petición de episodio inferida', async (t) => {
  mockFetch(t, [['/ver/mi-serie/', page(show.title, show.year, '<a href="https://other.example/mi-serie-1x02/">Varios</a><a href="/otra-serie-1x02/">Dos</a>')]]);
  assert.equal(await probe(show), 'serie identificada; sin enlace al episodio exacto');
});

test('GnulaHD: una descarga, un tráiler y un iframe con extensión MP4 no se confunden con vídeo nativo', async (t) => {
  mockFetch(t, [['/ver/control/', page('Control', 2001, `<video class="trailer" src="https://cdn.example/trailer.mp4"></video>
    <div class="downloads"><video src="https://cdn.example/download.mp4"></video></div>
    <a href="https://cdn.example/download.mp4" download>Descargar</a>
    <iframe src="https://player.example/pretend.mp4"></iframe><video src="https://cdn.example/live.m3u8" data-lang="Latino"></video>`)]]);
  const result = await probe({ title: 'Control', year: 2001, slug: 'control' });
  assert.match(result, /etiquetas de vídeo=1; URL en vídeo=cdn\.example\.m3u8 \(Latino\); iframes=1/);
  assert.doesNotMatch(result, /https:|pretend\.mp4|download\.mp4|trailer\.mp4/);
});
