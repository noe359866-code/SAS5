'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const streams = require('../lib/streams');
const { inspectVimeos } = require('../lib/vimeos');

const media = (url, extras = {}) => ({ title: 'Control', url, audioLabel: 'Latino', ...extras });

test('un challenge no deja sin resultados al resto y evita volver a consultar la fuente durante la pausa', async (t) => {
  let blockedCalls = 0;
  t.mock.method(streams.SEARCHERS, 'animeonlineninja', async () => {
    blockedCalls++;
    throw Object.assign(new Error('detalle no público'), { challenge: true, status: 403 });
  });
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media('https://cdn.example/movie.mp4')]);
  const resolved = { title: 'Control', mediaType: 'movie' };
  const order = ['animeonlineninja', 'fanpelis'];
  const report = {};
  const hits = await streams.runProviders(order, 'Control', resolved, 'Control', report);
  assert.equal(hits.length, 1);
  assert.equal(report.animeonlineninja.reason, 'challenge');
  assert.equal(report.animeonlineninja.status, 403);
  assert.doesNotMatch(JSON.stringify(report), /detalle no público/);
  await streams.runProviders(order, 'Control', resolved, 'Control', report);
  assert.equal(blockedCalls, 1);
  assert.equal(report.animeonlineninja.paused, true);
});

test('el diagnóstico de fuente cuenta medios aceptados independientemente de los duplicados de otra fuente', async (t) => {
  const shared = media('https://cdn.example/duplicate.m3u8');
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [shared]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [shared]);
  const report = {};
  const hits = await streams.runProviders(['fanpelis', 'spinflix'], '', { title: 'Control' }, 'Control', report);
  assert.equal(hits.length, 1);
  assert.equal(report.spinflix.accepted, 1);
  assert.equal(report.spinflix.relevant, 0);
});

test('Vimeos no presenta HTML ni enlaces caídos como HLS y no inventa calidad cuando el CDN niega la sonda', async () => {
  const master = 'https://s10.vimeos.net/example/master.m3u8';
  assert.equal(await inspectVimeos(master, { text: async () => '<html>no video</html>' }), null);
  for (const status of [403, 404]) {
    const media = await inspectVimeos(master, { text: async () => { throw Object.assign(new Error('no'), { status }); } });
    if (status === 404) assert.equal(media, null);
    else assert.deepEqual(media, { master, expiresAt: null, resolution: null, verification: 'cdn-http-403' });
  }
});

test('Worker: el JSON de streams no sale de caché después del límite de la firma', async (t) => {
  const worker = (await import('../worker.mjs')).default;
  const start = Date.now();
  let now = start;
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media(`https://cdn.example/signed-${++calls}.m3u8`, { expiresAt: now + 40_000 })]);
  const env = { STREAM_PROVIDERS: 'fanpelis', STREAM_STALE_SECONDS: '600' };
  t.after(() => config.reload());
  const request = () => worker.fetch(new Request('https://audit.example/stream/movie/tt9998811.json'), env);
  const first = await request();
  assert.equal(first.headers.get('cache-control'), 'public, max-age=10, s-maxage=10, must-revalidate');
  assert.match((await first.json()).streams[0].url, /signed-1\.m3u8$/);
  now += 11_000;
  assert.match((await (await request()).json()).streams[0].url, /signed-2\.m3u8$/);
  assert.equal(calls, 2);
});
