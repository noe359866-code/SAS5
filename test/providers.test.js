'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const http = require('../lib/http');
const tvmaze = require('../lib/tvmaze');
const omdb = require('../lib/omdb');
const tmdb = require('../lib/tmdb');
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

test('un timeout se informa con plazo y URL, sin parámetros ni el genérico «aborted»', async () => {
  // Como fetch real: la petición no termina hasta que se aborta su señal.
  global.fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
  });
  for (const fetcher of [http.fetchJson, http.fetchText]) {
    await assert.rejects(fetcher('https://example.com/api/search?apikey=secret-test', { timeoutMs: 20 }), (err) => {
      assert.equal(err.message, 'Timeout de 20 ms al consultar https://example.com/api/search');
      assert.equal(err.timeout, true);
      return true;
    });
  }
  // Un fallo de red que no es timeout se propaga tal cual.
  global.fetch = async () => { throw new Error('socket hang up'); };
  await assert.rejects(http.fetchJson('https://example.com/', { timeoutMs: 20 }), (err) => {
    assert.equal(err.message, 'socket hang up');
    assert.equal(err.timeout, undefined);
    return true;
  });
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


test('caché llena expulsa una entrada menos usada, no todo el contenido', () => {
  const cache = require('../lib/cache');
  const max = cache.MAX_ENTRIES || cache.stats().maxEntries;
  for (let i = 0; i < max; i++) cache.set(`lru-${i}`, i, 3600);
  assert.equal(cache.get('lru-0'), 0);
  cache.set('lru-new', 999, 3600);
  assert.equal(cache.get('lru-0'), 0);
  assert.equal(cache.get('lru-1'), undefined);
  assert.equal(cache.get(`lru-${max - 1}`), max - 1);
});

