'use strict';

/**
 * Proxy de medios: firma, allowlist, política de caché y entrega.
 * Sin red real: `handleProxy` acepta un `fetchImpl` simulado.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mediaProxy = require('../lib/mediaProxy');

const SECRET = 'secreto-de-prueba-para-hmac';
const HOSTS = ['vimeos.net', 'cdn.example'];
const ORIGIN = 'https://addon.example';

function enable(extra = {}) {
  return mediaProxy.configure({
    enabled: true,
    secret: SECRET,
    hosts: HOSTS,
    manifestTtl: 60,
    segmentTtl: 86400,
    ...extra,
  });
}

beforeEach(() => {
  mediaProxy.configure({ enabled: false, secret: '', hosts: [] });
});

test('sin flag, secreto o allowlist no se emite ninguna URL de proxy', async () => {
  assert.deepEqual(mediaProxy.status(), {
    enabled: false, ready: false, hosts: [], manifestTtl: 60, segmentTtl: 86400,
  });
  assert.equal(await mediaProxy.buildProxyUrl('https://s10.vimeos.net/a/master.m3u8', { origin: ORIGIN }), '');

  // Flag sin secreto: sigue sin estar listo.
  mediaProxy.configure({ enabled: true, secret: '', hosts: HOSTS });
  assert.equal(mediaProxy.status().ready, false);
  assert.equal(await mediaProxy.buildProxyUrl('https://s10.vimeos.net/a/master.m3u8', { origin: ORIGIN }), '');

  // Secreto sin allowlist: tampoco.
  mediaProxy.configure({ enabled: true, secret: SECRET, hosts: [] });
  assert.equal(mediaProxy.status().ready, false);

  // Sin origen no hay URL absoluta que publicar.
  enable();
  assert.equal(await mediaProxy.buildProxyUrl('https://s10.vimeos.net/a/master.m3u8', { origin: '' }), '');
});

test('la URL firmada es determinista: la misma obra comparte entrada de caché', async () => {
  enable();
  const target = 'https://s10.vimeos.net/hls/abc123/master.m3u8';
  const referer = 'https://vimeos.net/';
  const first = await mediaProxy.buildProxyUrl(target, { origin: ORIGIN, referer });
  const second = await mediaProxy.buildProxyUrl(target, { origin: ORIGIN, referer });
  assert.equal(first, second, 'dos usuarios deben recibir exactamente la misma URL');
  assert.match(first, /^https:\/\/addon\.example\/p\/[A-Za-z0-9_-]+\?s=[A-Za-z0-9_-]{22}&r=/);

  // Otro referer u otro destino cambian la firma (y la clave de caché).
  const otherReferer = await mediaProxy.buildProxyUrl(target, { origin: ORIGIN, referer: 'https://otro.example/' });
  assert.notEqual(first, otherReferer);
  const otherTarget = await mediaProxy.buildProxyUrl(`${target}?token=2`, { origin: ORIGIN, referer });
  assert.notEqual(first, otherTarget);

  // El token de la ruta se decodifica al destino normalizado.
  const path = new URL(first).pathname;
  assert.equal(mediaProxy.parseProxyPath(path), target);
});

test('allowlist por host: subdominios sí, sufijos tramposos y redes internas no', () => {
  enable();
  const allowed = [
    'https://s10.vimeos.net/x.m3u8',
    'https://vimeos.net/x.m3u8',
    'https://cdn.example/video/1.ts',
    'https://cdn.example/m3u8/token123456',
    'https://cdn.example/x.m3u8?sig=1&e=2',
  ];
  const blocked = [
    'https://vimeos.net.evil.example/x.m3u8', // sufijo que solo parece el dominio
    'https://evilvimeos.net/x.m3u8',
    'https://cdn.example@evil.example/x.m3u8', // credenciales
    'https://user:pass@cdn.example/x.m3u8',
    'http://127.0.0.1/x.m3u8',
    'http://10.0.0.5/x.m3u8',
    'http://192.168.1.4/x.m3u8',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost/x.m3u8',
    'ftp://cdn.example/x.m3u8',
    'https://cdn.example/portada.jpg', // no es medio
    'https://cdn.example/juego.mp4.exe',
  ];
  for (const url of allowed) assert.equal(mediaProxy.isAllowedTarget(url), true, url);
  for (const url of blocked) assert.equal(mediaProxy.isAllowedTarget(url), false, url);
});

test('política de caché: segmentos inmutables, manifiestos cortos, claves y 206 sin caché', () => {
  enable();
  const segment = mediaProxy.cachePolicy('https://cdn.example/v/1.ts');
  assert.equal(segment.cacheable, true);
  assert.match(segment.cacheControl, /immutable/);
  assert.match(segment.cacheControl, /s-maxage=86400/);

  const manifest = mediaProxy.cachePolicy('https://cdn.example/v/master.m3u8');
  assert.equal(manifest.cacheable, true);
  assert.match(manifest.cacheControl, /s-maxage=60/);

  assert.deepEqual(mediaProxy.cachePolicy('https://cdn.example/keys/1'), { cacheable: false, cacheControl: 'no-store' });
  assert.deepEqual(mediaProxy.cachePolicy('https://cdn.example/v/1.key'), { cacheable: false, cacheControl: 'no-store' });
  assert.deepEqual(mediaProxy.cachePolicy('https://cdn.example/v/1.ts', 206), { cacheable: false, cacheControl: 'no-store' });
});

test('el proxy apagado responde 404 como una ruta que no existe', async () => {
  const response = await mediaProxy.handleProxy(new Request(`${ORIGIN}/p/abc?s=def`));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('firma manipulada, host fuera de la lista o petición sin firma se rechazan', async () => {
  enable();
  const signed = await mediaProxy.buildProxyUrl('https://s10.vimeos.net/a/master.m3u8', {
    origin: ORIGIN, referer: 'https://vimeos.net/',
  });
  const url = new URL(signed);

  const noSignature = new URL(url);
  noSignature.searchParams.delete('s');
  assert.equal((await mediaProxy.handleProxy(new Request(noSignature))).status, 403);

  const badSignature = new URL(url);
  badSignature.searchParams.set('s', 'AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal((await mediaProxy.handleProxy(new Request(badSignature))).status, 403);

  // Se cambia el destino por otro host permitido: la firma ya no vale.
  const otherHost = new URL(url);
  otherHost.pathname = `/p/${Buffer.from('https://cdn.example/otro.m3u8').toString('base64url')}`;
  assert.equal((await mediaProxy.handleProxy(new Request(otherHost))).status, 403);
});

test('entrega el cuerpo del CDN con CORS, caché y Referer/Origin', async () => {
  enable();
  const target = 'https://s10.vimeos.net/hls/abc123/seg-1.ts';
  const signed = await mediaProxy.buildProxyUrl(target, { origin: ORIGIN, referer: 'https://vimeos.net/' });
  let seen;
  const response = await mediaProxy.handleProxy(new Request(signed, { headers: { Range: 'bytes=0-99' } }), {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response('datos-del-segmento', {
        status: 200,
        headers: { 'Content-Type': 'video/mp2t', 'Content-Length': '18', ETag: '"v1"' },
      });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'datos-del-segmento');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('x-media-proxy-cacheable'), 'yes');
  assert.equal(response.headers.get('content-type'), 'video/mp2t');
  assert.equal(seen.url, target);
  assert.equal(seen.init.headers.get('Referer'), 'https://vimeos.net/');
  assert.equal(seen.init.headers.get('Origin'), 'https://vimeos.net');
  assert.equal(seen.init.headers.get('Range'), 'bytes=0-99');
  assert.equal(seen.init.redirect, 'manual');
});

test('un 206 nunca se cachea; un error del CDN tampoco se reenvía con cuerpo', async () => {
  enable();
  const signed = await mediaProxy.buildProxyUrl('https://cdn.example/v/1.ts', { origin: ORIGIN });
  const partial = await mediaProxy.handleProxy(new Request(signed), {
    fetchImpl: async () => new Response('bytes', { status: 206, headers: { 'Content-Range': 'bytes 0-4/10' } }),
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('cache-control'), 'no-store');
  assert.equal(partial.headers.get('content-range'), 'bytes 0-4/10');

  const failed = await mediaProxy.handleProxy(new Request(signed), {
    fetchImpl: async () => new Response('bloqueado por el CDN', { status: 403 }),
  });
  assert.equal(failed.status, 403);
  assert.equal(await failed.text(), '');
});

test('sigue redirecciones permitidas y rechaza las que salen de la allowlist', async () => {
  enable();
  const signed = await mediaProxy.buildProxyUrl('https://cdn.example/v/master.m3u8', { origin: ORIGIN });
  const calls = [];
  const followed = await mediaProxy.handleProxy(new Request(signed), {
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return new Response(null, { status: 302, headers: { Location: 'https://s2.vimeos.net/v/master.m3u8' } });
      return new Response('#EXTM3U\n', { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    },
  });
  assert.equal(followed.status, 200);
  assert.deepEqual(calls, ['https://cdn.example/v/master.m3u8', 'https://s2.vimeos.net/v/master.m3u8']);

  const blocked = await mediaProxy.handleProxy(new Request(signed), {
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/v/master.m3u8' } }),
  });
  assert.equal(blocked.status, 403);
});

test('HEAD no devuelve cuerpo y un fallo del CDN se traduce en 502', async () => {
  enable();
  const signed = await mediaProxy.buildProxyUrl('https://cdn.example/v/1.ts', { origin: ORIGIN });
  const head = await mediaProxy.handleProxy(new Request(signed, { method: 'HEAD' }), {
    fetchImpl: async () => new Response('x', { status: 200, headers: { 'Content-Type': 'video/mp2t' } }),
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const broken = await mediaProxy.handleProxy(new Request(signed), {
    fetchImpl: async () => { throw new Error('sin red'); },
  });
  assert.equal(broken.status, 502);
});

test('rewriteStream cambia la URL y retira proxyHeaders; sin proxy no toca nada', async () => {
  const stream = {
    name: 'Interestelar',
    url: 'https://s10.vimeos.net/hls/abc123/master.m3u8',
    behaviorHints: {
      notWebReady: true,
      proxyHeaders: { request: { Referer: 'https://vimeos.net/', Origin: 'https://vimeos.net' } },
    },
  };
  const untouched = await mediaProxy.rewriteStream(stream, { origin: ORIGIN });
  assert.deepEqual(untouched, stream, 'apagado devuelve el mismo objeto');

  enable();
  const rewritten = await mediaProxy.rewriteStream(stream, { origin: ORIGIN });
  assert.match(rewritten.url, /^https:\/\/addon\.example\/p\//);
  assert.equal(rewritten.behaviorHints.notWebReady, true);
  assert.equal(rewritten.behaviorHints.proxyHeaders, undefined);
  assert.equal(stream.url, 'https://s10.vimeos.net/hls/abc123/master.m3u8', 'no muta el original');

  // Un destino no permitido conserva la URL directa.
  const foreign = await mediaProxy.rewriteStream({ url: 'https://otro.example/x.m3u8' }, { origin: ORIGIN });
  assert.equal(foreign.url, 'https://otro.example/x.m3u8');
});

test('Worker: /p/ solo existe si el entorno trae proxy, secreto y allowlist', async () => {
  const worker = (await import('../worker.mjs')).default;
  const config = require('../lib/config');

  const off = await worker.fetch(new Request('https://w.example/p/abc?s=x'), {}, {});
  assert.equal(off.status, 404, 'apagado no revela la ruta');

  const env = { MEDIA_PROXY: 'on', PROXY_SECRET: SECRET, PROXY_ALLOWED_HOSTS: 'vimeos.net' };
  try {
    const health = await worker.fetch(new Request('https://w.example/healthz'), env, {});
    const body = await health.json();
    assert.equal(body.mediaProxy.ready, true);
    assert.deepEqual(body.mediaProxy.hosts, ['vimeos.net']);

    // La configuración del Worker ya dejó el proxy listo para firmar.
    const signed = await mediaProxy.buildProxyUrl('https://s10.vimeos.net/x/master.m3u8', {
      origin: 'https://w.example',
    });
    assert.match(signed, /^https:\/\/w\.example\/p\//);

    // La ruta del Worker entrega el medio con CORS y caché.
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('#EXTM3U\n', {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    });
    try {
      const proxied = await worker.fetch(new Request(signed), env, {});
      assert.equal(proxied.status, 200);
      assert.equal(await proxied.text(), '#EXTM3U\n');
      assert.equal(proxied.headers.get('access-control-allow-origin'), '*');
      assert.equal(proxied.headers.get('x-catalogos-runtime'), 'worker');
      assert.equal(proxied.headers.get('x-media-proxy'), 'upstream');
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    config.reload({});
  }
  assert.equal(mediaProxy.status().ready, false, 'el reload vuelve a apagarlo');
});
