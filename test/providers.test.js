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

// ─────────────────────────────────────────────────────────────────────────────
// Proveedores especializados de streams: YTS (películas) y Nyaa (anime)
// ─────────────────────────────────────────────────────────────────────────────
const NYAA_QUERY_S01E05 =
  '"S01E05"|" - 05"|"_-_05"|"01-"|"01~"|"01 ~"|"Season 1 "|"(Season 1"|"S1)"|"S1]"|"S1 ["|"S1 ("|' +
  '"Season 01 "|"(Season 01"|"S01)"|"S01]"|"S01 "|"S01."|"Batch"|"Complete"|" BD"|"[BD"|"(BD"|"Bluray"|"Blu-ray"|"DVD"';
const nyaaItem = (title, hash, seeders, extra = {}) => ({
  category: 'Anime - English-translated',
  title,
  magnet: `magnet:?xt=urn:btih:${hash}&dn=x&tr=http%3A%2F%2Fnyaa.tracker.wf%3A7777%2Fannounce`,
  size: '1.4 GiB',
  seeders,
  leechers: 2,
  ...extra,
});
const ytsMovie = (imdbCode, title, torrents) => ({ imdb_code: imdbCode, title, title_long: `${title} (2001)`, year: 2001, torrents });
const ytsTorrent = (hash, quality, seeds) => ({
  hash, quality, type: 'bluray', video_codec: 'x264', bit_depth: '8', audio_channels: '2.0', seeds, peers: 5, size_bytes: 1116691497,
});
const hostOf = (url) => new URL(url).hostname;