test('caché sirve una entrada stale y coalesce cargas concurrentes', async () => {
  const cache = require('../lib/cache');
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    cache.set('stale-while-test', ['known'], 1, { staleSeconds: 30 });
    now += 2000;
    assert.equal(cache.get('stale-while-test'), undefined);
    assert.deepEqual(cache.getStale('stale-while-test'), ['known']);

    let loads = 0;
    const loader = () => cache.coalesce('in-flight-test', async () => {
      loads++;
      await Promise.resolve();
      return 'shared';
    });
    const values = await Promise.all([loader(), loader(), loader()]);
    assert.deepEqual(values, ['shared', 'shared', 'shared']);
    assert.equal(loads, 1);
  } finally {
    Date.now = originalNow;
  }
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

test('un proveedor que agota el plazo varias veces se pausa, y se reintenta al acabar la pausa', async () => {
  config.reload({ STREAM_PROVIDERS: 'knaben,blackholebay' });
  const core = require('../lib/core');
  const streams = require('../lib/streams');
  const calls = { knaben: 0, blackholebay: 0 };
  let down = true;
  global.fetch = async (url) => {
    const { hostname } = new URL(url);
    if (hostname.includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    if (hostname === 'api.knaben.org') {
      calls.knaben++;
      return json({ hits: [{ title: 'Example Film 2020 1080p WEB-DL', hash: 'a'.repeat(40), seeders: 10 }] });
    }
    calls.blackholebay++;
    if (down) throw Object.assign(new Error('Timeout de prueba'), { timeout: true });
    return json({ results: [] });
  };
  const originalNow = Date.now;
  try {
    // Los primeros timeouts se esperan y la respuesta degradada no se cachea.
    for (const id of ['tt981320', 'tt981321', 'tt981322']) {
      const degraded = await core.handleStream('movie', id);
      assert.equal(degraded.streams.length, 1);
      assert.equal(degraded.cacheMaxAge, 0);
    }
    assert.deepEqual(calls, { knaben: 3, blackholebay: 3 });
    assert.deepEqual(streams.pausedProviders(), ['blackholebay']);

    // En pausa: ya no se consulta y la respuesta se cachea lo que dura la pausa.
    const quick = await core.handleStream('movie', 'tt981323');
    assert.equal(quick.streams.length, 1);
    assert.equal(quick.cacheMaxAge, 300);
    assert.equal((await core.handleStream('movie', 'tt981323')).cacheMaxAge, 300);
    assert.deepEqual(calls, { knaben: 4, blackholebay: 3 });

    // El diagnóstico sí lo consulta, y avisa de que está en pausa.
    const report = await streams.diagnose('movie', 'tt981323', null);
    assert.deepEqual(report.pausedProviders, ['blackholebay']);
    assert.deepEqual(report.providers.blackholebay, { ok: false, error: 'Timeout de prueba' });
    assert.equal(calls.blackholebay, 4);

    // Acabada la pausa se vuelve a probar: sigue caído → otra pausa sin esperar a 3 fallos.
    Date.now = () => originalNow() + 301 * 1000;
    assert.equal((await core.handleStream('movie', 'tt981324')).cacheMaxAge, 0);
    assert.equal(calls.blackholebay, 5);
    assert.deepEqual(streams.pausedProviders(), ['blackholebay']);

    // Y cuando responde de nuevo, vuelve a la normalidad.
    Date.now = () => originalNow() + 602 * 1000;
    down = false;
    assert.equal((await core.handleStream('movie', 'tt981325')).cacheMaxAge, 3600);
    assert.equal(calls.blackholebay, 6);
    assert.deepEqual(streams.pausedProviders(), []);
  } finally {
    Date.now = originalNow;
  }
});

test('con STREAM_PROVIDER_COOLDOWN_SECONDS=0 ningún proveedor se pausa', async () => {
  config.reload({ STREAM_PROVIDERS: 'torlock', STREAM_PROVIDER_COOLDOWN_SECONDS: '0' });
  const core = require('../lib/core');
  const streams = require('../lib/streams');
  let calls = 0;
  let down = true;
  global.fetch = async (url) => {
    if (String(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    calls++;
    if (down) throw Object.assign(new Error('Timeout de prueba'), { timeout: true });
    return new Response('<rss><channel></channel></rss>');
  };
  for (let i = 0; i < 4; i++) assert.equal((await core.handleStream('movie', 'tt981326')).cacheMaxAge, 0);
  assert.equal(calls, 4);
  assert.deepEqual(streams.pausedProviders(), []);
  down = false; // una respuesta correcta deja el contador a cero para el resto de tests
  assert.equal((await core.handleStream('movie', 'tt981326')).cacheMaxAge, 3600);
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
  assert.equal(episode.title, '[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv\n1080p · MKV\n💾 1.40 GB  👤 800  ⬇ 2');
  assert.deepEqual(episode.sources, ['tracker:http://nyaa.tracker.wf:7777/announce', `dht:${'a'.repeat(40)}`]);
  assert.match(batch.title, /\(Batch\)\n[^\n]*\n💾 16\.80 GB/);
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
  const externalRequests = [];
  global.fetch = async (url) => {
    if (hostOf(url) === 'api.tvmaze.com') {
      return json({ name: 'Alice in Borderland', type: 'Scripted', language: 'Japanese', genres: ['Drama'], premiered: '2020-12-10' });
    }
    externalRequests.push(new URL(url));
    return json({
      count: 2,
      data: [
        nyaaItem('Alice In Borderland S1 2020 4k 2160p NF WEB-DL x265 10bit EAC3-Shiniori', 'e'.repeat(40), 14, { category: 'Live Action - English-translated' }),
        nyaaItem('Alice in Borderland S03 Season 3 2025 1080p NF WEBRip Dual Audio AAC5.1 10bits x265-Rapta', '1'.repeat(40), 60, { category: 'Live Action - English-translated' }),
      ],
    });
  };
  const result = await core.handleStream('series', 'tt981307:1:3');
  const nyaaRequests = externalRequests.filter((url) => hostOf(url) === 'nyaaapi.onrender.com');
  assert.equal(nyaaRequests.length, 1);
  assert.equal(externalRequests.filter((url) => hostOf(url) === 'v3-cinemeta.strem.io').length, 1,
    'Cinemeta se consulta en paralelo como respaldo de baja latencia');
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

// ─────────────────────────────────────────────────────────────────────────────
// EZTV y The RarBg
// ─────────────────────────────────────────────────────────────────────────────
const hash = (n) => String(n).padStart(40, '0');
const eztvTorrent = (title, n, extra = {}) => ({
  hash: hash(n),
  title: `${title} EZTV`,
  magnet_url: `magnet:?xt=urn:btih:${hash(n)}&dn=x&tr=udp://tracker.opentrackr.org:1337/announce`,
  imdb_id: '981330',
  season: '0', // como la API real: a menudo vienen a 0
  episode: '0',
  seeds: n,
  peers: 1,
  size_bytes: '479545240',
  ...extra,
});
const sinnerShow = { name: 'The Sinner', premiered: '2017-08-02', language: 'English', type: 'Scripted', genres: ['Drama'] };

test('EZTV: lista la serie por IMDb id y se queda con el episodio pedido', async () => {
  config.reload({ STREAM_PROVIDERS: 'eztv' });
  const core = require('../lib/core');
  const requests = [];
  const pages = {
    1: [
      eztvTorrent('The Sinner S04E08 1080p HEVC x265-MeGusta', 11, { season: '4', episode: '8' }),
      eztvTorrent('The Sinner S04E08 720p WEB H264-GGEZ', 12),
      eztvTorrent('The Sinner S04E07 1080p HEVC x265-MeGusta', 13),
      eztvTorrent('The Sinner S03E08 720p WEB h264-TBS', 14),
    ],
    2: [
      eztvTorrent('The Sinner S02E04 WEBRip x264-TBS', 21),
      eztvTorrent('The Sinner S02E04 720p WEBRip x264-TBS', 22),
      eztvTorrent('The Sinner S02E03 HDTV x264-KILLERS', 23),
      eztvTorrent('The Sinner S02 COMPLETE 720p WEB x264-TBS', 24),
      eztvTorrent('The Sinner S02E03-E05 720p WEB x264', 25),
      // EZTV asigna a veces a una serie torrents de otra de nombre parecido.
      eztvTorrent('The Winner S02E04 Part Four 480p x264-mSD', 26),
      // Y por si la API devolviera torrents de otro IMDb id.
      eztvTorrent('The Sinner S02E04 1080p WEB', 27, { imdb_id: '1' }),
    ],
  };
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.tvmaze.com') return json(sinnerShow);
    if (u.hostname.includes('cinemeta')) return json({ meta: null });
    requests.push(u);
    return json({ imdb_id: '981330', torrents_count: 129, limit: 100, page: Number(u.searchParams.get('page')), torrents: pages[u.searchParams.get('page')] });
  };

  // Episodio antiguo: no está en la 1ª página, así que se leen las dos.
  const old = await core.handleStream('series', 'tt981330:2:4');
  assert.deepEqual(requests.map((u) => u.searchParams.get('page')), ['1', '2']);
  assert.equal(requests[0].origin + requests[0].pathname, 'https://eztv1.xyz/api/get-torrents');
  assert.equal(requests[0].searchParams.get('imdb_id'), '981330'); // sin «tt»
  assert.equal(requests[0].searchParams.get('limit'), '100');
  assert.equal(old.cacheMaxAge, 3600);
  // El episodio, el lote que lo incluye y el pack de temporada; por seeders.
  assert.deepEqual(old.streams.map((s) => s.infoHash), [hash(25), hash(24), hash(22), hash(21)]);
  const last = old.streams[3];
  assert.match(last.title, /^The Sinner S02E04 WEBRip x264-TBS\n/); // sin la firma «EZTV»
  assert.ok(last.sources.includes('tracker:udp://tracker.opentrackr.org:1337/announce'));

  // Episodio reciente: la 1ª página ya lo trae y llega a episodios anteriores.
  requests.length = 0;
  const recent = await core.handleStream('series', 'tt981330:4:8');
  assert.deepEqual(requests.map((u) => u.searchParams.get('page')), ['1']);
  assert.deepEqual(recent.streams.map((s) => s.infoHash), [hash(12), hash(11)]);
});

test('EZTV: solo series, como mucho 4 páginas, y una respuesta inesperada no se cachea', async () => {
  config.reload({ STREAM_PROVIDERS: 'eztv', EZTV_API_URL: 'https://eztv.example/api/' });
  const core = require('../lib/core');
  const requests = [];
  let respond = () => json({ imdb_id: '981331', torrents_count: 0, limit: 100, page: 1 }); // sin `torrents`
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.tvmaze.com') return json({ ...sinnerShow, name: 'Example Show' });
    if (u.hostname.includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    requests.push(u.toString());
    return respond(u);
  };
  const movie = await core.handleStream('movie', 'tt981331');
  assert.deepEqual(movie.streams, []);
  assert.equal(movie.cacheMaxAge, 3600); // no aplicar no es un fallo
  assert.deepEqual(requests, []);

  // Serie que EZTV no tiene: respuesta vacía, se puede cachear.
  const unknown = await core.handleStream('series', 'tt981331:1:1');
  assert.deepEqual(unknown.streams, []);
  assert.equal(unknown.cacheMaxAge, 3600);
  // EZTV_API_URL permite seguir a EZTV cuando cambia de dominio.
  assert.deepEqual(requests, ['https://eztv.example/api/get-torrents?imdb_id=981331&limit=100&page=1']);

  // Los especiales (temporada 0) no se buscan.
  requests.length = 0;
  assert.equal((await core.handleStream('series', 'tt981331:0:1')).cacheMaxAge, 3600);
  assert.deepEqual(requests, []);

  // Serie muy larga: se leen las 4 páginas más recientes y no más.
  respond = (u) => json({
    imdb_id: '981331', torrents_count: 2467, limit: 100, page: Number(u.searchParams.get('page')),
    torrents: [eztvTorrent('Example Show S38E06 1080p WEB', 30 + Number(u.searchParams.get('page')), { imdb_id: '981331' })],
  });
  const long = await core.handleStream('series', 'tt981331:20:1');
  assert.deepEqual(long.streams, []);
  assert.equal(long.cacheMaxAge, 3600);
  assert.deepEqual(requests.map((url) => new URL(url).searchParams.get('page')), ['1', '2', '3', '4']);

  respond = () => json({ error: 'maintenance' });
  assert.equal((await core.handleStream('series', 'tt981331:1:2')).cacheMaxAge, 0);
});

const rarbgResult = (name, n, extra = {}) => ({
  name,
  infoHash: hash(n),
  magnet: `magnet:?xt=urn:btih:${hash(n).toUpperCase()}&dn=x&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce`,
  category: 'Movies',
  size: 2952790016,
  seeders: n,
  leechers: 2,
  ...extra,
});

test('The RarBg: las películas se piden por IMDb id y se aceptan aunque el nombre esté traducido', async () => {
  config.reload({ STREAM_PROVIDERS: 'rarbg', RARBG_API_KEY: 'trb_test' });
  const core = require('../lib/core');
  const requests = [];
  global.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname.includes('cinemeta')) return json({ meta: { name: 'The Godfather', year: '1972' } });
    requests.push({ url: u, headers: init.headers });
    return json({
      total: 4, page: 1, pageSize: 50, pages: 1,
      results: [
        rarbgResult('The Godfather 1972 1080p BluRay x264', 41, { imdb: 'tt981340' }),
        rarbgResult('El Padrino (1972) [BluRay 1080p][Castellano]', 42, { imdb: 'tt981340' }),
        rarbgResult('The Godfather Part II 1974 1080p BluRay', 43, { imdb: 'tt0000002' }),
        rarbgResult('The Godfather OST FLAC', 44, { imdb: 'tt981340', category: 'Music' }),
      ],
    });
  };
  const result = await core.handleStream('movie', 'tt981340');
  assert.equal(requests.length, 1);
  const { url, headers } = requests[0];
  assert.equal(url.origin + url.pathname, 'https://rarbg.ninjaproxy1.com/api/v1/search/');
  assert.equal(url.searchParams.get('imdb'), 'tt981340');
  assert.equal(url.searchParams.get('q'), null);
  assert.equal(url.searchParams.get('sort'), 'seeders');
  assert.equal(url.searchParams.get('limit'), '50');
  // La clave opcional viaja en una cabecera, nunca en la URL.
  assert.equal(headers['X-Api-Key'], 'trb_test');
  assert.ok(!url.toString().includes('trb_test'));
  assert.equal(result.cacheMaxAge, 3600);
  assert.deepEqual(result.streams.map((s) => s.infoHash), [hash(42), hash(41)]);
  assert.match(result.streams[0].title, /^El Padrino \(1972\) \[BluRay 1080p\]\[Castellano\]\n/);
});

test('The RarBg: los episodios se buscan por texto y se descartan los de otra serie', async () => {
  config.reload({ STREAM_PROVIDERS: 'rarbg', RARBG_API_URL: 'https://rarbg.example/' });
  const core = require('../lib/core');
  const requests = [];
  global.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'api.tvmaze.com') return json({ ...sinnerShow, name: 'Breaking Bad' });
    if (u.hostname.includes('cinemeta')) return json({ meta: null });
    requests.push({ url: u, headers: init.headers });
    return json({
      total: 4, page: 1, pageSize: 50, pages: 1,
      results: [
        rarbgResult('Breaking Bad S05E05 Dead Freight 2160p NF WEB-DL', 51, { imdb: 'tt981341', category: 'TV' }),
        rarbgResult('Breaking Bad S05E05 FRENCH LD HDTV XviD MiND', 52, { category: 'TV' }), // sin IMDb id en el índice
        rarbgResult('Breaking Bad Canada S05E05 720p WEB', 53, { imdb: 'tt0000003', category: 'TV' }),
        rarbgResult('Breaking Bad S04E05 1080p BluRay', 54, { imdb: 'tt981341', category: 'TV' }),
      ],
    });
  };
  const result = await core.handleStream('series', 'tt981341:5:5');
  assert.equal(requests.length, 1);
  const { url, headers } = requests[0];
  assert.equal(url.origin + url.pathname, 'https://rarbg.example/api/v1/search/');
  assert.equal(url.searchParams.get('q'), 'Breaking Bad S05E05');
  assert.equal(url.searchParams.get('clean'), '1');
  assert.equal(url.searchParams.get('category'), 'movies,tv,anime');
  assert.equal(url.searchParams.get('imdb'), null);
  assert.equal(headers['X-Api-Key'], undefined); // sin RARBG_API_KEY
  assert.equal(result.cacheMaxAge, 3600);
  assert.deepEqual(result.streams.map((s) => s.infoHash), [hash(52), hash(51)]);
});

test('The RarBg: con HTTP 429 se pausa lo que pide Retry-After y una respuesta rara no se cachea', async () => {
  config.reload({ STREAM_PROVIDERS: 'rarbg' });
  const core = require('../lib/core');
  const streams = require('../lib/streams');
  let calls = 0;
  let respond = () => json({ error: 'rate limit exceeded', scope: 'minute', retry_after: 40 }, 429, { 'Retry-After': '40' });
  global.fetch = async (url) => {
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    calls++;
    return respond();
  };
  const originalNow = Date.now;
  try {
    assert.equal((await core.handleStream('movie', 'tt981342')).cacheMaxAge, 0);
    assert.deepEqual(streams.pausedProviders(), ['rarbg']);
    // En pausa no se insiste, y la respuesta sin él se cachea un rato.
    assert.equal((await core.handleStream('movie', 'tt981343')).cacheMaxAge, 300);
    assert.equal(calls, 1);
    // Pasados los 40 s se vuelve a consultar.
    Date.now = () => originalNow() + 41 * 1000;
    respond = () => json({ error: "unknown sort 'x'" }, 400);
    assert.equal((await core.handleStream('movie', 'tt981344')).cacheMaxAge, 0);
    assert.equal(calls, 2);
    assert.deepEqual(streams.pausedProviders(), []);
    respond = () => json({ total: 0, page: 1, pageSize: 50, pages: 0, results: [] });
    assert.equal((await core.handleStream('movie', 'tt981344')).cacheMaxAge, 3600);
  } finally {
    Date.now = originalNow;
  }
});

test('healthz: informa de los quince proveedores de streams', async () => {
  const worker = (await import('../worker.mjs')).default;
  const all = await (await worker.fetch(new Request('https://addon.example/healthz'), {}, {})).json();
  assert.deepEqual(all.streamProviders, [
    'knaben', 'torlock', 'blackholebay', 'nyaa', 'yts', 'eztv', 'rarbg', 'torrentindexer', 'torrentioes', 'espanol', 'spinflix', 'fanpelis', 'embed69', 'videoapi', 'playlatin',
  ]);
  for (const key of all.streamProviders) assert.equal(all.sources[key], true, key);
  const some = await (await worker.fetch(new Request('https://addon.example/healthz'), { STREAM_PROVIDERS: 'yts,knaben' }, {})).json();
  assert.deepEqual(some.streamProviders, ['yts', 'knaben']);
  assert.equal(some.sources.yts, true);
  assert.equal(some.sources.nyaa, false);
  assert.equal(some.sources.torlock, false);
  assert.equal(some.sources.tvmaze, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Torrentio ES/Latino — proveedores españoles y latinoamericanos
// ─────────────────────────────────────────────────────────────────────────────
test('Torrentio ES/Latino: busca por IMDb en los indexadores hispanos y preserva fileIdx', async () => {
  config.reload({ STREAM_PROVIDERS: 'torrentioes' });
  const core = require('../lib/core');
  const requests = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('cinemeta')) return json({ meta: { name: 'Avengers: Endgame', year: '2019' } });
    requests.push(u);
    return json({
      streams: [
        {
          name: 'Torrentio\n1080p',
          title: 'Avengers.endgame.2019.1080p-dual-lat\n👤 88 💾 2.90 GB ⚙️ Cinecalidad\nDual Audio / 🇲🇽',
          infoHash: 'a'.repeat(40), fileIdx: 1,
          behaviorHints: { filename: 'Avengers.endgame.2019.1080p-dual-lat.mkv' },
        },
        { name: 'Torrentio\n1080p', title: 'English only release\n👤 20 💾 1 GB', infoHash: 'b'.repeat(40) },
      ],
    });
  };
  const result = await core.handleStream('movie', 'tt4154796');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin, 'https://torrentio.strem.fun');
  assert.match(decodeURIComponent(requests[0].pathname), /providers=mejortorrent,wolfmax4k,cinecalidad\|language=spanish,latino\|sort=qualitysize/);
  assert.match(requests[0].pathname, /stream\/movie\/tt4154796\.json$/);
  assert.deepEqual(result.streams.map((s) => s.infoHash), ['a'.repeat(40)]);
  assert.equal(result.streams[0].fileIdx, 1);
  assert.match(result.streams[0].title, /DUAL/);
  assert.match(result.streams[0].title, /👤 88/);
  assert.ok(result.streams[0].sources.some((source) => source.startsWith('tracker:')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Índice BR (torrent-indexer)
// ─────────────────────────────────────────────────────────────────────────────
const brItem = (title, hash, size, seeds, extra = {}) => ({
  title,
  original_title: `${title} Torrent`,
  details: 'https://comando1.com/x/',
  year: '2019',
  imdb: '',
  audio: ['Português', 'Inglês'],
  magnet_link: `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=${encodeURIComponent(title)}`,
  date: '2019-08-31T00:00:00Z',
  info_hash: hash,
  trackers: ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.demonii.com:1337/announce'],
  size,
  leech_count: 2,
  seed_count: seeds,
  similarity: 0.16,
  ...extra,
});

test('Torrentio ES/Latino: solo el episodio/rango correcto del pack de temporada', async () => {
  config.reload({ STREAM_PROVIDERS: 'torrentioes', TMDB_API_KEY: 'tmdb-spanish-test' });
  const core = require('../lib/core');
  let request;
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      return json({ movie_results: [], tv_results: [{
        id: 1399, name: 'Breaking Bad', original_name: 'Breaking Bad',
        original_language: 'en', genre_ids: [18], first_air_date: '2008-01-20',
      }] });
    }
    request = u;
    return json({ streams: [
      {
        name: 'Torrentio\n1080p',
        title: 'Breaking Bad - Temporada 1 Completa [Cap. 101_107][Castellano]\nBreaking_Bad_1x01_Pilot.mkv\n👤 3 💾 2.14 GB ⚙️ MejorTorrent\n🇬🇧 / 🇪🇸',
        infoHash: 'c'.repeat(40), fileIdx: 0,
        behaviorHints: { filename: 'Breaking_Bad_1x01_Pilot.mkv' },
      },
      {
        name: 'Torrentio\n1080p', title: 'Breaking Bad 1x03 [Castellano]\n👤 12 💾 1 GB',
        infoHash: 'd'.repeat(40), fileIdx: 2,
      },
      {
        name: 'Torrentio\n1080p', title: 'Breaking Bad S02E02 [Español]\n👤 9 💾 1 GB',
        infoHash: 'e'.repeat(40), fileIdx: 4,
      },
    ] });
  };
  const result = await core.handleStream('series', 'tt0903747:1:2');
  assert.match(decodeURIComponent(request.pathname), /stream\/series\/tt0903747:1:2\.json$/);
  assert.deepEqual(result.streams.map((stream) => stream.infoHash), ['c'.repeat(40)]);
  assert.equal(result.streams[0].fileIdx, 0);
});

test('Índice BR: película por IMDb id, magnet en hex con los trackers del índice', async () => {
  config.reload({ STREAM_PROVIDERS: 'torrentindexer' });
  const core = require('../lib/core');
  const requests = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    requests.push(u);
    return json({
      count: 2,
      results: [
        brItem('[ACESSE comando1.com] Filme 2019 [1080p] [BluRay] [DUAL]', 'a'.repeat(40), '4.6 GB', 12, {
          imdb: 'https://www.imdb.com/title/tt981350/',
        }),
        // Otro título que el índice devuelve de más: no declara este IMDb id.
        brItem('Outro Filme 2019 720p Dublado', 'b'.repeat(40), '900 MB', 99, {
          imdb: 'https://www.imdb.com/title/tt0000001/',
        }),
      ],
    });
  };
  const result = await core.handleStream('movie', 'tt981350');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin + requests[0].pathname, 'https://torrent-indexer.darklyn.org/search');
  assert.equal(requests[0].searchParams.get('q'), 'tt981350');
  // Una consulta por id no lleva filtro de similitud (el índice la puntúa 0).
  assert.equal(requests[0].searchParams.get('filter_results'), 'false');
  assert.equal(requests[0].searchParams.get('sortBy'), 'seed_count');
  assert.equal(result.cacheMaxAge, 3600);
  assert.deepEqual(result.streams.map((s) => s.infoHash), ['a'.repeat(40)]);
  const [stream] = result.streams;
  assert.equal(stream.name, '🧲 1080p');
  assert.match(stream.title, /💾 4\.60 GB {2}👤 12/);
  assert.ok(stream.sources.includes('tracker:udp://tracker.opentrackr.org:1337/announce'));
  assert.ok(stream.sources.includes(`dht:${'a'.repeat(40)}`));
});

test('Índice BR: episodio de serie por el título en portugués de TMDB, solo el lote de su temporada', async () => {
  config.reload({ STREAM_PROVIDERS: 'torrentindexer', TMDB_API_KEY: 'tmdb-br-test' });
  const core = require('../lib/core');
  const tmdbCalls = [];
  const searches = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      tmdbCalls.push(u.pathname);
      if (u.pathname.includes('/find/')) {
        return json({
          movie_results: [],
          tv_results: [{
            id: 981351, name: 'Squid Game', original_name: '오징어 게임',
            original_language: 'ko', genre_ids: [10759], first_air_date: '2021-09-17',
          }],
        });
      }
      assert.equal(u.searchParams.get('language'), 'pt-BR');
      return json({ id: 981351, name: 'Round 6', original_name: '오징어 게임' });
    }
    searches.push(u);
    return json({
      count: 2,
      results: [
        brItem('Round.6.S02.1080p.WEB-DL.DUAL.5.1', 'c'.repeat(40), '18.58 GB', 22, {
          imdb: 'https://www.imdb.com/pt/title/tt981351/', year: '2024',
        }),
        // Otra temporada de la misma serie.
        brItem('Round.6.S01.1080p.WEB-DL.DD5.1.H.264.DUAL', 'd'.repeat(40), '12.00 GB', 5, {
          imdb: 'https://www.imdb.com/pt/title/tt981351/', year: '2021',
        }),
      ],
    });
  };
  const result = await core.handleStream('series', 'tt981351:2:3');

  assert.deepEqual(tmdbCalls, ['/3/find/tt981351', '/3/tv/981351']);
  // Dos consultas en paralelo: el IMDb id (exacta) y el título en portugués.
  assert.deepEqual(searches.map((u) => u.searchParams.get('q')), ['tt981351', 'Round 6']);
  assert.deepEqual(searches.map((u) => u.searchParams.get('filter_results')), ['false', 'true']);
  assert.deepEqual(result.streams.map((s) => s.infoHash), ['c'.repeat(40)]);
  // El nombre del release está en portugués y aun así se clasifica bien.
  assert.match(result.streams[0].title, /\n1080p · 5\.1 · WEB-DL · DUAL\n/);
});

