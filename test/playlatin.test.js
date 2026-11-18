'use strict';

/**
 * PlayLatinSRC: pruebas offline con la forma real de la página y del resolve
 * (leídas del reproductor `assets/player.js`, nov-2026), más los casos que
 * rompen un scraper: sin IMDb, sin temporada, página sin token y respuestas
 * raras.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const cache = require('../lib/cache');
const playlatin = require('../lib/playlatin');
const streams = require('../lib/streams');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

/** Página del embed tal como la sirve el sitio: cáscara con los data-*. */
const SHELL = `<!doctype html><html><head><title>PlayLatinSRC</title></head><body>
  <div class="player-shell" data-mode="custom" data-type="movie" data-id="tt0110357"
       data-season="" data-episode="" data-resolve-token="tok_9f2c" data-alt-url="">
    <div class="player-stage"><div data-loader>Connecting to streaming servers...</div></div>
  </div>
  <script src="/assets/player.js"></script>
</body></html>`;

const SHELL_SERIES = SHELL
  .replace('data-type="movie"', 'data-type="series"')
  .replace('data-id="tt0110357"', 'data-id="tt0108778"')
  .replace('data-season=""', 'data-season="1"')
  .replace('data-episode=""', 'data-episode="2"');

const RESOLVE = {
  ok: true,
  title: 'El rey león',
  type: 'movie',
  id: 'tt0110357',
  imdb_id: 'tt0110357',
  sources: [
    { id: 'dropload-latino', name: 'dropload.to', url: 'https://cdn.example/master.m3u8', version: 'latino', kind: 'hls' },
    { id: 'dood-cast', name: 'doodstream.com', url: 'https://cdn.example/movie.mp4', version: 'castellano', kind: 'mp4' },
    { id: 'mix-sub', name: 'mixdrop.co', url: 'https://mixdrop.example/e/sub1', version: 'subtitulado', kind: 'embed', embed: true },
  ],
};

function mockFetch(routes) {
  // La caché de fuentes es por ruta: sin vaciarla, una prueba reutilizaría la
  // respuesta de la anterior.
  cache.deletePrefix('playlatin:');
  const calls = [];
  global.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ href, method: (init && init.method) || 'GET', body: init && init.body });
    for (const [pattern, respond] of routes) {
      if (pattern.test(href)) return respond(href, init);
    }
    return new Response('no encontrado', { status: 404 });
  };
  return calls;
}

const resolvedMovie = { mediaType: 'movie', imdbId: 'tt0110357', title: 'El rey león', year: '1994' };
const resolvedEpisode = {
  mediaType: 'series', imdbId: 'tt0108778', title: 'Friends', season: 1, episode: 2,
};

test('playlatin: la ruta del embed identifica por IMDb y exige episodio en series', () => {
  assert.equal(playlatin.pagePath(resolvedMovie), '/custom/movie/tt0110357');
  assert.equal(playlatin.pagePath(resolvedEpisode), '/custom/serial/tt0108778/1/2');
  // Sin IMDb no hay nada que pedir: el servicio no busca por texto.
  assert.equal(playlatin.pagePath({ mediaType: 'movie', imdbId: 'tmdb:8587' }), null);
  assert.equal(playlatin.pagePath({ mediaType: 'series', imdbId: 'tt0108778' }), null);
});

test('playlatin: lee el token del player-shell y detecta la página sin token', () => {
  const movie = playlatin.parseShell(SHELL);
  assert.equal(movie.ok, true);
  assert.equal(movie.token, 'tok_9f2c');
  assert.equal(movie.id, 'tt0110357');
  assert.equal(movie.type, 'movie');

  const series = playlatin.parseShell(SHELL_SERIES);
  assert.equal(series.season, '1');
  assert.equal(series.episode, '2');

  // Sin token (captcha o título fuera de catálogo) no se resuelve nada.
  const noToken = playlatin.parseShell('<div class="player-shell" data-id="tt1"></div>');
  assert.equal(noToken.ok, false);
  assert.equal(playlatin.parseShell('').ok, false);
});

test('playlatin: acepta comillas simples y atributos en otro orden', () => {
  const html = `<div class='player-shell' data-resolve-token='t1' data-id='tt42' data-type='series' data-season='3' data-episode='7'></div>`;
  const shell = playlatin.parseShell(html);
  assert.equal(shell.token, 't1');
  assert.equal(shell.id, 'tt42');
  assert.equal(shell.season, '3');
  assert.equal(shell.episode, '7');
});

