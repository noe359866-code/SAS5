'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fanpelis = require('../lib/fanpelis');
const config = require('../lib/config');
const cache = require('../lib/cache');
const streams = require('../lib/streams');

const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

const MOVIE = { title: 'Matrix', altTitle: 'The Matrix', year: '1999', mediaType: 'movie', tmdbId: 603, imdbId: 'tt0133093', season: null, episode: null };
const SERIES = { title: 'Breaking Bad', altTitle: null, year: '2008', mediaType: 'tv', tmdbId: 1396, imdbId: 'tt0903747', season: 1, episode: 1 };

const MASTER = 'https://s9.vimeos.net/hls2/02/00005/ccjygcfxujhd_,n,h,.urlset/master.m3u8';
const EMBED = 'https://vimeos.net/embed-ccjygcfxujhd.html';
const HLS = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=1280x720\n720.m3u8';

/** Respuestas de la API, tal como las devolvió el servicio real (recortadas). */
const SEARCH_MOVIE = {
  error: false,
  data: { posts: [
    { _id: 18508, title: 'Matrix recargado', original_title: 'The Matrix Reloaded', release_date: '2003-05-15', type: 'movies', slug: 'matrix-recargado-2003' },
    { _id: 18507, title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-31', type: 'movies', slug: 'matrix-1999' },
    { _id: 15061, title: 'Matrix resurrecciones', original_title: 'The Matrix Resurrections', release_date: '2021-12-16', type: 'movies', slug: 'matrix-resurrecciones-2021' },
  ] },
};
const SEARCH_TV = {
  error: false,
  data: { posts: [{ _id: 20103, title: 'Breaking Bad', original_title: 'Breaking Bad', release_date: '2008-01-20', type: 'tvshows', slug: 'breaking-bad-2008' }] },
};
const EPISODES = {
  error: false,
  data: [
    { _id: 26786, title: 'Breaking Bad: Temporada 1 Episodio 1', slug: 'breaking-bad-temporada-1-episodio-1-2', season_number: 1, episode_number: 1 },
    { _id: 26785, title: 'Breaking Bad: Temporada 1 Episodio 1', slug: 'breaking-bad-temporada-1-episodio-1', season_number: 1, episode_number: 1 },
    { _id: 26787, title: 'Breaking Bad: Temporada 1 Episodio 2', slug: 'breaking-bad-temporada-1-episodio-2', season_number: 1, episode_number: 2 },
  ],
};
const PLAYER = {
  error: false,
  data: {
    embeds: [{ lang: 'Latino', quality: 'Full HD', url: EMBED }],
    downloads: [
      { url: 'https://mega.nz/file/abc', server: 'Mega', lang: 'Latino/Inglés', quality: 'Dual 1080p' },
      { url: 'https://mega.nz/file/sample', server: 'Download', lang: 'Latino/Inglés', quality: 'Dual 1080p' },
    ],
  },
};

/** Embed empaquetado con Dean Edwards: es lo que sirve vimeos.net de verdad. */
function packedEmbed(master) {
  // `eval(function(p,a,c,k,e,d){…}('0',1,1,'<m3u8>'.split('|')))` → '0' se
  // sustituye por el .m3u8: es la forma exacta que desempaqueta unpackPacked.
  return `<html><body><script>eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}('0',1,1,'${master}'.split('|')))</script></body></html>`;
}

function mockApi(handlers) {
  // Cada prueba empieza con la caché vacía: la clave es la URL de la API y,
  // sin esto, la segunda prueba reutilizaría la respuesta de la primera.
  cache.deletePrefix('fanpelis:');
  const calls = [];
  global.fetch = async (url, options) => {
    const u = String(url);
    calls.push(u);
    for (const [needle, reply] of handlers) {
      if (!u.includes(needle)) continue;
      return typeof reply === 'function' ? reply(u, options) : reply;
    }
    if (u === MASTER) return new Response(HLS);
    return json({}, 404);
  };
  return calls;
}

test('fanpelis película: búsqueda → player → embed → URL original del manifiesto', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player?post_id=18507', json(PLAYER)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.equal(out.hits.length, 1);
  const hit = out.hits[0];
  assert.equal(hit.provider, 'fanpelis');
  assert.equal(hit.relevant, true);
  assert.match(hit.title, /Matrix 1999/);
  assert.match(hit.title, /Latino/);
  // Sin sondeo: no se anuncia una resolución que nadie ha visto y el .m3u8
  // no se descarga.
  assert.equal(hit.resolution, null);
  assert.equal('verification' in hit, false);
  assert.ok(!calls.includes(MASTER), 'el manifiesto no se pide al CDN');
  assert.equal(hit.audioLabel, 'Latino');
  assert.equal(hit.url, MASTER);
  // Se eligió la ficha de 1999, no la de 2003 ni la de 2021.
  assert.ok(calls.some((u) => u.includes('post_id=18507')));
  assert.ok(!calls.some((u) => u.includes('post_id=18508')));
});