test('Índice BR: sin IMDb id ni título en portugués no se consulta; una respuesta rara no se cachea', async () => {
  config.reload({ STREAM_PROVIDERS: 'torrentindexer' });
  const core = require('../lib/core');
  const hosts = [];
  global.fetch = async (url) => {
    hosts.push(hostOf(url));
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    if (hostOf(url) === 'api.tvmaze.com') return json({ name: 'Example Show', premiered: '2020-01-01', language: 'English', type: 'Scripted', genres: [] });
    return json({ error: 'boom' });
  };
  // Serie sin TMDB: no hay título en portugués ni IMDb id que buscar.
  const episode = await core.handleStream('series', 'tvmaze:981352:1:1');
  assert.deepEqual(episode.streams, []);
  assert.equal(episode.cacheMaxAge, 3600);
  assert.ok(!hosts.includes('torrent-indexer.darklyn.org'));

  // Respuesta sin `results`: el proveedor falla y la respuesta no se cachea.
  const broken = await core.handleStream('movie', 'tt981353');
  assert.deepEqual(broken.streams, []);
  assert.equal(broken.cacheMaxAge, 0);
});

// ── Fuentes en español (ES/LAT) ───────────────────────────────────────────
// Los lanzamientos hispanos se publican con el título en español, así que los
// indexadores generales solo los encuentran si se les pregunta en español.