test('YTS: busca la película por IMDb id y acepta su resultado aunque el título no coincida', async () => {
  config.reload({ STREAM_PROVIDERS: 'yts' });
  const core = require('../lib/core');
  const requests = [];
  global.fetch = async (url) => {
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Spirited Away', year: '2001' } });
    requests.push(new URL(url));
    return json({
      status: 'ok',
      data: {
        movie_count: 2,
        movies: [
          // YTS la lista con su título original en romaji.
          ytsMovie('tt981301', 'Sen to Chihiro no kamikakushi', [
            ytsTorrent('C0B8838D4A6DB57C1A7AE44968B892C69974F709', '720p', 45),
            ytsTorrent('661B5355FBF1CD8070C98361F47B17DE32EC0D77', '1080p', 100),
          ]),
          // Otra película que la búsqueda devolviera de más: no es la pedida.
          ytsMovie('tt0000001', 'Spirited Away: Live on Stage', [ytsTorrent('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '1080p', 999)]),
        ],
      },
    });
  };
  const result = await core.handleStream('movie', 'tt981301');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin + requests[0].pathname, 'https://movies-api.accel.li/api/v2/list_movies.json');
  assert.equal(requests[0].searchParams.get('query_term'), 'tt981301');
  assert.equal(result.cacheMaxAge, 3600);
  assert.deepEqual(
    result.streams.map((s) => s.infoHash),
    ['661b5355fbf1cd8070c98361f47b17de32ec0d77', 'c0b8838d4a6db57c1a7ae44968b892c69974f709'] // por seeders
  );
  const [best] = result.streams;
  assert.equal(best.name, '🧲 1080p');
  assert.match(best.title, /^Sen to Chihiro no kamikakushi \(2001\) \[1080p\] \[BluRay\] \[x264\] \[2\.0\]\n/);
  assert.match(best.title, /👤 100/);
  assert.ok(best.sources.includes('tracker:udp://tracker.opentrackr.org:1337/announce'));
  assert.ok(best.sources.includes('dht:661b5355fbf1cd8070c98361f47b17de32ec0d77'));
});

test('YTS: no se consulta para series y una respuesta vacía se puede cachear', async () => {
  config.reload({ STREAM_PROVIDERS: 'yts' });
  const core = require('../lib/core');
  const hosts = [];
  global.fetch = async (url) => {
    hosts.push(hostOf(url));
    if (hostOf(url) === 'api.tvmaze.com') return json({ name: 'Example Show', premiered: '2020-01-01', language: 'English', type: 'Scripted', genres: [] });
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    return json({ status: 'ok', data: { movie_count: 0, limit: 20, page_number: 1 } }); // sin `movies`
  };
  const episode = await core.handleStream('series', 'tt981302:1:1');
  assert.deepEqual(episode.streams, []);
  assert.equal(episode.cacheMaxAge, 3600); // no aplicar no es un fallo
  assert.ok(!hosts.includes('movies-api.accel.li'), 'YTS no tiene series');

  const movie = await core.handleStream('movie', 'tt981303');
  assert.deepEqual(movie.streams, []);
  assert.equal(movie.cacheMaxAge, 3600);
  assert.equal(hosts.filter((host) => host === 'movies-api.accel.li').length, 1);
});

test('YTS: una respuesta inesperada cuenta como fallo y no se cachea', async () => {
  config.reload({ STREAM_PROVIDERS: 'yts', YTS_API_URL: 'https://yts.example/api/v2/' });
  const core = require('../lib/core');
  const requests = [];
  global.fetch = async (url) => {
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    requests.push(String(url));
    return json({ status: 'error', status_message: 'Query not successful' });
  };
  const result = await core.handleStream('movie', 'tt981304');
  assert.deepEqual(result.streams, []);
  assert.equal(result.cacheMaxAge, 0);
  // YTS_API_URL permite seguir a YTS cuando cambia de dominio.
  assert.equal(requests[0], 'https://yts.example/api/v2/list_movies.json?query_term=tt981304');
});

test('Nyaa: episodio de anime con título romaji de TMDB, categoría y filtro propios', async () => {
  config.reload({ STREAM_PROVIDERS: 'nyaa', TMDB_API_KEY: 'tmdb-nyaa-test' });
  const core = require('../lib/core');
  const nyaaRequests = [];
  const tmdbPaths = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      tmdbPaths.push(u.pathname);
      if (u.pathname.includes('/find/')) {
        return json({
          movie_results: [],
          tv_results: [{
            id: 981305, name: "Frieren: Beyond Journey's End", original_name: '葬送のフリーレン',
            original_language: 'ja', genre_ids: [16, 10759], first_air_date: '2023-09-29',
          }],
        });
      }
      return json({
        id: 981305,
        results: [
          { iso_3166_1: 'JP', title: 'そうそうのフリーレン', type: '' },      // otro alfabeto: no sirve para buscar
          { iso_3166_1: 'JP', title: 'Sousou no Frieren', type: 'Romaji' },
          { iso_3166_1: 'JP', title: 'Sousou no Frieren 2nd Season', type: '' }, // de una temporada concreta
          { iso_3166_1: 'DE', title: 'Frieren: Nach dem Ende der Reise', type: '' }, // otro país
        ],
      });
    }
    nyaaRequests.push(String(url));
    return json({
      count: 6,
      data: [
        nyaaItem('[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv', 'A'.repeat(40), 800),
        nyaaItem('[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [6AAEC79A].mkv', 'f6c3a88af352846e8a2b6cf0b8052b5c6649b121', 509),
        nyaaItem(
          '[EMBER] Frieren: Beyond Journey`s End (2023) (Season 1) [BDRip] [1080p Dual Audio HEVC 10 bits DDP] (Sousou no Frieren) (Batch)',
          'f03841b6b24585b1571df6b0c930d9946047058f', 271, { size: '16.8 GiB' }
        ),
        nyaaItem('[Piyoko] Sousou no Frieren - Marumaru no Mahou (Mini Anime) - 01~12 [WEB 1080p YT VP9 AAC 2.0]', 'b'.repeat(40), 39),
        nyaaItem('[SubsPlease] Sousou no Frieren - 06 (1080p) [0A1B2C3D].mkv', 'c'.repeat(40), 700),
        nyaaItem('Sousou no Frieren Original Soundtrack [FLAC] - 05', 'd'.repeat(40), 900, { category: 'Audio - Lossless' }),
      ],
    });
  };
  const result = await core.handleStream('series', 'tt981305:1:5');

  assert.deepEqual(tmdbPaths, ['/3/find/tt981305', '/3/tv/981305/alternative_titles']);
  assert.equal(nyaaRequests.length, 1);
  const request = new URL(nyaaRequests[0]);
  assert.equal(request.origin + request.pathname, 'https://nyaaapi.onrender.com/nyaa');
  assert.equal(request.searchParams.get('q'), `${NYAA_QUERY_S01E05} (Frieren Beyond Journey End)|(Sousou no Frieren)`);
  assert.equal(request.searchParams.get('category'), 'anime');
  assert.equal(request.searchParams.get('sort'), 'seeders');
  assert.equal(request.searchParams.get('order'), 'desc');
  // Comillas, barras y espacios viajan codificados.
  assert.ok(nyaaRequests[0].startsWith('https://nyaaapi.onrender.com/nyaa?q=%22S01E05%22%7C%22+-+05%22%7C'));

  // Solo el episodio pedido y el lote de su temporada, por seeders.
  assert.deepEqual(result.streams.map((s) => s.infoHash), ['a'.repeat(40), 'f03841b6b24585b1571df6b0c930d9946047058f']);
  assert.equal(result.cacheMaxAge, 3600);
  const [episode, batch] = result.streams;
  assert.equal(episode.name, '🧲 1080p');
  assert.equal(episode.title, '[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv\n💾 1.40 GB  👤 800  ⬇ 2');
  assert.deepEqual(episode.sources, ['tracker:http://nyaa.tracker.wf:7777/announce', `dht:${'a'.repeat(40)}`]);
  assert.match(batch.title, /\(Batch\)\n💾 16\.80 GB/);
});

