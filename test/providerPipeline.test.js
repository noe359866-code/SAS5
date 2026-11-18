'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const streams = require('../lib/streams');
const { inspectVimeos } = require('../lib/vimeos');

const media = (url, extras = {}) => ({ title: 'Control', url, audioLabel: 'Latino', ...extras });

test('un challenge no deja sin resultados al resto y evita volver a consultar la fuente durante la pausa', async (t) => {
  let blockedCalls = 0;
  config.reload({ STREAM_PROVIDER_COOLDOWN_SECONDS: '300' });
  t.after(() => config.reload());
  t.mock.method(streams.SEARCHERS, 'gnulahd', async () => {
    blockedCalls++;
    throw Object.assign(new Error('detalle no público'), { challenge: true, status: 403 });
  });
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media('https://cdn.example/movie.mp4')]);
  const resolved = { title: 'Control', mediaType: 'movie' };
  const order = ['gnulahd', 'fanpelis'];
  const report = {};
  const hits = await streams.runProviders(order, 'Control', resolved, 'Control', report);
  assert.equal(hits.length, 1);
  assert.equal(report.gnulahd.reason, 'challenge');
  assert.equal(report.gnulahd.status, 403);
  assert.doesNotMatch(JSON.stringify(report), /detalle no público/);
  await streams.runProviders(order, 'Control', resolved, 'Control', report);
  assert.equal(blockedCalls, 1);
  assert.equal(report.gnulahd.paused, true);
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

test('la sonda separa manifiestos verificados, bloqueos y URLs no comprobadas sin revelar firmas', async (t) => {
  config.reload({ STREAM_PROVIDERS: 'fanpelis,spinflix' });
  t.after(() => config.reload());
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [
    media('https://cdn.example/no.m3u8?signature=secret', { verification: 'cdn-http-403' }),
    media('https://cdn.example/unknown.mp4', { verification: 'https://example.invalid/sensitive' }),
  ]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [media('https://cdn.example/ok.m3u8', { verification: 'manifest-ok' })]);
  const report = await streams.diagnose('movie', 'tt9998812', null);
  assert.equal(report.totalStreams, 3);
  assert.equal(report.verifiedManifests, 1);
  assert.deepEqual(report.mediaChecks, { 'cdn-http-403': 1, unchecked: 1, 'manifest-ok': 1 });
  assert.equal(report.providers.fanpelis.accepted, 2);
  assert.deepEqual(report.providers.fanpelis.mediaChecks, { 'cdn-http-403': 1, unchecked: 1 });
  assert.doesNotMatch(JSON.stringify(report), /signature|secret|sensitive|cdn\.example/);
});

test('el límite de resultados no oculta el HLS verificado detrás de enlaces no comprobados', async (t) => {
  config.reload({ STREAM_PROVIDERS: 'fanpelis,spinflix', STREAM_MAX_RESULTS: '2' });
  t.after(() => config.reload());
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [
    media('https://cdn.example/no.m3u8', { verification: 'cdn-http-403' }),
    media('https://cdn.example/unknown.mp4'),
  ]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [media('https://cdn.example/ok.m3u8', { verification: 'manifest-ok' })]);
  const result = await streams.searchStreams('movie', 'tt9998813', null);
  assert.deepEqual(result.map((stream) => stream.url), ['https://cdn.example/ok.m3u8', 'https://cdn.example/unknown.mp4']);
  const unverified = streams.toDirectStream(media('https://cdn.example/no.m3u8', { verification: 'cdn-http-403' }));
  assert.match(unverified.name, /sin verificar/);
  assert.equal(unverified.behaviorHints.notWebReady, true);
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

test('duplicados: un HLS verificado no se pierde si la primera fuente devolvió la misma URL sin verificar', async (t) => {
  const master = 'https://s10.vimeos.net/hls2/fixture/shared.m3u8';
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media(master, { verification: 'cdn-http-403' })]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [media(master, { verification: 'manifest-ok' })]);
  const report = {};
  const hits = await streams.runProviders(['fanpelis', 'spinflix'], '', { title: 'Control' }, 'Control', report);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'spinflix');
  assert.equal(report.fanpelis.accepted, 1);
  assert.equal(report.fanpelis.relevant, 0);
  assert.equal(report.spinflix.relevant, 1);
  const stream = streams.toDirectStream(hits[0], null);
  assert.equal(stream.url, master);
  assert.doesNotMatch(stream.name, /sin verificar/);
});

test('Worker: los resultados exclusivamente sin verificar se vuelven a sondear en 30 segundos', async (t) => {
  const worker = (await import('../worker.mjs')).default;
  let now = Date.now();
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media('https://cdn.example/recheck.m3u8', {
    verification: ++calls > 1 ? 'manifest-ok' : 'cdn-http-403',
  })]);
  const env = { STREAM_PROVIDERS: 'fanpelis', STREAM_STALE_SECONDS: '600' };
  t.after(() => config.reload());
  const request = () => worker.fetch(new Request('https://audit.example/stream/movie/tt9998814.json'), env, {});
  const first = await request();
  assert.equal(first.headers.get('cache-control'), 'public, max-age=30, s-maxage=30, must-revalidate');
  assert.match((await first.json()).streams[0].name, /sin verificar/);
  now += 31_000;
  const next = await request();
  assert.doesNotMatch((await next.json()).streams[0].name, /sin verificar/);
  assert.equal(calls, 2);
});

test('Worker: un manifiesto válido no prolonga la caché de otro enlace sin verificar', async (t) => {
  const worker = (await import('../worker.mjs')).default;
  let now = Date.now();
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [
    media('https://cdn.example/valid.m3u8', { verification: 'manifest-ok' }),
    media('https://cdn.example/retry.m3u8', { verification: ++calls > 1 ? 'manifest-ok' : 'cdn-http-403' }),
  ]);
  const env = { STREAM_PROVIDERS: 'fanpelis', STREAM_STALE_SECONDS: '600' };
  t.after(() => config.reload());
  const request = () => worker.fetch(new Request('https://audit.example/stream/movie/tt9998815.json'), env, {});
  const first = await request();
  assert.equal(first.headers.get('cache-control'), 'public, max-age=30, s-maxage=30, must-revalidate');
  assert.match((await first.json()).streams[1].name, /sin verificar/);
  now += 31_000;
  const next = await request();
  assert.doesNotMatch((await next.json()).streams[1].name, /sin verificar/);
  assert.equal(calls, 2);
});

test('el presupuesto de una fuente cuenta en común JSON y texto sin hacer peticiones extra', async (t) => {
  const { providerHttp, stopProvider } = require('../lib/providerHttp');
  const fetchMock = t.mock.method(global, 'fetch', async () => Response.json({ ok: true }));
  const http = providerHttp(1000, 2);
  await http.json('https://provider.example/index');
  await http.text('https://provider.example/playlist');
  await assert.rejects(() => http.json('https://provider.example/extra'), (err) => err.requestLimit && stopProvider(err));
  assert.equal(fetchMock.mock.callCount(), 2);
});