/** Knaben/BHB devuelven sus resultados en `hits`/`results` con hash e info_hash. */
function esHit(title, hash, seeders, extra = {}) {
  return { title, hash, magnetUrl: `magnet:?xt=urn:btih:${hash}`, seeders, peers: 3, bytes: 2 * 1024 ** 3, ...extra };
}

test('Español ES/LAT: busca con el título en español y solo devuelve lanzamientos hispanos', async () => {
  config.reload({ STREAM_PROVIDERS: 'espanol', TMDB_API_KEY: 'tmdb-es-test' });
  const core = require('../lib/core');
  const knaben = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      if (u.pathname.includes('/find/')) {
        return json({ movie_results: [{ id: 981360, title: 'Dune: Part Two', original_title: 'Dune: Part Two', release_date: '2024-02-27' }], tv_results: [] });
      }
      // Detalle en español: España y México titulan igual, así que solo hay
      // una consulta nueva.
      return json({ id: 981360, title: 'Duna: Parte Dos' });
    }
    if (u.hostname === 'api.knaben.org') {
      knaben.push(u.searchParams.get('q'));
      return json({
        hits: [
          esHit('Duna Parte Dos 2024 1080p WEB-DL', 'a'.repeat(40), 40),
          // Otro estreno: no es la película pedida ni en español.
          esHit('Otra Pelicula 2024 1080p', 'b'.repeat(40), 990),
        ],
      });
    }
    if (u.hostname === 'theblackholebay.lol') {
      return json({ results: [{ name: 'Dune Part Two 2024 1080p [Castellano]', info_hash: 'c'.repeat(40), magnet: `magnet:?xt=urn:btih:${'c'.repeat(40)}`, seeders: 25, leechers: 5, size: 3 * 1024 ** 3 }] });
    }
    if (u.hostname === 'www.torlock.com') {
      // En inglés y sin marca de audio: no es contenido en español.
      return new Response('<rss><channel><item><title>Dune Part Two 2024 2160p</title><link>magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd</link></item></channel></rss>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }
    return json({});
  };
  const result = await core.handleStream('movie', 'tt981360');
  // La consulta viaja con el título en español y el año.
  assert.deepEqual(knaben, ['Duna: Parte Dos 2024']);
  assert.deepEqual(
    result.streams.map((s) => s.infoHash),
    ['a'.repeat(40), 'c'.repeat(40)], // por seeders; el inglés sin audio hispano queda fuera
  );
  assert.equal(result.cacheMaxAge, 3600);
  const [castellano] = result.streams.filter((s) => s.infoHash === 'c'.repeat(40));
  assert.match(castellano.title, /Dune Part Two 2024 1080p \[Castellano\]/);
});

