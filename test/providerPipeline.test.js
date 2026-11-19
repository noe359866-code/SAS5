'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const streams = require('../lib/streams');

const media = (url, extras = {}) => ({ title: 'Control', url, audioLabel: 'Latino', ...extras });

test('un challenge no deja sin resultados al resto y evita volver a consultar la fuente durante la pausa', async (t) => {
  let blockedCalls = 0;
  config.reload({ STREAM_PROVIDER_COOLDOWN_SECONDS: '300' });
  t.after(() => config.reload());
  t.mock.method(streams.SEARCHERS, 'tubeonline', async () => {
    blockedCalls++;
    throw Object.assign(new Error('detalle no público'), { challenge: true, status: 403 });
  });
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media('https://cdn.example/movie.mp4')]);
  const resolved = { title: 'Control', mediaType: 'movie' };
  const order = ['tubeonline', 'fanpelis'];
  const report = {};
  const hits = await streams.runProviders(order, 'Control', resolved, 'Control', report);
  assert.equal(hits.length, 1);
  assert.equal(report.tubeonline.reason, 'challenge');
  assert.equal(report.tubeonline.status, 403);
  assert.doesNotMatch(JSON.stringify(report), /detalle no público/);
  await streams.runProviders(order, 'Control', resolved, 'Control', report);
  assert.equal(blockedCalls, 1);
  assert.equal(report.tubeonline.paused, true);
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

test('el diagnóstico cuenta candidatos aceptados sin sondeos ni URLs firmadas', async (t) => {
  config.reload({ STREAM_PROVIDERS: 'fanpelis,spinflix' });
  t.after(() => config.reload());
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [
    media('https://cdn.example/no.m3u8?signature=secret'),
    media('https://cdn.example/unknown.mp4'),
  ]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [media('https://cdn.example/ok.m3u8')]);
  const report = await streams.diagnose('movie', 'tt9998812', null);
  assert.equal(report.totalStreams, 3);
  assert.equal(report.mediaProbed, false, 'el diagnóstico declara que no se sondean medios');
  assert.equal('mediaChecks' in report, false);
  assert.equal(report.providers.fanpelis.accepted, 2);
  assert.doesNotMatch(JSON.stringify(report), /signature|secret|cdn\.example/);
});

test('el límite de resultados se aplica en el orden de las fuentes', async (t) => {
  config.reload({ STREAM_PROVIDERS: 'fanpelis,spinflix', STREAM_MAX_RESULTS: '2' });
  t.after(() => config.reload());
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [
    media('https://cdn.example/uno.m3u8'),
    media('https://cdn.example/dos.mp4'),
  ]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [media('https://cdn.example/tres.m3u8')]);
  const result = await streams.searchStreams('movie', 'tt9998813', null);
  assert.deepEqual(result.map((stream) => stream.url),
    ['https://cdn.example/uno.m3u8', 'https://cdn.example/dos.mp4']);
  assert.equal(result[0].name, 'Control');
});

test('Vimeos: solo publica .m3u8 con forma válida y no sondea el CDN', async () => {
  const { vimeosMedia, hlsCandidate } = require('../lib/vimeos');
  const master = 'https://s10.vimeos.net/example/master.m3u8';
  assert.deepEqual(vimeosMedia(master), { master, expiresAt: null, resolution: null });
  // Host ajeno, extensión distinta o firma vencida siguen fuera.
  assert.equal(vimeosMedia('https://cdn.example/x.m3u8'), null);
  assert.equal(vimeosMedia('https://s10.vimeos.net/x.mp4'), null);
  assert.equal(hlsCandidate('https://s10.vimeos.net/x.m3u8?s=1600000000&e=60'), null);
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

test('duplicados: la primera fuente que entrega la URL se queda con ella', async (t) => {
  const master = 'https://s10.vimeos.net/hls2/fixture/shared.m3u8';
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media(master)]);
  t.mock.method(streams.SEARCHERS, 'spinflix', async () => [media(master)]);
  const report = {};
  const hits = await streams.runProviders(['fanpelis', 'spinflix'], '', { title: 'Control' }, 'Control', report);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'fanpelis');
  assert.equal(report.fanpelis.accepted, 1);
  assert.equal(report.fanpelis.relevant, 1);
  assert.equal(report.spinflix.accepted, 1);
  assert.equal(report.spinflix.relevant, 0);
  const stream = streams.toDirectStream(hits[0], null);
  assert.equal(stream.url, master);
  assert.equal(stream.name, 'Control');
});

test('Worker: el pool de enlaces publicados se reutiliza durante la ventana de caché', async (t) => {
  const worker = (await import('../worker.mjs')).default;
  let calls = 0;
  t.mock.method(global, 'fetch', async () => Response.json({ meta: { name: 'Control' } }));
  t.mock.method(streams.SEARCHERS, 'fanpelis', async () => [media(`https://cdn.example/pool-${++calls}.m3u8`)]);
  const env = { STREAM_PROVIDERS: 'fanpelis', STREAM_STALE_SECONDS: '600' };
  t.after(() => config.reload());
  const request = () => worker.fetch(new Request('https://audit.example/stream/movie/tt9998814.json'), env, {});
  const first = await request();
  assert.match((await first.json()).streams[0].url, /pool-1\.m3u8$/);
  // Sin sondeo no hay nada que «recomprobar»: la segunda petición sale de la
  // caché y no vuelve a llamar a la fuente.
  const second = await request();
  assert.match((await second.json()).streams[0].url, /pool-1\.m3u8$/);
  assert.equal(calls, 1);
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
