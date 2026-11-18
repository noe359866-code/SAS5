'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probe } = require('../scripts/streamflix-candidates');

const MOVIE = ['Película de prueba', 'https://www.cinecalidad.am/ver-pelicula/prueba/'];
const ENTRY = MOVIE[1];
const EMBED = 'https://vimeos.net/e/prueba';
const CDN = 'https://media.vimeos.net';
const TS = Buffer.alloc(384);
for (const i of [0, 188, 376]) TS[i] = 0x47;
const MP4 = Buffer.from('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000isom', 'ascii');

function options(...entries) {
  return `<ul id="playeroptionsul">${entries.map(([label, url]) => `<li data-option="${url}"><span>${label}</span></li>`).join('')}</ul>`;
}

function mockFetch(pages) {
  const seen = [];
  const fetcher = async (url, request) => {
    seen.push({ url, headers: request.headers });
    assert.equal(request.redirect, 'manual');
    assert.ok(request.signal);
    assert.ok(Object.hasOwn(pages, url), `Petición inesperada a ${url}`);
    const page = pages[url];
    return typeof page === 'function' ? page() : new Response(page);
  };
  return { fetcher, seen };
}

test('sonda CineCalidad: data-option y un iframe permitido pueden llevar a MP4 directo, comprobado por bytes', async () => {
  const nested = 'https://voe.sx/e/embed-sample';
  const mp4 = 'https://media.vimeos.net/video/demo.mp4?firma=solo-fixture';
  const { fetcher, seen } = mockFetch({
    [ENTRY]: options(['Opción 1 · Latino', EMBED]),
    [EMBED]: `<iframe data-src="${nested}"></iframe>`,
    [nested]: `<script>player.setup({sources: [{"file": "${mp4}", type: "video/mp4"}]});</script>`,
    [mp4]: () => new Response(MP4, { status: 206 }),
  });
  const report = await probe(MOVIE, fetcher);
  assert.equal(report.accepted, true);
  assert.match(report.attempts.join(), /latino.*MP4 HTTP 206/);
  assert.doesNotMatch(JSON.stringify(report), /solo-fixture|embed-sample/);
  assert.deepEqual(seen, [{ url: ENTRY, headers: undefined }, { url: EMBED, headers: undefined },
    { url: nested, headers: undefined }, { url: mp4, headers: { Range: 'bytes=0-383' } }]);
});

test('sonda CineCalidad: ni HTML con extensión .mp4 ni un archivo sin etiqueta de audio pasan', async () => {
  const mp4 = `${CDN}/video.mp4`;
  for (const [name, bytes, expected] of [
    ['Castellano', '<html>Sin vídeo</html>', /sin cabecera de medio/], ['Servidor', MP4, /falta acreditar audio/],
  ]) {
    const { fetcher, seen } = mockFetch({ [ENTRY]: options([name, mp4]), [mp4]: bytes });
    const report = await probe(MOVIE, fetcher);
    assert.equal(report.accepted, false);
    assert.match(report.attempts.join(), expected);
    assert.deepEqual(seen.map(({ url }) => url), [ENTRY, mp4]);
  }
});

test('sonda CineCalidad: HLS con audio separado requiere acceso a vídeo y a la pista española', async () => {
  const master = `${CDN}/master.m3u8`;
  const variant = `${CDN}/variant.m3u8`;
  const audio = `${CDN}/audio.m3u8`;
  const videoSegment = `${CDN}/video.ts`;
  const audioSegment = `${CDN}/audio.ts`;
  for (const status of [206, 403]) {
    const { fetcher, seen } = mockFetch({
      [ENTRY]: options(['Castellano', master]),
      [master]: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="es-ES",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,AUDIO="a"\nvariant.m3u8',
      [variant]: '#EXTM3U\n#EXTINF:4.0,\nvideo.ts',
      [audio]: '#EXTM3U\n#EXTINF:4.0,\naudio.ts',
      [videoSegment]: TS,
      [audioSegment]: () => new Response(status === 206 ? TS : 'Forbidden', { status }),
    });
    const report = await probe(MOVIE, fetcher);
    assert.equal(report.accepted, status === 206);
    assert.match(report.attempts.join(), status === 206 ? /audio es HTTP 206/ : /audio CDN HTTP 403/);
    assert.deepEqual(seen.map(({ url }) => url), [ENTRY, master, variant, videoSegment, audio, audioSegment]);
  }
});