test('Español ES/LAT: en series exige el episodio pedido, también en formato hispano', async () => {
  config.reload({ STREAM_PROVIDERS: 'espanol', TMDB_API_KEY: 'tmdb-es-test' });
  const core = require('../lib/core');
  const queries = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      if (u.pathname.includes('/find/')) {
        return json({ movie_results: [], tv_results: [{ id: 981361, name: 'The Last of Us', original_name: 'The Last of Us', first_air_date: '2023-01-15' }] });
      }
      return json({ id: 981361, name: 'The Last of Us' }); // mismo título: sin consulta extra
    }
    if (u.hostname === 'api.knaben.org') {
      queries.push(u.searchParams.get('q'));
      return json({ hits: [] });
    }
    return json({ results: [] });
  };
  const result = await core.handleStream('series', 'tt981361:1:2');
  assert.deepEqual(result.streams, []);
  // Sin título en español distinto, el proveedor se omite: no repite la
  // búsqueda en inglés que ya hacen los proveedores generales.
  assert.deepEqual(queries, []);
  assert.equal(result.cacheMaxAge, 3600); // omitir no es un fallo
});

test('Español ES/LAT: sin TMDB el proveedor se omite y no cuenta como fallo', async () => {
  config.reload({ STREAM_PROVIDERS: 'espanol', TMDB_API_KEY: '' });
  const core = require('../lib/core');
  const hosts = [];
  global.fetch = async (url) => {
    hosts.push(hostOf(url));
    if (hostOf(url).includes('cinemeta')) return json({ meta: { name: 'Example Film', year: '2020' } });
    return json({ hits: [] });
  };
  const result = await core.handleStream('movie', 'tt981362');
  assert.deepEqual(result.streams, []);
  assert.equal(result.cacheMaxAge, 3600);
  assert.ok(!hosts.includes('api.knaben.org'), 'sin clave de TMDB no hay título en español que buscar');
});