test('fanpelis: reintenta por el título antes de los dos puntos sin aceptar otra película', async () => {
  const resolved = { title: 'Mufasa: El rey león', altTitle: 'Mufasa: The Lion King', year: '2024', mediaType: 'movie' };
  const sameYear = { _id: 101, title: 'Otra película (2024)', release_date: '2024-01-01', type: 'movies' };
  const differentYear = { _id: 102, title: 'Mufasa: El rey león (2019)', release_date: '2019-01-01', type: 'movies' };
  const actual = { _id: 103, title: 'Mufasa: El rey león (2024)', release_date: '2024-12-18', type: 'movies' };
  const calls = mockApi([
    ['/api/rest/search', (url) => {
      const query = new URL(url).searchParams.get('query');
      return json({ data: { posts: query === 'Mufasa' ? [sameYear, differentYear, actual] : [sameYear] } });
    }],
    ['/api/rest/player', () => json(PLAYER)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  const out = await fanpelis.searchFanpelis(resolved.title, resolved, resolved.title, 1000);
  assert.equal(out.hits.length, 1);
  assert.equal(out.query, 'fanpelis="Mufasa"');
  assert.equal(new URL(calls[0]).searchParams.get('query'), 'Mufasa');
  assert.deepEqual(calls.filter((url) => url.includes('/api/rest/player')).map((url) => new URL(url).searchParams.get('post_id')), ['103']);
});

test('fanpelis serie: /episodes elige el episodio y su player es el del episodio', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_TV)],
    ['/api/rest/episodes?post_id=20103', json(EPISODES)],
    ['/api/rest/player?post_id=26785', json(PLAYER)],
    ['vimeos.net/embed-', html(packedEmbed(MASTER))],
  ]);
  const out = await fanpelis.searchFanpelis('Breaking Bad', SERIES, 'Breaking Bad', 1000);
  assert.equal(out.hits.length, 1);
  assert.match(out.hits[0].title, /Breaking Bad 2008 S01E01/);
  // Entre los dos episodios 1 duplicados gana el slug corto.
  assert.ok(calls.some((u) => u.includes('post_id=26785')));
  assert.ok(!calls.some((u) => u.includes('post_id=26786')));
});

test('fanpelis: el episodio que no existe devuelve cero hits sin romper', async () => {
  mockApi([
    ['/api/rest/search', json(SEARCH_TV)],
    ['/api/rest/episodes', json(EPISODES)],
  ]);
  const out = await fanpelis.searchFanpelis('Breaking Bad', { ...SERIES, season: 5, episode: 16 }, 'Breaking Bad', 1000);
  assert.deepEqual(out.hits, []);
});

test('fanpelis: enlaces de descarga y embeds desconocidos se ignoran', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player', json({ data: { embeds: [
      { lang: 'Latino', quality: 'HD', url: 'https://ads.example/tracker.js' },
      { lang: 'Latino', quality: 'HD', url: 'https://mega.nz/file/abc' },
    ], downloads: [{ url: 'https://mega.nz/file/sample' }] } })],
  ]);
  const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.deepEqual(out.hits, []);
  assert.ok(!calls.some((u) => u.includes('mega.nz')));
});

test('fanpelis: embed sin playlist no se presenta como vídeo', async () => {
  mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player', json(PLAYER)],
    ['vimeos.net/embed-', html('<html><body>sin playlist</body></html>')],
  ]);
  const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.equal(out.hits.length, 0);
});

