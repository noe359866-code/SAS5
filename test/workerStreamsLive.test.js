'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { audit } = require('../scripts/worker-streams-live');

const base = 'https://ramdonlatam.noe359866.workers.dev';
const web = 'https://web.stremio.com';
const denied = 'https://p3.vimeos.zip/hls/denied.m3u8?t=secret-1';
const working = 'https://s10.vimeos.net/hls/working.m3u8?t=secret-2';
const json = (data, cors = '*') => Response.json(data, { headers: { 'Access-Control-Allow-Origin': cors } });
const flagged = (url) => ({ url, behaviorHints: { notWebReady: true } });

test('sonda del Worker: separa el API, los candidatos y el estado CDN sin publicar firmas', async () => {
  const proxies = new Set();
  const report = await audit(async (value, init) => {
    const url = new URL(value);
    assert.equal(url.origin, base, 'no consultar hosts de terceros desde la sonda');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Origin, web);
    switch (url.pathname) {
      case '/manifest.json': return json({ resources: ['catalog', 'meta', 'stream'] });
      case '/stream/movie/tmdb%3Amovie%3A603.json':
        return json({ streams: [flagged(denied), flagged(denied), flagged('https://other.example/fake.m3u8'), flagged(working)] });
      case '/stream/series/tmdb%3Atv%3A1396%3A1%3A1.json': return json({ streams: [{ url: 'https://other.example/video.mp4' }] }, web);
      case '/stream/movie/tt1375666.json': return json({ streams: [] });
      case '/hls': {
        const media = url.searchParams.get('u');
        assert.ok(!proxies.has(media));
        proxies.add(media);
        assert.equal(url.searchParams.get('ref'), 'https://vimeos.net/');
        if (media === denied) return new Response('El CDN respondió 403.', { status: 502 });
        if (media === working) return new Response('#EXTM3U\n#EXTINF:1,\nseg.ts\n');
        assert.fail('no debe reenviar un host desconocido');
        break;
      }
      default: assert.fail('ruta inesperada');
    }
  });

  assert.equal(report.declaresStream, true);
  assert.equal(report.manifestCors, true);
  assert.equal(proxies.size, 2);
  assert.deepEqual(report.rows.map(({ status, cors, count, notWebReady, hls }) => [status, cors, count, notWebReady, hls]), [
    [200, true, 4, 4, ['proxy HTTP 502 (CDN HTTP 403)', 'manifiesto válido vía Worker']],
    [200, true, 1, 0, []],
    [200, true, 0, 0, []],
  ]);
  assert.doesNotMatch(JSON.stringify(report), /secret|vimeos\.|other\.example/);
});