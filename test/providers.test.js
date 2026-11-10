'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const http = require('../lib/http');
const tvmaze = require('../lib/tvmaze');
const watchmode = require('../lib/watchmode');
const omdb = require('../lib/omdb');
const tmdb = require('../lib/tmdb');
const tvdb = require('../lib/tvdb');
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('errores HTTP no incluyen credenciales ni cuerpo del proveedor', async () => {
  global.fetch = async () => json({ secret: 'secret-test' }, 401);
  await assert.rejects(http.fetchJson('https://example.com/?apikey=secret-test'), (err) => {
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes('secret-test'));
    return true;
  });
  await assert.rejects(http.fetchText('https://example.com/?token=secret-test'), /HTTP 401 al consultar https:\/\/example.com\//);
});

test('TVMaze usa schedule/web y normaliza sus episodios', async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return json([{ name: 'Episodio', season: 1, number: 1, _embedded: { show: { id: 819233, name: 'Serie', externals: { imdb: 'tt819233' } } } }]);
  };
  const metas = await tvmaze.airingToday();
  assert.match(urls[0], /\/schedule\/web\?date=/);
  assert.equal(metas[0].id, 'tt819233');
});

test('TVMaze trata 404 de lookup como ausencia y la cachea', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return json(null, 404); };
  assert.equal(await tvmaze.showLookupByImdb('tt981231'), null);
  assert.equal(await tvmaze.showLookupByImdb('tt981231'), null);
  assert.equal(calls, 1);
});

test('Watchmode usa search IMDb, lee title_results y consulta fuentes', async () => {
  config.reload({ WATCHMODE_API_KEY: 'test-watch' });
  const urls = [];
  global.fetch = async (url, opts) => {
    urls.push(new URL(url));
    assert.equal(opts.headers['X-API-Key'], 'test-watch');
    assert.ok(!String(url).includes('test-watch'));
    return urls.length === 1 ? json({ title_results: [{ id: 4321 }] }) : json([{ name: 'Netflix', type: 'sub', region: 'US' }]);
  };
  assert.deepEqual(await watchmode.availabilityByImdb('tt981232', 'US'), { region: 'US', names: ['Netflix'] });
  assert.equal(urls[0].pathname, '/v1/search/');
  assert.equal(urls[0].searchParams.get('search_field'), 'imdb_id');
  assert.equal(urls[0].searchParams.get('search_value'), 'tt981232');
  assert.equal(urls[1].pathname, '/v1/title/4321/sources/');
  await watchmode.availabilityByImdb('tt981232', 'US');
  assert.equal(urls.length, 2);
});

test('OMDB pausa tras cuota agotada y no cachea fallos transitorios', async () => {
  config.reload({ OMDB_API_KEY: 'test-omdb' });
  let calls = 0;
  global.fetch = async () => { calls++; return json({ Response: 'False', Error: 'Request limit reached!' }, 401); };
  assert.equal(await omdb.getByImdbId('tt981233'), null);
  assert.equal(await omdb.getByImdbId('tt981234'), null);
  assert.equal(calls, 1);
  config.reload({ OMDB_API_KEY: 'test-omdb-other' });
  global.fetch = async () => { calls++; return json({ imdbRating: '8.0' }); };
  assert.equal((await omdb.getByImdbId('tt981233')).imdbRating, '8.0');
});

test('TMDB frena después de 429 sin cachear el fallo como resultado', async () => {
  config.reload({ TMDB_API_KEY: 'test-tmdb' });
  let calls = 0;
  global.fetch = async () => { calls++; return json({}, 429, { 'retry-after': '10' }); };
  assert.equal(await tmdb.tmdbGet('/example-a'), null);
  assert.equal(await tmdb.tmdbGet('/example-b'), null);
  assert.equal(calls, 1);
  config.reload({ TMDB_API_KEY: 'test-tmdb-other' });
  global.fetch = async () => { calls++; return json({ ok: true }); };
  assert.deepEqual(await tmdb.tmdbGet('/example-a'), { ok: true });
});