test('fanpelis: caída total lanza (para que el proveedor se pause); vacío no', async () => {
  mockApi([['/api/rest/search', json({}, 500)]]);
  await assert.rejects(() => fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000));
  mockApi([['/api/rest/search', json({ data: { posts: [] } })]]);
  const empty = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
  assert.deepEqual(empty.hits, []);
});

test('fanpelis: FANPELIS=off lo desactiva sin tocar el resto', async () => {
  const original = config.fanpelisEnabled;
  config.fanpelisEnabled = false;
  try {
    const out = await fanpelis.searchFanpelis('Matrix', MOVIE, 'Matrix', 1000);
    assert.match(out.skipped, /FANPELIS=off/);
  } finally {
    config.fanpelisEnabled = original;
  }
});

test('fanpelis: aparece en /healthz y en los chips de /configure', () => {
  assert.ok(streams.PROVIDERS.some((provider) => provider.key === 'fanpelis'));
  const configure = require('../lib/configurePage');
  const page = configure.renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  const body = typeof page === 'string' ? page : page.html;
  assert.match(body, /data-group="streams" data-key="fanpelis"/);
});

test('fanpelis: utilidades de selección e idioma', () => {
  // Una coincidencia por prefijo no identifica una película.
  const picked = fanpelis.pickCandidates(SEARCH_MOVIE.data.posts, MOVIE);
  assert.deepEqual(picked.map((item) => item._id), [18507]);
  assert.deepEqual(fanpelis.pickCandidates([{ ...picked[0], release_date: '2009-05-16' }], MOVIE), []);
  assert.equal(fanpelis.audioLabelOf('Latino'), 'Latino');
  assert.equal(fanpelis.audioLabelOf('Castellano'), 'Castellano');
  assert.equal(fanpelis.audioLabelOf('Subtitulado'), 'Subtitulado');
  assert.equal(fanpelis.audioLabelOf('Latino/Inglés'), 'Latino + Inglés');
  assert.equal(fanpelis.audioLabelOf('English'), 'Inglés');
  assert.equal(fanpelis.audioLabelOf(''), '', 'no se inventa audio Latino si falta la etiqueta');
  assert.equal(fanpelis.pickEpisode(EPISODES.data, 1, 2)._id, 26787);
  assert.equal(fanpelis.pickEpisode(EPISODES.data, 9, 1), null);
});

test('fanpelis: conserva la lista de hosts conocidos de Vimeos sin admitir dominios ajenos', () => {
  const { allowedVideoUrl } = require('../lib/vimeos');
  for (const host of ['s9.vimeos.net', 'p3.vimeos.zip', 'vimeos.com', 's1.vimeos.xyz']) {
    assert.ok(allowedVideoUrl(`https://${host}/master.m3u8`), host);
  }
  for (const host of ['vimeos.net.evil.example', 'cdn.example', 'spinoff.link']) {
    assert.equal(allowedVideoUrl(`https://${host}/master.m3u8`), false, host);
  }
});

test('fanpelis: la API solo indexa el título traducido, así que se prueba sin artículo', async () => {
  // Comprobado contra el servicio real: «The Matrix» → 0 fichas; «Matrix» → 3.
  cache.deletePrefix('fanpelis:');
  const queries = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('/api/rest/search')) return json({}, 404);
    const q = decodeURIComponent((u.match(/query=([^&]*)/) || [])[1] || '');
    queries.push(q);
    // Solo responde al título sin artículo, como el servicio real.
    if (q === 'Matrix') return json(SEARCH_MOVIE);
    return json({ data: { posts: [] } });
  };
  const out = await fanpelis.searchFanpelis('The Matrix', { ...MOVIE, title: 'The Matrix', altTitle: null }, 'The Matrix', 1000);
  // El player y el embed no están simulados en este caso (responden 404): lo
  // que se prueba es que la consulta sin artículo encuentra la ficha.
  assert.deepEqual(out.hits || [], []);
  assert.ok(queries.includes('The Matrix'));
  assert.ok(queries.includes('Matrix'), `probó: ${queries.join(', ')}`);
});