test('Nyaa: no se consulta para títulos que no son anime ni producción asiática', async () => {
  config.reload({ STREAM_PROVIDERS: 'nyaa', TMDB_API_KEY: 'tmdb-nyaa-test' });
  const core = require('../lib/core');
  const hosts = [];
  global.fetch = async (url) => {
    hosts.push(hostOf(url));
    return json({
      movie_results: [],
      tv_results: [{ id: 981306, name: 'Example Western Show', original_name: 'Example Western Show', original_language: 'en', genre_ids: [18], first_air_date: '2019-01-01' }],
    });
  };
  const result = await core.handleStream('series', 'tt981306:1:1');
  assert.deepEqual(result.streams, []);
  assert.equal(result.cacheMaxAge, 3600);
  assert.deepEqual(hosts, ['api.themoviedb.org']); // ni títulos alternativos ni Nyaa
});

test('Nyaa: sin TMDB usa TVMaze, y los especiales (temporada 0) no se buscan', async () => {
  config.reload({ STREAM_PROVIDERS: 'nyaa' });
  const core = require('../lib/core');
  const nyaaRequests = [];
  global.fetch = async (url) => {
    if (hostOf(url) === 'api.tvmaze.com') {
      return json({ name: 'Alice in Borderland', type: 'Scripted', language: 'Japanese', genres: ['Drama'], premiered: '2020-12-10' });
    }
    nyaaRequests.push(new URL(url));
    return json({
      count: 2,
      data: [
        nyaaItem('Alice In Borderland S1 2020 4k 2160p NF WEB-DL x265 10bit EAC3-Shiniori', 'e'.repeat(40), 14, { category: 'Live Action - English-translated' }),
        nyaaItem('Alice in Borderland S03 Season 3 2025 1080p NF WEBRip Dual Audio AAC5.1 10bits x265-Rapta', '1'.repeat(40), 60, { category: 'Live Action - English-translated' }),
      ],
    });
  };
  const result = await core.handleStream('series', 'tt981307:1:3');
  assert.equal(nyaaRequests.length, 1);
  assert.equal(nyaaRequests[0].searchParams.get('category'), 'live_action');
  assert.ok(nyaaRequests[0].searchParams.get('q').endsWith('"DVD" (Alice in Borderland)'));
  assert.deepEqual(result.streams.map((s) => s.infoHash), ['e'.repeat(40)]);
  assert.equal(result.streams[0].name, '🧲 2160p');

  const special = await core.handleStream('series', 'tt981307:0:1');
  assert.deepEqual(special.streams, []);
  assert.equal(special.cacheMaxAge, 3600);
  assert.equal(nyaaRequests.length, 1, 'un especial no genera otra consulta');
});

