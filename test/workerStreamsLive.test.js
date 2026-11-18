'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { audit, auditPlayback } = require('../scripts/worker-streams-live');

const base = 'https://ramdonlatam.noe359866.workers.dev';
const web = 'https://web.stremio.com';
const denied = 'https://p3.vimeos.zip/hls2/denied.m3u8?t=secret-1';
const working = 'https://s10.vimeos.net/hls2/working.m3u8?t=secret-2';
const legacy = `/hls?via=spinflix&u=${encodeURIComponent(working)}`;
const json = (data, cors = '*') => Response.json(data, { headers: { 'Access-Control-Allow-Origin': cors } });
const flagged = (url, hints) => ({ url, behaviorHints: { notWebReady: true, ...hints } });

function record(fetched, value, init) {
  const url = new URL(value);
  fetched.push(url.href);
  assert.equal(init.redirect, 'manual');
  assert.equal(init.headers.Origin, web);
  assert.equal(init.headers.Referer, undefined, 'no usar cabeceras especiales de reproducción en la sonda');
  return url;
}

test('sonda del Worker: pide HLS solo al CDN y cuenta sin seguir los enlaces con proxy', async () => {
  const fetched = [];
  const report = await audit(async (value, init) => {
    const url = record(fetched, value, init);
    if (url.href === denied) return new Response('Forbidden', { status: 403 });
    if (url.href === working) return new Response('#EXTM3U\n#EXTINF:1,\nseg.ts\n');
    assert.equal(url.origin, base);
    switch (url.pathname) {
      case '/manifest.json': return json({ resources: ['catalog', 'meta', 'stream'] });
      case '/stream/movie/tmdb%3Amovie%3A603.json':
        return json({ streams: [flagged(denied), flagged(denied), flagged(working), flagged(`${base}${legacy}`),
          flagged('https://vimeos.net/old-client.m3u8', { proxyHeaders: {} }), flagged('https://other.example/fake.m3u8')] });
      case '/stream/series/tmdb%3Atv%3A1396%3A1%3A1.json': return json({ streams: [{ url: legacy }] }, web);
      case '/stream/movie/tt1375666.json': return json({ streams: [] });
      default: assert.fail('la sonda no debe llamar una ruta de medios del Worker');
    }
  });

  assert.equal(report.declaresStream, true);
  assert.equal(report.manifestCors, true);
  assert.deepEqual(fetched.filter((url) => !url.startsWith(base)), [denied, working]);
  assert.equal(fetched.length, 6);
  assert.deepEqual(report.rows.map(({ status, cors, count, relayed, notWebReady, hls }) => [status, cors, count, relayed, notWebReady, hls]), [
    [200, true, 6, 2, 6, ['CDN HTTP 403', 'HLS directo HTTP 200 válido (CORS=no)']],
    [200, true, 1, 1, 0, []],
    [200, true, 0, 0, 0, []],
  ]);
  assert.doesNotMatch(JSON.stringify(report), /secret|vimeos\.|other\.example/);
});

