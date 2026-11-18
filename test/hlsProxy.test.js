'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const hls = require('../lib/hlsProxy');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

const MASTER = 'https://s10.vimeos.net/hls2/a/master.m3u8?t=x&e=43200';

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: (options && options.headers) || {} });
    return handler(String(url), options);
  };
  return calls;
}

function req(query) {
  return { method: 'GET' };
}

test('proxy HLS: reescribe la playlist para que los segmentos también pasen por el proxy', async () => {
  const calls = mockFetch(() => new Response(
    '#EXTM3U\n' +
    '#EXT-X-MEDIA:TYPE=AUDIO,NAME="Español",URI="audio-a1.m3u8?t=x"\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1\n' +
    'https://s10.vimeos.net/hls2/a/index-v1-a1.m3u8?t=x\n' +
    '#EXTINF:10,\n' +
    '/hls2/a/seg-1-v1-a1.ts?t=x\n',
    { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }
  ));
  const url = new URL(`https://addon.example/hls?ref=${encodeURIComponent('https://vimeos.net/')}&u=${encodeURIComponent(MASTER)}`);
  const res = await hls.handleHlsProxy(req(), url, {});
  assert.equal(res.status, 200);
  const body = await res.text();

  // Cada URI pasa por /hls y arrastra el Referer.
  assert.equal((body.match(/\/hls\?ref=/g) || []).length, 3);
  assert.ok(body.includes(encodeURIComponent('index-v1-a1.m3u8')));
  assert.ok(body.includes(encodeURIComponent('seg-1-v1-a1.ts')));
  // La ruta relativa se resuelve contra la playlist de origen.
  assert.ok(decodeURIComponent(body).includes('https://s10.vimeos.net/hls2/a/audio-a1.m3u8'));
  // Y al CDN se le manda el Referer.
  assert.equal(calls[0].headers.Referer, 'https://vimeos.net/');
  assert.equal(calls[0].url, MASTER);
});

test('proxy HLS: un segmento se devuelve tal cual, en streaming', async () => {
  mockFetch(() => new Response('TS-BYTES', {
    status: 200,
    headers: { 'content-type': 'video/mp2t' },
  }));
  const url = new URL(`https://addon.example/hls?u=${encodeURIComponent('https://s10.vimeos.net/a/seg-1.ts?t=x')}`);
  const res = await hls.handleHlsProxy(req(), url, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp2t');
  assert.equal(await res.text(), 'TS-BYTES');
});

test('proxy HLS: no es un proxy abierto', async () => {
  const blocked = [
    ['http://s10.vimeos.net/a/master.m3u8', 400],          // sin HTTPS
    ['https://evil.example/a/master.m3u8', 403],            // host no permitido
    ['https://s10.vimeos.net/a/pagina.html', 403],          // no es media
  ];
  for (const [target, status] of blocked) {
    const url = new URL(`https://addon.example/hls?u=${encodeURIComponent(target)}`);
    const res = await hls.handleHlsProxy(req(), url, {});
    assert.equal(res.status, status, target);
  }
  // Sin parámetro tampoco.
  assert.equal((await hls.handleHlsProxy(req(), new URL('https://addon.example/hls'), {})).status, 400);
  // Hosts extra por entorno, con subdominios.
  assert.equal(hls.hostAllowed('cdn.midominio.com', hls.allowedHosts({ HLS_PROXY_HOSTS: 'midominio.com' })), true);
  assert.equal(hls.hostAllowed('otro.com', hls.allowedHosts({ HLS_PROXY_HOSTS: 'midominio.com' })), false);
});

test('proxy HLS: un CDN que falla se cuenta como 502/504, no revienta', async () => {
  mockFetch(() => new Response('no', { status: 403 }));
  let res = await hls.handleHlsProxy(req(), new URL(`https://addon.example/hls?u=${encodeURIComponent(MASTER)}`), {});
  assert.equal(res.status, 502);

  global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  res = await hls.handleHlsProxy(req(), new URL(`https://addon.example/hls?u=${encodeURIComponent(MASTER)}`), {});
  assert.equal(res.status, 504);
});

test('proxy HLS: no sigue redirecciones ni presenta HTML como una playlist', async () => {
  const url = new URL(`https://addon.example/hls?u=${encodeURIComponent(MASTER)}`);
  const requests = mockFetch((_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://other.example/example.m3u8' } });
  });
  assert.equal((await hls.handleHlsProxy(req(), url, {})).status, 502);
  assert.equal(requests.length, 1);
  mockFetch(() => new Response('<html>error del CDN</html>', { status: 200 }));
  assert.equal((await hls.handleHlsProxy(req(), url, {})).status, 502);
});