test('playlatin: normaliza las fuentes, descarta lo no reproducible y limita el número', () => {
  const embeds = Array.from({ length: 4 }, (_, i) => ({ url: `https://player.example/e/${i}`, version: 'latino' }));
  const sources = playlatin.normalizeSources({ sources: [...embeds, ...RESOLVE.sources] });
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((s) => s.label), ['Latino', 'Castellano']);
  assert.equal(sources[0].server, 'Dropload');
  assert.equal(sources[0].kind, 'hls');

  // http:// y basura fuera; los .m3u8 cuentan como hls.
  const mixed = playlatin.normalizeSources({
    sources: [
      { url: 'http://inseguro.example/e/1', name: 'x' },
      { url: 'https://cdn.example/master.m3u8', name: 'CDN', kind: 'hls', version: 'latino' },
      { url: 'https://cdn.example/master.m3u8', name: 'duplicado' },
      { url: '', name: 'vacío' },
      { url: 'https://otro.example/e/2', name: 'otro.example', version: 'castellano' },
    ],
  });
  assert.deepEqual(mixed.map((s) => s.url), ['https://cdn.example/master.m3u8']);
  assert.equal(mixed[0].kind, 'hls');

  // No hay fallback a versiones de idioma desconocido.
  const many = playlatin.normalizeSources({ sources: Array.from({ length: 12 }, (_, i) => ({ url: `https://h${i}.example/e/1.mp4`, version: 'latino' })) });
  assert.equal(many.length, 4);
});

test('playlatin: película → página, resolve con el token y streams relevantes', async () => {
  config.reload({ PLAYLATIN: 'on' });
  const calls = mockFetch([
    [/\/custom\/movie\/tt0110357$/, () => new Response(SHELL, { status: 200 })],
    [/\/api\/resolve$/, () => json(RESOLVE)],
  ]);
  const result = await streams.SEARCHERS.playlatin('El rey león 1994', resolvedMovie, resolvedMovie.title, 8000);
  assert.equal(result.hits.length, 2);
  assert.ok(result.hits.every((hit) => hit.provider === 'playlatin' && hit.url && hit.relevant));
  assert.deepEqual(result.hits.map((hit) => hit.audioLabel), ['Latino', 'Castellano']);
  assert.match(result.hits[0].title, /El rey león .*Dropload/);

  // El token viaja al resolve en el cuerpo, no en la URL.
  const post = calls.find((call) => call.method === 'POST');
  assert.ok(post, 'debe hacer un POST a /api/resolve');
  assert.doesNotMatch(post.href, /tok_9f2c/);
  const body = JSON.parse(post.body);
  assert.equal(body.token, 'tok_9f2c');
  assert.equal(body.id, 'tt0110357');
  assert.equal(body.type, 'movie');
});

test('playlatin: episodio → ruta con temporada y episodio', async () => {
  config.reload({ PLAYLATIN: 'on' });
  const calls = mockFetch([
    [/\/custom\/serial\/tt0108778\/1\/2$/, () => new Response(SHELL_SERIES, { status: 200 })],
    [/\/api\/resolve$/, () => json({ ...RESOLVE, imdb_id: 'tt0108778', id: 'tt0108778', type: 'series', season: 1, episode: 2 })],
  ]);
  const result = await streams.SEARCHERS.playlatin('Friends S01E02', resolvedEpisode, resolvedEpisode.title, 8000);
  assert.equal(result.hits.length, 2);
  assert.match(calls[0].href, /\/custom\/serial\/tt0108778\/1\/2$/);
  const body = JSON.parse(calls.find((c) => c.method === 'POST').body);
  assert.equal(body.season, '1');
  assert.equal(body.episode, '2');
});

test('playlatin: página sin token o título fuera de catálogo → sin streams, sin error', async () => {
  config.reload({ PLAYLATIN: 'on' });
  mockFetch([[/\/custom\/movie\/tt0110357$/, () => new Response('<div class="player-shell" data-id="tt0110357"></div>', { status: 200 })]]);
  const result = await streams.SEARCHERS.playlatin('x', resolvedMovie, resolvedMovie.title, 8000);
  assert.deepEqual(result.hits, []);
  assert.equal(result.reason, 'missing-token');
});