test('fanpelis: sin sondeo se publica el primer episodio exacto con enlace válido', async () => {
  const obsolete = 'https://vimeos.net/embed-fixture-obsoleto.html';
  const denied = 'https://s9.vimeos.net/hls2/fixture/denied.m3u8';
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_TV)],
    ['/api/rest/episodes', json(EPISODES)],
    ['/api/rest/player?post_id=26785', json({ data: { embeds: [{ lang: 'Latino', url: obsolete }] } })],
    ['/api/rest/player?post_id=26786', json(PLAYER)],
    [obsolete, html(packedEmbed(denied))],
    [denied, json({}, 403)],
    [EMBED, html(packedEmbed(MASTER))],
  ]);
  const { hits } = await fanpelis.searchFanpelis(SERIES.title, SERIES, SERIES.title, 1000);
  assert.deepEqual(hits.map((hit) => hit.url), [denied]);
  assert.equal('verification' in hits[0], false);
  assert.match(hits[0].title, /S01E01/);
  assert.deepEqual(calls.filter((url) => url.includes('/api/rest/player')).map((url) => new URL(url).searchParams.get('post_id')), ['26785']);
});

test('fanpelis: idiomas descartados, hosts ajenos y enlaces repetidos no consumen el cupo de visores', async () => {
  const obsolete = 'https://vimeos.net/embed-fixture-ausente.html';
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_MOVIE)],
    ['/api/rest/player', json({ data: { embeds: [
      { lang: 'Inglés', url: 'https://vimeos.net/embed-english.html' },
      { lang: '', url: 'https://vimeos.net/embed-sin-idioma.html' },
      { lang: 'Latino', url: 'https://vimeos.net.evil.example/embed' },
      ...Array.from({ length: 5 }, () => ({ lang: 'Latino', url: obsolete })),
      { lang: 'Castellano', url: EMBED },
    ] } })],
    [EMBED, html(packedEmbed(MASTER))],
  ]);
  const { hits } = await fanpelis.searchFanpelis(MOVIE.title, MOVIE, MOVIE.title, 1000);
  assert.deepEqual(hits.map((hit) => hit.audioLabel), ['Castellano']);
  assert.deepEqual(calls.filter((url) => url.includes('/embed')), [obsolete, EMBED]);
});

test('fanpelis: el HTTP 429 del reproductor detiene la búsqueda antes de pedir otra copia', async () => {
  const calls = mockApi([
    ['/api/rest/search', json(SEARCH_TV)],
    ['/api/rest/episodes', json(EPISODES)],
    ['/api/rest/player?post_id=26785', json({}, 429)],
  ]);
  await assert.rejects(() => fanpelis.searchFanpelis(SERIES.title, SERIES, SERIES.title, 1000), { status: 429 });
  assert.equal(calls.filter((url) => url.includes('/api/rest/player')).length, 1);
});

test('fanpelis: publica la primera ficha con enlace válido, sin comprobar el manifiesto', async () => {
  const first = 'https://vimeos.net/embed-first.html';
  const denied = 'https://s9.vimeos.net/hls2/fixture/denied.m3u8';
  const posts = [
    { _id: 101, title: 'Matrix', release_date: '1999-01-01', type: 'movies' },
    { _id: 102, title: 'Matrix', release_date: '1999-01-01', type: 'movies' },
  ];
  const calls = mockApi([
    ['/api/rest/search', () => json({ data: { posts } })],
    ['/api/rest/player?post_id=101', () => json({ data: { embeds: [{ lang: 'Latino', url: first }] } })],
    ['/api/rest/player?post_id=102', () => json(PLAYER)],
    [first, () => html(packedEmbed(denied))],
    [denied, () => json({}, 403)],
    [EMBED, () => html(packedEmbed(MASTER))],
  ]);
  const result = await fanpelis.searchFanpelis('Matrix', MOVIE, MOVIE.title, 1000);
  assert.equal(result.hits[0].url, denied);
  assert.equal('verification' in result.hits[0], false);
  assert.equal(calls.filter((url) => url.includes('/api/rest/player')).length, 1,
    'con un enlace válido no se sigue probando fichas');
});

test('fanpelis: un error 500 del player no se confunde con ausencia de medios', async () => {
  mockApi([
    ['/api/rest/search', () => json(SEARCH_MOVIE)],
    ['/api/rest/player', () => json({}, 500)],
  ]);
  await assert.rejects(fanpelis.searchFanpelis('Matrix', MOVIE, MOVIE.title, 1000), { status: 500 });
});
