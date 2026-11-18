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
test('prueba de reproducción: exige bytes de los segmentos y del audio español separado', async () => {
  const { auditPlayback } = require('../scripts/worker-streams-live');
  const urls = (name) => `/hls?via=spinflix&u=${encodeURIComponent(`https://s10.vimeos.net/hls2/${name}?t=test`)}`;
  const fetched = [];
  const rows = await auditPlayback(base, async (value, init) => {
    const url = new URL(value);
    assert.equal(url.origin, base);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Origin, web);
    if (url.pathname.startsWith('/stream/')) return json({ streams: [
      { title: 'Fanpelis · Latino', url: `${base}${urls(url.pathname.includes('/series/') ? 'series.m3u8' : 'movie.m3u8')}` },
    ] });
    const media = new URL(url.searchParams.get('u')).pathname.split('/').pop();
    fetched.push(media);
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (media === 'series.m3u8') return new Response(`#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="es",LANGUAGE="es",URI="${urls('es.m3u8')}"\n#EXT-X-STREAM-INF:BANDWIDTH=1\n${urls('movie.m3u8')}\n`, { headers: cors });
    if (media.endsWith('.m3u8')) return new Response(`#EXTM3U\n#EXTINF:1,\n${urls(media.replace('.m3u8', '.ts'))}\n`, { headers: cors });
    assert.equal(init.headers.Range, 'bytes=0-4095');
    // Cuerpo correcto para vídeo, pero no para el audio que el player necesita.
    const packets = new Uint8Array(384);
    if (media !== 'es.ts') for (let i = 0; i < packets.length; i += 188) packets[i] = 0x47;
    return new Response(packets, { headers: cors });
  });
  assert.ok(fetched.includes('movie.ts') && fetched.includes('es.ts'));
  assert.deepEqual(rows.map((row) => row.ok), [true, false]);
  assert.match(rows[1].results[0], /audio es .*sin cabecera de medio/);
  assert.doesNotMatch(JSON.stringify(rows), /vimeos\.net|t=test/);
});
