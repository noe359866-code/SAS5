'use strict';

/**
 * VideoAPI: pruebas offline con las respuestas REALES del servicio
 * (capturadas nov-2026), más los casos que rompen un scraper: sin TMDB, sin
 * temporada, ruta que no cumple el contrato y iframes de anuncios.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const videoapi = require('../lib/videoapi');
const streams = require('../lib/streams');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
// Respuestas copiadas del servicio el 17-nov-2026.
const EXISTS_MOVIE = { exists: true, path: '/e/movie/157336' };
const EXISTS_SERIES = { exists: true, path: '/e/tv/1396/1/1' };
const EXISTS_NO = { exists: false };

/** Pendrive de peticiones: guarda las URLs pedidas y responde por patrón. */
function mockFetch(routes) {
  const calls = [];
  global.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    for (const [pattern, respond] of routes) {
      if (pattern.test(href)) return respond(href);
    }
    return new Response('no encontrado', { status: 404 });
  };
  return calls;
}

const PLAYER_HTML = `<!doctype html><html><head><title>Interestelar</title></head><body>
  <div id="player">
    <iframe id="frame" src="https://lamovie.link/e/abc123" frameborder="0" allowfullscreen></iframe>
    <iframe src="https://ads.example.com/popup" width="1" height="1"></iframe>
  </div>
</body></html>`;

test('videoapi: la ruta de exists usa TMDB y exige temporada/episodio en series', () => {
  assert.equal(
    videoapi.existsUrl({ mediaType: 'movie', tmdbId: 157336 }),
    'https://videoapi.la/api/v1/public/exists/movie/157336'
  );
  assert.equal(
    videoapi.existsUrl({ mediaType: 'series', tmdbId: 1396, season: 1, episode: 1 }),
    'https://videoapi.la/api/v1/public/exists/series/1396/1/1'
  );
  // Sin TMDB no hay nada que preguntar: la API solo identifica por TMDB.
  assert.equal(videoapi.existsUrl({ mediaType: 'movie', imdbId: 'tt0816692' }), null);
  // Serie sin episodio concreto tampoco.
  assert.equal(videoapi.existsUrl({ mediaType: 'series', tmdbId: 1396 }), null);
});

test('videoapi: normaliza el contrato de `exists` y rechaza rutas ajenas', () => {
  assert.equal(videoapi.playerPath(EXISTS_MOVIE), '/e/movie/157336');
  assert.equal(videoapi.playerPath(EXISTS_SERIES), '/e/tv/1396/1/1');
  assert.equal(videoapi.playerPath(EXISTS_NO), null, 'exists:false no da ruta');
  // Rutas fuera de /e/{movie|tv|series}/… se ignoran (no se construyen URLs raras).
  assert.equal(videoapi.playerPath({ exists: true, path: '/admin/panel' }), null);
  assert.equal(videoapi.playerPath({ exists: true, path: 'https://evil.example/e/movie/1' }), null);
  assert.equal(videoapi.playerPath({ exists: true, path: '/e/movie/12/extra' }), null);
  assert.equal(videoapi.playerPath(null), null);
});

test('videoapi: extrae el iframe del reproductor y descarta los anuncios', () => {
  const frames = videoapi.playerFrames(PLAYER_HTML, 'https://videoapi.la/e/movie/157336');
  assert.equal(frames.length, 1, 'el iframe de ads no es del reproductor');
  assert.equal(frames[0].url, 'https://lamovie.link/e/abc123');
  assert.equal(frames[0].id, 'frame');
  // Sin iframes (la página devuelve «sesión expirada») no se inventa nada.
  assert.deepEqual(videoapi.playerFrames('<html>Contenido no disponible.</html>', 'https://videoapi.la/e/movie/1'), []);
});

test('videoapi: un solo GET cuando la obra no está en el catálogo', async () => {
  const calls = mockFetch([[/\/exists\//, () => json(EXISTS_NO)]]);
  const found = await videoapi.searchVideoApi('x', { mediaType: 'movie', tmdbId: 999, title: 'Nada' }, 'Nada', 1000);
  assert.deepEqual(found.hits, []);
  assert.equal(calls.length, 1, 'exists:false no debe pedir la página del reproductor');
});

test('videoapi: dos peticiones y devuelve el stream con el Referer del embed', async () => {
  const calls = mockFetch([
    [/\/exists\/movie\/157336$/, () => json(EXISTS_MOVIE)],
    [/\/e\/movie\/157336$/, () => new Response(PLAYER_HTML, { status: 200 })],
  ]);
  const resolved = { mediaType: 'movie', tmdbId: 157336, title: 'Interstellar', year: '2014' };
  const found = await videoapi.searchVideoApi('Interstellar 2014', resolved, 'Interstellar', 1000);
  assert.equal(calls.length, 2);
  assert.equal(found.hits.length, 1);
  const hit = found.hits[0];
  assert.equal(hit.provider, 'videoapi');
  assert.equal(hit.url, 'https://lamovie.link/e/abc123');
  // El iframe solo reproduce con el Referer de su propia página.
  assert.equal(hit.referer, 'https://videoapi.la/e/movie/157336');

  // Y al convertirlo en stream de Stremio ese Referer se respeta.
  const stream = streams.toDirectStream(hit, {});
  assert.equal(stream.behaviorHints.proxyHeaders.request.Referer, 'https://videoapi.la/e/movie/157336');
  assert.equal(stream.behaviorHints.notWebReady, true);
});

test('videoapi: la segunda consulta (título alternativo) no repite peticiones', async () => {
  const calls = mockFetch([
    [/\/exists\/movie\/157336$/, () => json(EXISTS_MOVIE)],
    [/\/e\/movie\/157336$/, () => new Response(PLAYER_HTML, { status: 200 })],
  ]);
  const resolved = { mediaType: 'movie', tmdbId: 157336, title: 'Interstellar', year: '2014' };
  await videoapi.searchVideoApi('x', resolved, 'Interstellar', 1000);
  const before = calls.length;
  const again = await videoapi.searchVideoApi('y', resolved, 'Interestelar', 1000);
  assert.equal(calls.length, before, 'la pasada con otro título no consulta otra vez');
  assert.match(again.skipped, /ya buscado/);
});

test('videoapi: VIDEOAPI=off desactiva el proveedor sin tocar el resto', async () => {
  const previous = config.videoapiEnabled;
  const calls = mockFetch([[/exists/, () => json(EXISTS_MOVIE)]]);
  config.videoapiEnabled = false;
  try {
    const found = await videoapi.searchVideoApi('x', { mediaType: 'movie', tmdbId: 157336, title: 'X' }, 'X', 1000);
    assert.match(found.skipped, /VIDEOAPI=off/);
    assert.equal(calls.length, 0);
  } finally {
    config.videoapiEnabled = previous;
  }
});

test('videoapi: sin TMDB se salta en vez de fallar', async () => {
  const calls = mockFetch([]);
  const found = await videoapi.searchVideoApi('x', { mediaType: 'movie', imdbId: 'tt0816692', title: 'X' }, 'X', 1000);
  assert.match(found.skipped, /TMDB/);
  assert.equal(calls.length, 0);
});
