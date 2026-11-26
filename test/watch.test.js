'use strict';

/**
 * Tests del reproductor web (/watch) y su API interna (/internal/watch/*),
 * tanto en Cloudflare Worker como en Express (sin red externa).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const config = require('../lib/config');
const cache = require('../lib/cache');
const userConfig = require('../lib/userConfig');
const { renderWatch } = require('../lib/watchPage');
const watchApi = require('../lib/watchApi');

let worker;
let server;
let expressOrigin;

before(async () => {
  worker = (await import('../worker.mjs')).default;
  const app = require('../api/index');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  expressOrigin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function expressGet(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`${expressOrigin}${pathname}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          json: () => JSON.parse(text || '{}'),
        });
      });
    }).on('error', reject);
  });
}

test('watch: el <script> inline de /watch es JS válido (node --check)', () => {
  const html = renderWatch({ origin: 'https://addon.example', host: 'addon.example' });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, 'debe tener un único script inline');
  const tmp = path.join(os.tmpdir(), `watch-inline-${process.pid}.js`);
  fs.writeFileSync(tmp, scripts[0]);
  try {
    const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr || 'el script inline de /watch tiene errores de sintaxis');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('watch: estructura HTML, marca RamdonLatam, secciones y protección XSS', () => {
  const evil = 'x"><script>alert(9)</script>';
  const html = renderWatch({ origin: `https://${evil}`, host: evil, cfgPrefix: '/</script><script>alert(1)</script>' });
  assert.equal(html.includes('<script>alert(9)'), false, 'origin sin escapar');
  assert.equal(html.includes('<script>alert(1)'), false, 'cfgPrefix malicioso no se inyecta');
  assert.equal(/\$\{/.test(html), false, 'no deben quedar placeholders sin resolver');
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(html, /--bg: #060f1a;/);
  assert.match(html, /--brand: #ff8a2b;/);
  assert.match(html, /data-section="inicio"/);
  assert.match(html, /data-section="peliculas"/);
  assert.match(html, /data-section="series"/);
  assert.match(html, /data-section="anime"/);
  assert.match(html, /data-section="lista"/);
  assert.match(html, /id="searchInput"/);
  assert.match(html, /Ramdon<i>Latam<\/i>/);
});

test('watchApi: buildWatchCatalogs expone secciones, plataformas y respaldo con IDs de IMDb', () => {
  const data = watchApi.buildWatchCatalogs(null);
  assert.equal(data.ok, true);
  for (const key of ['inicio', 'peliculas', 'series', 'anime']) {
    assert.ok(Array.isArray(data.sections[key]) && data.sections[key].length >= 4, `sección ${key}`);
  }
  assert.ok(data.platforms.some((p) => p.key === 'netflix' && p.movieId === 'cine_netflix' && p.seriesId === 'tv_netflix'));
  assert.ok(data.platforms.some((p) => p.key === 'crunchyroll'));
  for (const list of [data.fallback.movies, data.fallback.series, data.fallback.animeSeries, data.fallback.animeMovies]) {
    assert.ok(list.length >= 5);
    for (const item of list) {
      assert.match(item.id, /^tt\d+$/, `ID IMDb válido para ${item.name}`);
      assert.ok(item.poster.startsWith('https://image.tmdb.org/'));
    }
  }
});

test('watchApi: getWatchFallbackCatalog separa películas, series y anime', () => {
  const animeSeries = watchApi.getWatchFallbackCatalog('series', 'tv_anime');
  const animeMovies = watchApi.getWatchFallbackCatalog('movie', 'cine_anime');
  const movies = watchApi.getWatchFallbackCatalog('movie', 'cine_tendencias');
  const series = watchApi.getWatchFallbackCatalog('series', 'tv_tendencias');
  assert.ok(animeSeries.metas.every((m) => m.type === 'series' && m.isAnime));
  assert.ok(animeMovies.metas.every((m) => m.type === 'movie' && m.isAnime));
  assert.ok(movies.metas.every((m) => m.type === 'movie'));
  assert.ok(series.metas.every((m) => m.type === 'series'));
});

test('watchApi: searchWatch con TMDB filtra anime japonés y mapea resultados', async (t) => {
  cache.deletePrefix('watch:');
  config.reload({ TMDB_API_KEY: 'tmdb-watch-test' });
  t.after(() => {
    config.reload({});
    cache.deletePrefix('watch:');
  });

  t.mock.method(global, 'fetch', async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/search/tv')) {
      return Response.json({
        total_results: 2,
        results: [
          { id: 101, name: 'Solo Leveling', first_air_date: '2024-01-07', vote_average: 8.6, genre_ids: [16, 10759], original_language: 'ja', poster_path: '/sl.jpg', popularity: 90 },
          { id: 102, name: 'Solo Drama', first_air_date: '2020-05-01', vote_average: 6.5, genre_ids: [18], original_language: 'en', poster_path: '/sd.jpg', popularity: 10 },
        ],
      });
    }
    if (u.pathname.endsWith('/search/movie')) {
      return Response.json({ total_results: 0, results: [] });
    }
    if (u.pathname.endsWith('/search/multi')) {
      return Response.json({
        total_results: 2,
        results: [
          { id: 157336, media_type: 'movie', title: 'Interestelar', release_date: '2014-11-05', vote_average: 8.4, genre_ids: [878, 18], original_language: 'en', poster_path: '/int.jpg' },
          { id: 999, media_type: 'person', name: 'Persona ignorada' },
        ],
      });
    }
    return new Response('{}', { status: 404 });
  });

  const shortQ = await watchApi.searchWatch({ query: 'a', type: 'all' });
  assert.deepEqual(shortQ.results, []);

  const multi = await watchApi.searchWatch({ query: 'Interestelar', type: 'all' });
  assert.equal(multi.source, 'tmdb');
  assert.equal(multi.results.length, 1);
  assert.equal(multi.results[0].id, 'tmdb:movie:157336');
  assert.equal(multi.results[0].type, 'movie');

  const anime = await watchApi.searchWatch({ query: 'Solo', type: 'anime' });
  assert.equal(anime.results.length, 1);
  assert.equal(anime.results[0].name, 'Solo Leveling');
  assert.equal(anime.results[0].isAnime, true);
});

test('watchApi: searchWatch sin clave TMDB cae a búsqueda local + respaldo sin romper', async (t) => {
  cache.deletePrefix('watch:');
  config.reload({});
  t.after(() => cache.deletePrefix('watch:'));
  t.mock.method(global, 'fetch', async () => new Response('[]', { status: 503 }));

  const res = await watchApi.searchWatch({ query: 'Breaking', type: 'series' });
  assert.ok(res.results.some((r) => r.id === 'tt0903747' && r.name === 'Breaking Bad'));
});

test('Worker: /watch, /<cfg>/watch y /internal/watch/* responden correctamente', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('{}', { status: 503 }));
  const env = { WATCH_REGION: 'NI' };
  const getW = (p) => worker.fetch(new Request(`https://watch.example${p}`), env, {});

  for (const p of ['/watch', '/watch/']) {
    const res = await getW(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await res.text(), /RamdonLatam Watch/);
  }

  const seg = userConfig.encodeConfig({ lang: 'es-MX', region: 'MX', platforms: ['netflix'] });
  const personal = await getW(`/${seg}/watch`);
  assert.equal(personal.status, 200);
  const personalHtml = await personal.text();
  assert.ok(personalHtml.includes(`"cfgPrefix":"/${seg}"`));
  assert.ok(personalHtml.includes('"region":"MX"'));

  const fb = await getW('/internal/watch/fallback/series/tv_anime');
  assert.equal(fb.status, 200);
  assert.ok((await fb.json()).metas.length >= 5);

  const metaRes = await getW('/internal/watch/meta/movie/tt0816692.json');
  assert.equal(metaRes.status, 200);
  const metaBody = await metaRes.json();
  assert.equal(metaBody.meta.name, 'Interestelar');
  assert.ok(metaBody.meta.poster);

  const searchRes = await getW('/internal/watch/search?q=Attack&type=anime');
  assert.equal(searchRes.status, 200);
  const searchBody = await searchRes.json();
  assert.ok(searchBody.results.some((r) => r.id === 'tt2560140'));
});

test('Express: /watch y /internal/watch/* responden igual que el Worker', async (t) => {
  t.mock.method(global, 'fetch', async () => new Response('{}', { status: 503 }));

  const page = await expressGet('/watch');
  assert.equal(page.status, 200);
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.text, /RamdonLatam Watch/);

  const cats = await expressGet('/internal/watch/catalogs');
  assert.equal(cats.status, 200);
  assert.equal(cats.json().ok, true);

  const fb = await expressGet('/internal/watch/fallback/movie/cine_anime');
  assert.equal(fb.status, 200);
  assert.ok(fb.json().metas.length >= 4);

  const meta = await expressGet('/internal/watch/meta/series/tt2560140.json');
  assert.equal(meta.status, 200);
  assert.equal(meta.json().meta.name, 'Attack on Titan');

  const search = await expressGet('/internal/watch/search?q=Dune&type=movie');
  assert.equal(search.status, 200);
  assert.ok(search.json().results.some((r) => r.id === 'tt15239678'));
});