test('sonda de segmentos: pide variante, vídeo y audio es-419 al CDN, con lectura acotada', async () => {
  const fetched = [];
  const local = 'http://127.0.0.1:8799';
  const cdn = 'https://s10.vimeos.net/hls2/fixture/';
  const rows = await auditPlayback(local, async (value, init) => {
    const url = record(fetched, value, init);
    if (url.origin === local) {
      assert.match(url.pathname, /^\/stream\//);
      const test = url.pathname.includes('/movie/') ? 'movie' : 'episode';
      return json({ streams: [
        { title: 'Fanpelis · Latino', url: `${cdn}${test}.m3u8?t=secret` },
        { title: 'Fanpelis · Latino', url: `${cdn}same-source-extra.m3u8` },
        { title: 'SpinFlix · Castellano', url: `${cdn}${test}.m3u8?t=secret` },
      ] });
    }
    assert.ok(url.href.startsWith(cdn));
    const name = url.pathname.split('/').pop();
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (name === 'movie.m3u8') return new Response('#EXTM3U\n#EXTINF:1,\nmovie.ts?t=secret\n');
    if (name === 'episode.m3u8') return new Response(
      `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="es",LANGUAGE="es-419",URI="${cdn}audio.m3u8?t=secret"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="es"\nvideo.m3u8?t=secret\n`, { headers });
    if (name === 'video.m3u8' || name === 'audio.m3u8') {
      return new Response(`#EXTM3U\n#EXTINF:1,\n${name.replace('.m3u8', '.ts')}?t=secret\n`, { headers });
    }
    assert.equal(init.headers.Range, 'bytes=0-4095');
    const packets = new Uint8Array(384);
    // Bytes correctos para vídeo, no para el audio separado que pide el master.
    if (name !== 'audio.ts') for (let i = 0; i < packets.length; i += 188) packets[i] = 0x47;
    return new Response(packets, { status: 206, headers: name === 'movie.ts' ? {} : headers });
  });
  const requests = fetched.filter((url) => url.startsWith(cdn)).map((url) => url.slice(cdn.length)).sort();
  assert.deepEqual(requests, ['movie.m3u8', 'movie.ts', 'episode.m3u8', 'video.m3u8', 'video.ts', 'audio.m3u8', 'audio.ts']
    .flatMap((name) => [`${name}?t=secret`, `${name}?t=secret`]).sort());
  assert.equal(fetched.length - requests.length, 2);
  assert.deepEqual(rows.map(({ status, cors, count, relayed, ok }) => [status, cors, count, relayed, ok]), [
    [200, true, 3, 0, true], [200, true, 3, 0, false],
  ]);
  assert.match(rows[0].results[0], /HLS directo HTTP 200 \(CORS=no\).*segmento HTTP 206 \(MPEG-TS; CORS=no\)/);
  assert.match(rows[1].results[0], /^Fanpelis: .*audio es .*sin cabecera de medio/);
  assert.match(rows[1].results[1], /^SpinFlix: .*audio es .*sin cabecera de medio/);
  assert.doesNotMatch(JSON.stringify(rows), /vimeos\.net|t=secret/);
});

test('sonda de segmentos: no sigue relays, redirecciones ni variantes fuera del CDN', async () => {
  const fetched = [];
  const rows = await auditPlayback(base, async (value, init) => {
    const url = record(fetched, value, init);
    if (url.origin === base && url.pathname.startsWith('/stream/')) {
      return json({ streams: [
        { title: 'Fanpelis · Latino', url: legacy },
        { title: 'Fanpelis · Latino', url: working },
        { title: 'SpinFlix · Castellano', url: denied },
      ] });
    }
    if (url.href === denied) return Response.redirect(`${base}${legacy}`);
    if (url.href === working) return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n${base}${legacy}\n`);
    assert.fail('no debe seguir destinos ajenos al CDN');
  });
  assert.equal(fetched.length, 6);
  assert.deepEqual(fetched.filter((url) => !url.startsWith(base)).sort(), [denied, denied, working, working].sort());
  assert.ok(rows.every((row) => !row.ok && row.count === 3 && row.relayed === 1 && row.status === 200));
  assert.match(rows[0].results[0], /variante no sondeable/);
  assert.equal(rows[0].results[1], 'SpinFlix: manifiesto CDN HTTP 302');
  assert.doesNotMatch(JSON.stringify(rows), /secret|\/hls\?/);
});

test('sonda de segmentos: un error de API no se interpreta como un bloqueo del CDN', async () => {
  const rows = await auditPlayback(base, async (value) => {
    assert.match(value, /^https:\/\/ramdonlatam\.noe359866\.workers\.dev\/stream\//);
    return new Response('no disponible', { status: 503 });
  });
  assert.ok(rows.every((row) => row.status === 503 && row.count === null && !row.ok));
});