test('Español ES/LAT: si las tres fuentes fallan el proveedor falla y no se cachea', async () => {
  config.reload({ STREAM_PROVIDERS: 'espanol', TMDB_API_KEY: 'tmdb-es-test' });
  const core = require('../lib/core');
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.themoviedb.org') {
      if (u.pathname.includes('/find/')) {
        return json({ movie_results: [{ id: 981363, title: 'The Batman', original_title: 'The Batman', release_date: '2022-03-01' }], tv_results: [] });
      }
      return json({ id: 981363, title: 'El Batman' });
    }
    throw new Error('caída de prueba');
  };
  const result = await core.handleStream('movie', 'tt981363');
  assert.deepEqual(result.streams, []);
  assert.equal(result.cacheMaxAge, 0);
});

test('Español ES/LAT: audio latino y castellano se reconocen como españoles', () => {
  const streams = require('../lib/streams');
  const titles = ['The Batman', 'El Batman'];
  assert.equal(streams.spanishAudio('El Batman 2022 1080p [Castellano]', titles), true);
  assert.equal(streams.spanishAudio('The Batman 2022 1080p [Español Latino]', titles), true);
  assert.equal(streams.spanishAudio('The Batman 2022 1080p [Latino]', titles), true);
  // Sin marca de audio hispano no basta: eso ya lo cubren los generales.
  assert.equal(streams.spanishAudio('The Batman 2022 1080p WEB-DL', titles), false);
});