test('Nyaa: película de anime resuelta con Cinemeta (país y género)', async () => {
  config.reload({ STREAM_PROVIDERS: 'nyaa', NYAA_API_URL: 'https://nyaa.example/' });
  const core = require('../lib/core');
  const nyaaRequests = [];
  let cinemeta = { name: 'Suzume', year: '2022', genres: ['Animation', 'Adventure'], country: 'Japan' };
  global.fetch = async (url) => {
    if (hostOf(url).includes('cinemeta')) return json({ meta: cinemeta });
    nyaaRequests.push(new URL(url));
    return json({
      count: 4,
      data: [
        nyaaItem('[yolerejiju] Suzume 2022 1080p BD AAC 2.0 Hi10P x265 [Audio: SPA,ENG,FRE,POR] [Sub: Multi]', '2'.repeat(40), 43),
        nyaaItem('[DB] Makoto Shinkai Movie Collection [Dual Audio 10bit BD1080p][HEVC-x265] (Your Name.+Weathering with You+Suzume no Tojimari)', '3'.repeat(40), 80),
        nyaaItem('[Group] Suzume no Nichijou - 05 [1080p]', '4'.repeat(40), 70),
        nyaaItem('Suzume (2019) [BD 1080p]', '5'.repeat(40), 60),
      ],
    });
  };
  const result = await core.handleStream('movie', 'tt981308');
  assert.equal(nyaaRequests.length, 1);
  assert.equal(nyaaRequests[0].origin + nyaaRequests[0].pathname, 'https://nyaa.example/nyaa'); // NYAA_API_URL
  assert.equal(nyaaRequests[0].searchParams.get('q'), '(Suzume)');
  assert.equal(nyaaRequests[0].searchParams.get('category'), 'anime');
  assert.deepEqual(result.streams.map((s) => s.infoHash), ['2'.repeat(40)]);

  // Una película estadounidense no se busca en Nyaa.
  cinemeta = { name: 'Example Film', year: '2020', genres: ['Drama'], country: 'United States' };
  const western = await core.handleStream('movie', 'tt981309');
  assert.deepEqual(western.streams, []);
  assert.equal(western.cacheMaxAge, 3600);
  assert.equal(nyaaRequests.length, 1);
});

test('Nyaa: si la API falla o responde otra cosa, la respuesta no se cachea', async () => {
  config.reload({ STREAM_PROVIDERS: 'nyaa' });
  const core = require('../lib/core');
  let nyaaResponse = () => json({ detail: 'Invalid category. Refer to docs for more info.' });
  global.fetch = async (url) => {
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Suzume', year: '2022', genres: ['Animation'], country: 'Japan' } });
    return nyaaResponse();
  };
  assert.equal((await core.handleStream('movie', 'tt981310')).cacheMaxAge, 0);
  nyaaResponse = () => { throw new Error('timeout de prueba'); };
  assert.equal((await core.handleStream('movie', 'tt981310')).cacheMaxAge, 0);
  nyaaResponse = () => json({ count: 0, data: [] });
  assert.equal((await core.handleStream('movie', 'tt981310')).cacheMaxAge, 3600);
});

