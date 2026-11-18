'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BASE, searchGnulaHD } = require('../lib/gnulahd');
const { runProviders, toDirectStream } = require('../lib/streams');

const movie = { title: 'El Origen', altTitle: 'Inception', year: '2010', mediaType: 'movie' };
const show = { title: 'Mi serie', year: 2025, mediaType: 'series', season: 2, episode: 3 };
const media = '/media/movie.m3u8';
const video = `<video data-language="Castellano"><source src="${media}"></video>`;
const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.5,\nprimero.ts\n#EXT-X-ENDLIST\n';
const page = (fixture, html = '', type = fixture.mediaType === 'movie' ? 'Movie' : 'TVSeries') => `
  <title>${fixture.title} (${fixture.year}) Película Completa Español Latino</title><h1>${fixture.title}</h1>
  <script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"${type}"}]}</script>${html}`;
const episode = (heading, link = '/ver/mi-serie/') => `<h1>Ver Mi serie ${heading} Online — Episodio</h1><a href="${link}">Todos</a>${video}`;

function mockFetch(t, routes) {
  t.after(() => assert.equal(routes.length, 0, 'solo debe hacer las consultas previstas'));
  t.mock.method(global, 'fetch', async (url, init) => {
    const next = routes.shift();
    assert.ok(next, 'petición inesperada');
    assert.equal(url, BASE + next[0]);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method || 'GET', 'GET');
    assert.equal(init.body, undefined);
    return new Response(next[1], next[2]);
  });
}

test('GnulaHD: el registro de streams admite el HLS público validado con Castellano explícito', async (t) => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nhd.m3u8\n';
  mockFetch(t, [['/ver/el-origen/', page(movie, video)], [media, master], ['/media/hd.m3u8', manifest]]);
  const report = {};
  const hits = await runProviders(['gnulahd'], movie.title, movie, movie.title, report);
  assert.deepEqual(report.gnulahd, { ok: true, raw: 1, accepted: 1, relevant: 1, mediaChecks: { 'manifest-ok': 1 } });
  assert.equal(hits[0].verification, 'manifest-ok');
  const stream = toDirectStream(hits[0], null);
  assert.equal(stream.url, BASE + media);
  assert.match(stream.title, /Castellano/);
  assert.match(stream.name, /720p/);
});

test('GnulaHD: no confunde el año o el tipo, y puede intentar el título original', async (t) => {
  mockFetch(t, [
    ['/ver/el-origen/', page({ ...movie, year: 2026 }, video)],
    ['/ver/el-origen-2010/', page(movie, video, 'TVSeries')],
    ['/ver/inception/', page({ ...movie, title: 'Inception' }, `<video src="${media}" data-lang="Español Latino"></video>`)],
    [media, manifest],
  ]);
  const hits = await searchGnulaHD('', movie);
  assert.equal(hits[0].audioLabel, 'Latino');
  assert.equal(hits[0].title, movie.title);
  assert.deepEqual(await searchGnulaHD('', movie, movie.altTitle), { skipped: 'alternative-already-checked' });
});

test('GnulaHD: busca solo la ficha, el capítulo publicado y su medio etiquetado', async (t) => {
  mockFetch(t, [
    ['/ver/mi-serie/', page(show, `${video}<a href="/mi-serie-1x03/">Otro</a><a href="/mi-serie-2x03/">Correcto</a>`)],
    ['/mi-serie-2x03/', episode('2×03')],
    [media, manifest],
  ]);
  assert.deepEqual(await searchGnulaHD('', { ...show, season: null }), { skipped: 'episode-required' });
  const hits = await searchGnulaHD('', show);
  assert.equal(hits[0].referer, `${BASE}/mi-serie-2x03/`);
});

test('GnulaHD: no crea una URL de episodio que no aparece en la serie', async (t) => {
  mockFetch(t, [['/ver/mi-serie/', page(show, `${video}<a href="/mi-serie-2x02/">Otro</a><a href="https://other.example/mi-serie-2x03/">Externo</a>`)]]);
  assert.deepEqual(await searchGnulaHD('', show), { hits: [], reason: 'no-episode-link' });
});

for (const [name, html] of [['otro capítulo', episode('2×02')], ['otra serie', episode('2×03', '/ver/otra-serie/')]]) {
  test(`GnulaHD: no acepta el vídeo de ${name}`, async (t) => {
    mockFetch(t, [['/ver/mi-serie/', page(show, '<a href="/mi-serie-2x03/">Tres</a>')], ['/mi-serie-2x03/', html]]);
    assert.deepEqual(await searchGnulaHD('', show), { hits: [], reason: 'episode-mismatch' });
  });
}

test('GnulaHD: no consulta descargas, tráilers, iframes, JS, rutas restringidas ni pistas sin doblaje', async (t) => {
  mockFetch(t, [['/ver/el-origen/', page(movie, `
    <button>Latino</button><video src="/media/sin-etiqueta.m3u8"></video>
    <div data-lang="Latino"><video src="/media/menu.m3u8"></video></div>
    <video data-lang="Subtitulado" src="/media/subs.m3u8"></video>
    <video data-lang="Latino + Inglés" src="/media/dual.m3u8"></video>
    <video data-lang="Latino" src="/wp-content/media/archivo.m3u8"></video>
    <video data-lang="Latino" src="/media/visor-op-1.m3u8"></video>
    <video data-lang="Latino" src="/media/archivo.m3u8?token=foo"></video>
    <video data-lang="Latino" src="https://otro.example/archivo.m3u8"></video>
    <video data-lang="Latino" src="/media/ambiguo.m3u8"></video>
    <video data-lang="Castellano" src="/media/ambiguo.m3u8"></video>
    <div class="descargas">${video}</div><div id="trailer">${video}</div>
    <iframe data-lang="Latino" src="${media}"></iframe>
    <a download href="${media}">Descargar</a><script>fetch('/wp-json/player');</script>`)]]);
  assert.deepEqual(await searchGnulaHD('', movie), { hits: [], reason: 'no-public-media' });
});

for (const [name, text] of [
  ['HTML con extensión m3u8', '<!DOCTYPE html><h1>Visor</h1>'],
  ['playlist con segmento externo', manifest.replace('primero.ts', 'https://other.example/primero.ts')],
  ['playlist con pista externa', manifest.replace('#EXT-X-VERSION:3', '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://other.example/audio.m3u8"')],
]) {
  test(`GnulaHD: no devuelve ${name}`, async (t) => {
    mockFetch(t, [['/ver/el-origen/', page(movie, video)], [media, text]]);
    assert.deepEqual(await searchGnulaHD('', movie), { hits: [], reason: 'unverified-hls' });
  });
}

test('GnulaHD: no sigue redirects ni cambia a otro cliente cuando se bloquea el acceso', async (t) => {
  mockFetch(t, [['/ver/el-origen/', '', { status: 302, headers: { Location: 'https://other.example/' } }]]);
  await assert.rejects(searchGnulaHD('', movie), { status: 302 });
});