test('TVDB resuelve remoteid y filtra el tipo aunque aparezcan episodios primero', async () => {
  config.reload({ TVDB_API_KEY: 'test-tvdb' });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return String(url).endsWith('/login') ? json({ data: { token: 'token' } }) : json({ data: [{ episode: { id: 1 } }, { series: { id: 99 } }] });
  };
  assert.equal((await tvdb.searchByRemoteId('tt981235', 'series')).id, 99);
  assert.match(urls[1], /\/search\/remoteid\/tt981235$/);
});


test('Watchmode no mezcla fuentes de países distintos en el fallback', async () => {
  config.reload({ WATCHMODE_API_KEY: 'test-regions' });
  global.fetch = async (url) => String(url).includes('/search/')
    ? json({ title_results: [{ id: 4455 }] })
    : json([{ name: 'Canada', type: 'sub', region: 'CA' }, { name: 'Mexico', type: 'sub', region: 'MX' }]);
  assert.deepEqual(await watchmode.availabilityByImdb('tt981237', 'NI'), { region: 'CA', names: ['Canada'] });
});

test('caché llena expulsa una entrada menos usada, no todo el contenido', () => {
  const cache = require('../lib/cache');
  for (let i = 0; i < 500; i++) cache.set(`lru-${i}`, i, 3600);
  assert.equal(cache.get('lru-0'), 0);
  cache.set('lru-new', 999, 3600);
  assert.equal(cache.get('lru-0'), 0);
  assert.equal(cache.get('lru-1'), undefined);
  assert.equal(cache.get('lru-499'), 499);
});

test('si falla un proveedor de streams se reintenta y no se cachea la respuesta degradada', async () => {
  config.reload({ STREAM_PROVIDERS: 'knaben' });
  const core = require('../lib/core');
  let calls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    calls++;
    if (calls === 1) throw new Error('timeout de prueba');
    return json({ hits: [] });
  };
  const first = await core.handleStream('movie', 'tt981238');
  assert.equal(first.cacheMaxAge, 0);
  const second = await core.handleStream('movie', 'tt981238');
  assert.equal(second.cacheMaxAge, 3600);
  assert.equal(calls, 2);
});

test('si falla detalle de TMDB continúa el fallback a OMDB', async () => {
  config.reload({ TMDB_API_KEY: 'tmdb-meta-test', OMDB_API_KEY: 'omdb-meta-test' });
  const core = require('../lib/core');
  global.fetch = async (url) => {
    if (String(url).includes('/find/')) return json({ movie_results: [{ id: 102030 }], tv_results: [] });
    if (String(url).includes('themoviedb.org')) return json({}, 503);
    return json({ Response: 'True', Title: 'Respaldo OMDB', imdbRating: '8' });
  };
  const result = await core.handleMeta('movie', 'tt981239');
  assert.equal(result.meta.name, 'Respaldo OMDB');
});


test('Worker marca no-store una respuesta de streams degradada', async () => {
  const worker = (await import('../worker.mjs')).default;
  global.fetch = async (url) => {
    if (String(url).includes('cinemeta')) return json({ meta: { name: 'Another Film' } });
    throw new Error('provider offline');
  };
  const res = await worker.fetch(new Request('https://addon.example/stream/movie/tt981240.json'), { STREAM_PROVIDERS: 'knaben' }, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).cacheMaxAge, 0);
});

test('TVDB usa un token distinto al cambiar de credenciales', async () => {
  let logins = 0;
  global.fetch = async (url, opts) => {
    if (String(url).endsWith('/login')) {
      logins++;
      return json({ data: { token: JSON.parse(opts.body).apikey } });
    }
    return json({ data: [{ movie: { id: 88, name: opts.headers.Authorization } }] });
  };
  config.reload({ TVDB_API_KEY: 'tvdb-key-first' });
  assert.equal((await tvdb.searchByRemoteId('tt981241', 'movie')).name, 'Bearer tvdb-key-first');
  config.reload({ TVDB_API_KEY: 'tvdb-key-second' });
  assert.equal((await tvdb.searchByRemoteId('tt981242', 'movie')).name, 'Bearer tvdb-key-second');
  assert.equal(logins, 2);
});