test('sonda CineCalidad: no abre publicidad, descargas, redirecciones ni orígenes desconocidos', async () => {
  const allowed = `${CDN}/ok.m3u8`;
  const redirected = 'https://otro.example/redireccion.ts';
  const { fetcher, seen } = mockFetch({
    [ENTRY]: options(['Latino', 'https://otro.example/contenido.mp4'], ['Subtitulado', `${CDN}/sub.mp4`], ['Latino', EMBED])
      + `<a download href="${CDN}/descarga.mp4">Descargar</a>`,
    [EMBED]: `<iframe src="https://otro.example/visor"></iframe><video src="${allowed}"></video>`,
    [allowed]: () => new Response(null, { status: 302, headers: { Location: redirected } }),
  });
  const report = await probe(MOVIE, fetcher);
  assert.equal(report.accepted, false);
  assert.match(report.attempts.join(), /manifiesto CDN HTTP 302/);
  assert.deepEqual(seen.map(({ url }) => url), [ENTRY, EMBED, allowed]);
});

test('sonda CineCalidad: solo permite una redirección pública entre visores conocidos', async () => {
  const next = 'https://voe.sx/e/embed-sample';
  const other = 'https://no-permitido.example/player';
  const { fetcher, seen } = mockFetch({
    [ENTRY]: options(['Latino', EMBED]),
    [EMBED]: () => new Response(null, { status: 301, headers: { Location: next } }),
    [next]: () => new Response(null, { status: 302, headers: { Location: other } }),
  });
  const report = await probe(MOVIE, fetcher);
  assert.equal(report.accepted, false);
  assert.match(report.attempts.join(), /HTTP 302/);
  assert.deepEqual(seen.map(({ url }) => url), [ENTRY, EMBED, next]);
});

test('sonda CineCalidad: detecta un MP4 literal configurado en la propia ficha', async () => {
  const page = 'https://www.cinecalidad.am/ver-pelicula/prueba-inline/';
  const mp4 = 'https://www.cinecalidad.am/videos/demo.mp4';
  const { fetcher, seen } = mockFetch({
    [page]: `<script>videojs('d').src('${mp4}');</script>`,
    [mp4]: MP4,
  });
  const report = await probe(['Control', page, 'latino'], fetcher);
  assert.equal(report.accepted, true);
  assert.deepEqual(seen.map(({ url }) => url), [page, mp4]);
});

test('sonda CineCalidad: un challenge no es una página de catálogo ni inicia otros fetch', async () => {
  const { fetcher, seen } = mockFetch({
    [ENTRY]: () => new Response(options(['Latino', EMBED]), { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
  });
  const report = await probe(MOVIE, fetcher);
  assert.equal(report.accepted, false);
  assert.equal(report.state, 'challenge (HTTP 403)');
  assert.deepEqual(seen.map(({ url }) => url), [ENTRY]);
});

test('sonda CineCalidad: no consulta fichas de otros sitios ni rutas de descarga', async () => {
  const { fetcher, seen } = mockFetch({});
  for (const page of ['https://example.invalid/ver-pelicula/prueba/', `${ENTRY}?download=1`]) {
    const report = await probe(['Control', page], fetcher);
    assert.equal(report.accepted, false);
    assert.equal(report.state, 'ficha fuera de CineCalidad');
  }
  assert.deepEqual(seen, []);
});

test('sonda CineCalidad: un HLS extraído no es apto si el CDN rechaza el manifiesto', async () => {
  const hls = `${CDN}/master.m3u8`;
  const { fetcher, seen } = mockFetch({
    [ENTRY]: options(['Latino', EMBED]),
    [EMBED]: `<script>player.setup({file: "${hls}"});</script>`,
    [hls]: () => new Response('Forbidden', { status: 403 }),
  });
  const report = await probe(MOVIE, fetcher);
  assert.equal(report.accepted, false);
  assert.match(report.attempts.join(), /manifiesto CDN HTTP 403/);
  assert.deepEqual(seen.map(({ url }) => url), [ENTRY, EMBED, hls]);
});