test('playlatin: resolve que responde ok:false no lanza', async () => {
  config.reload({ PLAYLATIN: 'on' });
  mockFetch([
    [/\/custom\/movie\/tt0110357$/, () => new Response(SHELL, { status: 200 })],
    [/\/api\/resolve$/, () => json({ ok: false, error: 'invalid_token' })],
  ]);
  const result = await streams.SEARCHERS.playlatin('x', resolvedMovie, resolvedMovie.title, 8000);
  assert.deepEqual(result.hits, []);
  assert.equal(result.reason, 'resolve-rejected');
});

test('playlatin: sin IMDb no se consulta, y la 2ª pasada de título no repite', async () => {
  config.reload({ PLAYLATIN: 'on' });
  const calls = mockFetch([]);
  assert.equal((await streams.SEARCHERS.playlatin('x', { mediaType: 'movie', title: 'X' }, 'X', 8000)).skipped, 'sin IMDb id');
  assert.equal(
    (await streams.SEARCHERS.playlatin('x', resolvedMovie, 'El rey leon (otro)', 8000)).skipped,
    'ya buscado con el título principal'
  );
  assert.equal(calls.length, 0);
});

test('playlatin: PLAYLATIN=off desactiva el proveedor sin tocar el resto', async () => {
  const original = config.playlatinEnabled;
  config.playlatinEnabled = false;
  try {
    const calls = mockFetch([]);
    const result = await streams.SEARCHERS.playlatin('x', resolvedMovie, resolvedMovie.title, 8000);
    assert.equal(result.skipped, 'desactivado por PLAYLATIN=off');
    assert.equal(calls.length, 0);
    // Sigue registrado: desactivarlo no debe romper la lista de proveedores.
    assert.ok(streams.PROVIDER_KEYS.includes('playlatin'));
  } finally {
    config.playlatinEnabled = original;
  }
});

test('playlatin: los streams salen con proxyHeaders y noWebReady', async () => {
  config.reload({ PLAYLATIN: 'on' });
  mockFetch([
    [/\/custom\/movie\/tt0110357$/, () => new Response(SHELL, { status: 200 })],
    [/\/api\/resolve$/, () => json(RESOLVE)],
  ]);
  const result = await streams.SEARCHERS.playlatin('x', resolvedMovie, resolvedMovie.title, 8000);
  const stream = streams.toStream(result.hits[0], null);
  assert.equal(stream.url, 'https://cdn.example/master.m3u8');
  assert.equal(stream.behaviorHints.notWebReady, true);
  assert.equal(stream.behaviorHints.proxyHeaders.request.Referer, 'https://playlatinsrc.co/');
  assert.match(stream.title, /🎧 Latino/);
});