test('2ª pasada con el título original: Nyaa y YTS no se repiten', async () => {
  config.reload({ STREAM_PROVIDERS: 'knaben,nyaa,yts', TMDB_API_KEY: 'tmdb-altpass-test' });
  const core = require('../lib/core');
  const calls = { knaben: [], nyaa: [], yts: [] };
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      if (u.pathname.includes('/find/')) {
        return json({
          movie_results: [{
            id: 981311, title: 'Spirited Away', original_title: 'Sen to Chihiro no Kamikakushi',
            original_language: 'ja', genre_ids: [16, 10751], release_date: '2001-07-20',
          }],
          tv_results: [],
        });
      }
      return json({ id: 981311, titles: [] });
    }
    if (u.hostname === 'api.knaben.org') { calls.knaben.push(u.searchParams.get('q')); return json({ hits: [] }); }
    if (u.hostname === 'nyaaapi.onrender.com') { calls.nyaa.push(u.searchParams.get('q')); return json({ count: 0, data: [] }); }
    calls.yts.push(u.searchParams.get('query_term'));
    return json({ status: 'ok', data: { movie_count: 0 } });
  };
  const result = await core.handleStream('movie', 'tt981311');
  assert.deepEqual(result.streams, []);
  assert.equal(result.cacheMaxAge, 3600);
  assert.deepEqual(calls.knaben, ['Spirited Away 2001', 'Sen to Chihiro no Kamikakushi 2001']);
  // Nyaa ya buscó con todas las variantes del título y YTS por IMDb id.
  assert.deepEqual(calls.nyaa, ['(Spirited Away)|(Sen to Chihiro no Kamikakushi)']);
  assert.deepEqual(calls.yts, ['tt981311']);
});

test('diagnóstico de streams: explica la consulta de Nyaa y por qué se omite un proveedor', async () => {
  config.reload({ STREAM_PROVIDERS: 'nyaa,yts' });
  const streams = require('../lib/streams');
  global.fetch = async (url) => {
    if (hostOf(url) === 'api.tvmaze.com') {
      return json({ name: "Frieren: Beyond Journey's End", type: 'Animation', language: 'Japanese', genres: ['Anime'], premiered: '2023-09-29' });
    }
    return json({ count: 1, data: [nyaaItem("[Yameii] Frieren: Beyond Journey's End - S01E05 [English Dub] [CR WEB-DL 1080p H264 AAC]", '6'.repeat(40), 30)] });
  };
  const report = await streams.diagnose('series', 'tt981312:1:5', null);
  assert.equal(report.ok, true);
  assert.equal(report.totalStreams, 1);
  assert.equal(report.resolved.imdbId, 'tt981312');
  assert.equal(report.resolved.animation, true);
  assert.equal(report.resolved.language, 'Japanese');
  assert.deepEqual(report.providers.nyaa, { ok: true, raw: 1, relevant: 1, query: `${NYAA_QUERY_S01E05} (Frieren Beyond Journey End)` });
  assert.deepEqual(report.providers.yts, { ok: true, skipped: 'solo películas' });
});

test('healthz: informa de los cinco proveedores de streams', async () => {
  const worker = (await import('../worker.mjs')).default;
  const all = await (await worker.fetch(new Request('https://addon.example/healthz'), {}, {})).json();
  assert.deepEqual(all.streamProviders, ['knaben', 'torlock', 'blackholebay', 'nyaa', 'yts']);
  for (const key of all.streamProviders) assert.equal(all.sources[key], true, key);
  const some = await (await worker.fetch(new Request('https://addon.example/healthz'), { STREAM_PROVIDERS: 'yts,knaben' }, {})).json();
  assert.deepEqual(some.streamProviders, ['yts', 'knaben']);
  assert.equal(some.sources.yts, true);
  assert.equal(some.sources.nyaa, false);
  assert.equal(some.sources.torlock, false);
  assert.equal(some.sources.tvmaze, true);
});
