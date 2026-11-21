'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const streams = require('../lib/streams');

test('handleStream conserva los resultados incluso si otro proveedor falla', async (t) => {
  const hit = { url: 'https://cdn.example/video.mp4' };
  let partial = false;
  t.mock.method(streams, 'searchStreams', async (_type, _id, _cfg, status) => {
    status.partial = partial;
    return [hit];
  });
  const { handleStream } = require('../lib/core');
  const complete = await handleStream('movie', 'tt0110357');
  assert.deepEqual(complete.streams, [hit]);
  assert.ok(complete.cacheMaxAge > 0);
  partial = true;
  assert.deepEqual(await handleStream('movie', 'tt0110357'), { streams: [hit], cacheMaxAge: 0 });
});

test('el nombre del stream es el título de la obra y la calidad va debajo', () => {
  const base = { titles: ['Interestelar', 'Interstellar'], audioLabel: 'Latino',
    title: 'Interestelar 2014 1080p WEB-DL Latino Fanpelis', url: 'https://cdn.example/master.m3u8',
    quality: 'HLS', provider: 'fanpelis' };
  const stream = streams.toStream({ ...base, resolution: '1080p' }, null);
  assert.equal(stream.name, 'Interestelar');
  assert.equal(stream.title, 'Fanpelis · 🎧 Latino\n1080p · WEB-DL · LAT');
  // Sin resolución declarada no se inventa una: se anuncia el formato.
  const sinResolucion = streams.toStream({ ...base, resolution: null }, { badges: [] });
  assert.equal(sinResolucion.name, 'Interestelar');
  assert.match(sinResolucion.title, /HLS/);
  // Un nombre sintético sin `titles` se recorta hasta la obra.
  assert.equal(streams.toStream({ ...base, titles: [], title: 'El Origen 2010 720p Castellano' }, null).name, 'El Origen');
});

test('el nombre del stream es la obra también en series y anime, nunca la calidad', () => {
  const base = { audioLabel: 'Latino', resolution: '1080p', quality: 'HLS', url: 'https://cdn.example/m.m3u8' };
  // Serie: el nombre es el de la serie y el capítulo se lee en la descripción.
  const serie = streams.toDirectStream({
    ...base, provider: 'fanpelis', titles: ['Breaking Bad'],
    title: 'Breaking Bad 2008 S05E14 1080p WEB-DL Latino Fanpelis',
  }, null);
  assert.equal(serie.name, 'Breaking Bad');
  assert.match(serie.title, /^T5E14 · Fanpelis · 🎧 Latino\n/);

  // Anime: el nombre conserva el título completo, con dos puntos y todo.
  const anime = streams.toDirectStream({
    ...base, provider: 'spinflix', titles: ['Shingeki no Kyojin', 'Attack on Titan'],
    title: 'Shingeki no Kyojin 2013 S01E01 720p Latino SpinFlix',
  }, null);
  assert.equal(anime.name, 'Shingeki no Kyojin');

  // Película sin `titles` (fuente que solo da su nombre sintético).
  assert.equal(streams.toDirectStream({ ...base, title: 'Dune: Parte Dos 2024 2160p REMUX' }, null).name, 'Dune: Parte Dos');
  // Sin nada de donde sacar el título sigue habiendo una etiqueta usable.
  assert.equal(streams.toDirectStream({ ...base, title: '' }, null).name, 'Stream');
});

test('el título resuelto se publica sin recortes: el año puede ser parte del nombre', () => {
  const base = { audioLabel: 'Latino', quality: 'HLS', url: 'https://cdn.example/m.m3u8' };
  // «1984» o «1917» son parte del título; solo se recorta el nombre sintético
  // del proveedor, nunca el título de la obra.
  assert.equal(streams.toDirectStream({ ...base, titles: ['Wonder Woman 1984'], title: 'Wonder Woman 1984 2020 1080p' }, null).name, 'Wonder Woman 1984');
  assert.equal(streams.toDirectStream({ ...base, titles: ['1917'], title: '1917 2019 2160p' }, null).name, '1917');
  // Sin `titles` (no ocurre en producción: el pipeline siempre los añade) el
  // recorte es heurístico y se queda con lo que hay antes del año o la calidad.
  assert.equal(streams.toDirectStream({ ...base, title: '1917 2019 2160p' }, null).name, '1917');
});

test('un stream subtitulado se anuncia con lápiz, no con auriculares', () => {
  const hit = { provider: 'animeflv', title: 'Ao Ashi Season 2 S2E7 AnimeFLV', url: 'https://player.example/hls.m3u8',
    quality: 'HLS', audioLabel: 'Subtitulado' };
  const stream = streams.toDirectStream(hit, null);
  assert.match(stream.title, /📝 Subtitulado/);
  assert.doesNotMatch(stream.title, /🎧/);
});

test('HLS y MP4 piden el proxy; solo el origen declarado añade cabeceras', () => {
  const origin = 'https://player.example';
  for (const quality of ['HLS', 'MP4']) {
    // Sin origen conocido se solicita el proxy sin inventar cabeceras.
    for (const declares of [true, false]) {
      const hit = { provider: 'cuevanas3', quality, ...(declares ? { playbackOrigin: origin } : {}),
        url: `https://cdn.example/movie.${quality === 'HLS' ? 'm3u8' : 'mp4'}` };
      const stream = streams.toDirectStream(hit);
      assert.equal(stream.url, hit.url);
      assert.deepEqual(stream.behaviorHints.proxyHeaders, { request: declares
        ? { Origin: origin, Referer: `${origin}/` } : {} });
    }
  }
});