test('playlatin: atributos ajenos no cambian el ID del reproductor; no acepta otro episodio', async () => {
  const html = `<p data-id="tt999" data-resolve-token="ajeno"></p>${SHELL_SERIES}`;
  assert.equal(playlatin.parseShell(html).id, resolvedEpisode.imdbId);
  assert.equal(playlatin.parseShell(`<p data-id="tt999" data-resolve-token="ajeno"></p>`).ok, false);
  const calls = mockFetch([[/\/custom\/serial\//, () => new Response(html)]]);
  const result = await playlatin.searchPlayLatin('', { ...resolvedEpisode, episode: 3 });
  assert.equal(result.reason, 'identity-mismatch');
  assert.equal(calls.length, 1, 'no envía un POST para los datos de otro episodio');
});

test('playlatin: una identidad distinta en la respuesta y los iframes no son streams', async () => {
  for (const [payload, reason] of [
    [{ ...RESOLVE, imdb_id: 'tt999' }, 'identity-mismatch'],
    [{ ...RESOLVE, sources: [{ version: 'latino', kind: 'embed', url: 'https://embed.example/player.mp4' }] }, 'embeds-only'],
  ]) {
    mockFetch([[/\/custom\/movie\//, () => new Response(SHELL)], [/\/api\/resolve$/, () => json(payload)]]);
    const out = await playlatin.searchPlayLatin('', resolvedMovie);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, reason);
  }
});

const DROPEMBED = 'https://dr0pstream.com/e/fixture';
const DROPMASTER = 'https://r1.dropcdn.io/video/master.m3u8?token=fixture';
const dropHTML = (master) => `<script>jwplayer('video').setup({sources:[{file:'${master}'}]});</script>`;
const dropSource = { url: DROPEMBED, kind: 'embed', embed: true };
const masterHLS = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720.m3u8\n';

test('playlatin: respeta el resolver HTTPS anunciado y no envía tokens a otro destino', async () => {
  for (const endpoint of ['https://tercero.example/api/resolve', '/api/list', '/api/resolve?other=1']) {
    const calls = mockFetch([[/\/custom\/movie\//, () => new Response(SHELL.replace('data-mode=', `data-resolve-endpoint="${endpoint}" data-mode=`))]]);
    assert.equal((await playlatin.searchPlayLatin('', resolvedMovie)).reason, 'unsupported-resolver');
    assert.equal(calls.length, 1);
  }
  const calls = mockFetch([
    [/\/custom\/movie\//, () => new Response(SHELL.replace('data-mode=', 'data-resolve-endpoint="/api/player/resolve" data-mode='))],
    [/^https:\/\/playlatinsrc\.co\/api\/player\/resolve$/, (_, init) => {
      assert.equal(init.redirect, 'manual');
      return json(RESOLVE);
    }],
  ]);
  assert.equal((await playlatin.searchPlayLatin('', resolvedMovie)).hits.length, 2);
  assert.equal(calls.length, 2);
});

test('playlatin: lee HLS de Dropload para el episodio antiguo sin etiquetar películas sin versión', async () => {
  const calls = mockFetch([
    [/\/custom\/serial\//, () => new Response(SHELL_SERIES)],
    [/\/api\/resolve$/, () => json({ type: 'series', season: 1, episode: 2, id: resolvedEpisode.imdbId,
      sources: [dropSource, { url: 'https://doodstream.com/e/fixture', kind: 'embed' }] })],
    [/^https:\/\/dr0pstream\.com\/e\/fixture$/, (_, init) => {
      assert.match(init.headers.Referer, /\/custom\/serial\/tt0108778\/1\/2$/);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.method, undefined);
      return new Response(dropHTML(DROPMASTER));
    }],
    [/^https:\/\/r1\.dropcdn\.io\/video\/master\.m3u8/, (_, init) => {
      assert.equal(init.headers.Referer, 'https://dr0pstream.com/');
      assert.equal(init.redirect, 'manual');
      return new Response(masterHLS);
    }],
  ]);
  const report = {};
  const [hit] = await streams.runProviders(['playlatin'], '', resolvedEpisode, resolvedEpisode.title, report);
  assert.equal(report.playlatin.accepted, 1);
  assert.equal(hit.url, DROPMASTER);
  assert.equal(hit.audioLabel, 'Latino');
  assert.equal(hit.resolution, '720p');
  assert.equal(hit.verification, 'manifest-ok');
  assert.ok(hit.expiresAt <= Date.now() + 120_000);
  assert.equal(streams.toStream(hit, null).behaviorHints.proxyHeaders.request.Referer, 'https://dr0pstream.com/');
  assert.equal(calls.length, 4);

  const movieCalls = mockFetch([[/\/custom\/movie\//, () => new Response(SHELL)], [/\/api\/resolve$/, () => json({ ...RESOLVE, sources: [dropSource] })]]);
  assert.equal((await playlatin.searchPlayLatin('', resolvedMovie)).reason, 'embeds-only');
  assert.equal(movieCalls.length, 2);
});

test('playlatin: un challenge, HTML o un CDN ajeno no se convierte en stream', async () => {
  const good = { ...dropSource, version: 'castellano' };
  for (const [embed, body, reason, callCount] of [
    [new Response(dropHTML('https://r1.dropcdn.io.example/master.m3u8')), null, 'embed-no-public-media', 3],
    [new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }), null, 'embed-challenge', 3],
    [new Response(dropHTML(DROPMASTER)), new Response('<html>no hay vídeo</html>'), 'cdn-invalid-manifest', 4],
    [new Response(dropHTML(DROPMASTER)), new Response('denied', { status: 403 }), 'cdn-http-403', 4],
  ]) {
    const calls = mockFetch([
      [/\/custom\/movie\//, () => new Response(SHELL)],
      [/\/api\/resolve$/, () => json({ ...RESOLVE, sources: [good, { ...dropSource, version: 'inglés' }] })],
      [/^https:\/\/dr0pstream\.com\/e\/fixture$/, () => embed],
      [/^https:\/\/r1\.dropcdn\.io\//, () => body],
    ]);
    const result = await playlatin.searchPlayLatin('', resolvedMovie);
    assert.deepEqual(result.hits, []);
    assert.equal(result.reason, reason);
    assert.equal(calls.length, callCount);
  }
});
