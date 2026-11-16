'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const config = require('../lib/config');
const cache = require('../lib/cache');
const tmdb = require('../lib/tmdb');
const userConfig = require('../lib/userConfig');
const debridCredentials = require('../lib/debridCredentials');

let workerPromise;
function loadWorker() {
  if (!workerPromise) {
    workerPromise = import(pathToFileURL(path.join(__dirname, '..', 'worker.mjs')).href)
      .then((m) => m.default);
  }
  return workerPromise;
}

function makeFakeKv() {
  const store = new Map();
  const counts = { gets: 0, puts: 0, deletes: 0 };
  return {
    counts,
    kv: {
      async get(key) {
        counts.gets++;
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, val) {
        counts.puts++;
        store.set(key, String(val));
      },
      async delete(key) {
        counts.deletes++;
        store.delete(key);
      },
    },
  };
}

test('escala: canonicalización de Edge Cache comparte catálogo y meta entre usuarios con distinto <cfg> (incluido debridId), pero nunca comparte streams debrid', async () => {
  const worker = await loadWorker();
  const originalCaches = globalThis.caches;
  const originalFetch = global.fetch;
  const edgeStore = new Map();
  let edgePuts = 0;
  let tmdbCalls = 0;

  globalThis.caches = {
    default: {
      async match(req) {
        return edgeStore.get(req.url)?.clone() || undefined;
      },
      async put(req, res) {
        edgePuts++;
        edgeStore.set(req.url, res.clone());
      },
    },
  };

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.themoviedb.org/3/trending/movie/week')) {
      tmdbCalls++;
      return new Response(JSON.stringify({
        results: [{ id: 991122, title: 'Dune Parte Dos', release_date: '2024-03-01', vote_average: 8.4 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (href.includes('api.themoviedb.org/3/movie/991122/external_ids')) {
      tmdbCalls++;
      return new Response(JSON.stringify({ imdb_id: 'tt15239678' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const env = { TMDB_API_KEY: 'scale-tmdb-key', WATCH_REGION: 'MX', TMDB_LANGUAGE: 'es-MX' };
    const cfgUserA = userConfig.encodeConfig({
      lang: 'es-MX',
      region: 'MX',
      platforms: ['netflix', 'disney'],
      studios: ['marvel'],
      base: ['tendencias'],
      streams: ['knaben'],
      hide: ['cam'],
      debridId: 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6',
      debridProvider: 'torbox',
    });
    const cfgUserB = userConfig.encodeConfig({
      lang: 'es-MX',
      region: 'MX',
      platforms: ['netflix', 'prime', 'max'],
      studios: ['warner', 'a24'],
      base: ['tendencias', 'top'],
      streams: ['yts', 'eztv'],
      sort: 'quality',
      maxSize: 15,
      debridId: 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4',
      debridProvider: 'premiumize',
    });
    assert.notEqual(cfgUserA, cfgUserB);

    const resA = await worker.fetch(new Request(`https://scale.example/${cfgUserA}/catalog/movie/cine_tendencias.json`), env, {});
    const resB = await worker.fetch(new Request(`https://scale.example/${cfgUserB}/catalog/movie/cine_tendencias.json`), env, {});
    const resDefault = await worker.fetch(new Request('https://scale.example/catalog/movie/cine_tendencias.json'), env, {});

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(resDefault.status, 200);
    assert.equal(edgePuts, 1, 'los tres usuarios con misma región/idioma deben compartir 1 sola entrada en Edge Cache');
    assert.equal(tmdbCalls, 2, 'solo la primera petición debe consultar TMDB');

    const bodyB = await resB.json();
    assert.equal(bodyB.metas[0].id, 'tt15239678');

    // En cambio, /<cfg>/stream con debridId jamás toca caches.default y responde no-store
    const putsBeforeStream = edgePuts;
    const streamRes = await worker.fetch(new Request(`https://scale.example/${cfgUserA}/stream/movie/tt15239678.json`), env, {});
    assert.equal(streamRes.headers.get('cache-control'), 'no-store');
    assert.equal(edgePuts, putsBeforeStream, 'streams con cuenta debrid nunca entran en Edge Cache');
  } finally {
    global.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
    config.reload({});
  }
});

test('escala: KV debrid cachea lecturas descifradas en memoria del isolate e invalida al actualizar/borrar', async () => {
  const { kv, counts } = makeFakeKv();
  const env = {
    DEBRID_KV: kv,
    DEBRID_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef',
  };

  const saved = await debridCredentials.createCredential(
    { provider: 'torbox', token: 'tb_secret_token_1234567890' },
    env
  );
  assert.equal(counts.puts, 1);

  // 20 lecturas seguidas en caliente no deben disparar 20 lecturas contra Cloudflare KV (límite Free: 1.000/día)
  for (let i = 0; i < 20; i++) {
    const cred = await debridCredentials.getCredential(saved.credentialId, env);
    assert.equal(cred.token, 'tb_secret_token_1234567890');
  }
  assert.equal(counts.gets, 0, 'createCredential precarga la caché en memoria: 0 lecturas remotas a KV');

  // Si limpiamos la entrada en caché (simulando nuevo isolate), hace exactamente 1 KV.get y cachea el resto
  cache.del(`debrid:credential:${saved.credentialId}`);
  const parallel = await Promise.all(
    Array.from({ length: 10 }, () => debridCredentials.getCredential(saved.credentialId, env))
  );
  assert.equal(parallel.every((c) => c && c.token === 'tb_secret_token_1234567890'), true);
  assert.equal(counts.gets, 1, '10 lecturas concurrentes coalescen en 1 sola lectura a KV');

  // Al desconectar, invalida inmediatamente la caché en memoria
  await debridCredentials.disconnect(saved.credentialId, env);
  assert.equal(await debridCredentials.getCredential(saved.credentialId, env), null);
});

test('escala: TMDB limita subpeticiones external_ids por invocación (<50 límite Cloudflare Workers) y cachea 404', async () => {
  const originalFetch = global.fetch;
  let extCalls = 0;
  let notFoundCalls = 0;

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/discover/movie')) {
      const results = Array.from({ length: 30 }, (_, i) => ({
        id: 800000 + i,
        title: `Película ${i}`,
        release_date: '2025-01-01',
        vote_average: 7.5,
      }));
      return new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (href.includes('/movie/800000/external_ids')) {
      notFoundCalls++;
      return new Response(JSON.stringify({ status_message: 'Not found' }), { status: 404 });
    }
    if (href.includes('/external_ids')) {
      extCalls++;
      const m = href.match(/\/movie\/(\d+)\/external_ids/);
      return new Response(JSON.stringify({ imdb_id: `tt${m[1]}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  };

  try {
    config.reload({ TMDB_API_KEY: 'subreq-budget-key' });
    const def = { id: 'cine_populares', type: 'movie', kind: 'popular', mediaType: 'movie' };
    const firstBatch = await tmdb.catalogItems(def, { lang: 'es', region: 'MX', page: 1 });
    assert.equal(firstBatch.length, 30);
    const totalSubrequestsFirstCall = 1 + notFoundCalls + extCalls;
    assert.ok(
      totalSubrequestsFirstCall <= 26,
      `subpeticiones en frío (${totalSubrequestsFirstCall}) deben quedar muy por debajo del tope de 50 de Cloudflare`
    );

    // Segunda llamada: el 404 de 800000 no se vuelve a pedir y se completan los 6 restantes
    const notFoundAfterFirst = notFoundCalls;
    await tmdb.catalogItems(def, { lang: 'es', region: 'MX', page: 1 });
    assert.equal(notFoundCalls, notFoundAfterFirst, 'un 404 en external_ids queda cacheado negativamente');
  } finally {
    global.fetch = originalFetch;
    config.reload({});
  }
});

test('robustez: secuencias URI malformadas (%E0%A4%A) responden 400 limpio sin URIError en Worker ni Express', async () => {
  const worker = await loadWorker();
  const res = await worker.fetch(new Request('https://scale.example/meta/movie/%E0%A4%A.json'), {}, {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_id');
});

test('escala: /internal/watch/* emite cabeceras Cache-Control públicas con s-maxage y stale-while-revalidate', async () => {
  const worker = await loadWorker();
  const res = await worker.fetch(new Request('https://scale.example/internal/watch/catalogs'), {}, {});
  assert.equal(res.status, 200);
  const cc = res.headers.get('cache-control') || '';
  assert.match(cc, /public/);
  assert.match(cc, /s-maxage=21600/);
  assert.match(cc, /stale-while-revalidate=/);
});

test('escala: /internal/streams-test.json aplica rate limit por IP para impedir amplificación de búsquedas', async () => {
  const worker = await loadWorker();
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const headers = { 'cf-connecting-ip': '198.51.100.77' };
    let lastStatus = 200;
    for (let i = 0; i < 7; i++) {
      const res = await worker.fetch(new Request('https://scale.example/internal/streams-test.json?id=tt0133093', { headers }), {}, {});
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429, 'la 7.ª petición en el mismo minuto debe responder 429 rate_limited');
  } finally {
    global.fetch = originalFetch;
  }
});

test('escala: decodeConfig memoizado devuelve copias independientes sin contaminación por mutación', () => {
  const seg = userConfig.encodeConfig({
    lang: 'es-MX',
    region: 'MX',
    platforms: ['netflix'],
    studios: ['marvel'],
    base: ['tendencias'],
    streams: ['knaben'],
  });
  const first = userConfig.decodeConfig(seg, ['netflix', 'disney'], ['marvel', 'pixar'], ['knaben', 'yts']);
  first.platforms.push('disney');
  const second = userConfig.decodeConfig(seg, ['netflix', 'disney'], ['marvel', 'pixar'], ['knaben', 'yts']);
  assert.deepEqual(second.platforms, ['netflix']);
});

// ── Caché del isolate: la que salva un despliegue en `*.workers.dev` ─────
// La Cache API de Cloudflare no hace nada en `*.workers.dev` (docs: «any
// Cache API operations … in *.workers.dev deployments will have no impact»).
// Sin dominio propio, cada petición repetida volvía a ejecutar el fan-out
// completo: CPU, subpeticiones y cuota de APIs externas. La caché de
// respuestas del isolate funciona en cualquier entorno.

test('escala: sin Cache API (como en *.workers.dev) la memoria del isolate evita repetir el fan-out', async () => {
  const worker = await loadWorker();
  const responseCache = require('../lib/responseCache');
  const core = require('../lib/core');
  const originalCaches = globalThis.caches;
  const originalFetch = global.fetch;
  const originalHandler = core.handleCatalog;
  let handlerCalls = 0;

  delete globalThis.caches; // simula workers.dev: sin Cache API en absoluto
  responseCache.reset();
  config.reload({ TMDB_API_KEY: 'tmdb-scale-test', RESPONSE_CACHE_MB: '24' });
  core.handleCatalog = async (...args) => {
    handlerCalls++;
    return originalHandler.apply(core, args);
  };
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.themoviedb.org') {
      if (u.pathname.includes('/discover/')) {
        return new Response(JSON.stringify({ page: 1, total_pages: 1, results: [{ id: 1, title: 'Película de prueba', release_date: '2024-01-01' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ movie_results: [], tv_results: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ hits: [] }), { status: 200 });
  };

  const request = () => worker.fetch(new Request('https://scale.example/catalog/movie/cine_tendencias.json'), {}, {});
  try {
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-catalogos-cache'), 'miss');
    assert.equal(handlerCalls, 1);

    // 25 repeticiones del mismo catálogo (lo que hace Stremio al abrir la app
    // en cada equipo del mismo PoP): ninguna vuelve a ejecutar el handler.
    for (let i = 0; i < 25; i++) {
      const res = await request();
      assert.equal(res.headers.get('x-catalogos-cache'), 'memory');
    }
    assert.equal(handlerCalls, 1, 'la memoria del isolate absorbió las 25 repeticiones');

    // Sin esta capa, cada repetición reejecutaría el handler completo: es lo
    // que pasa hoy en un workers.dev, donde la Cache API no funciona.
    config.reload({ TMDB_API_KEY: 'tmdb-scale-test', RESPONSE_CACHE_MB: '0' });
    const cold = await request();
    assert.equal(cold.headers.get('x-catalogos-cache'), 'miss');
    assert.equal(handlerCalls, 2, 'sin caché de respuestas se repite el trabajo');
  } finally {
    core.handleCatalog = originalHandler;
    config.reload({ RESPONSE_CACHE_MB: '24' });
    responseCache.reset();
    global.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('escala: 20 peticiones simultáneas del mismo recurso frío ejecutan el fan-out una sola vez', async () => {
  const worker = await loadWorker();
  const responseCache = require('../lib/responseCache');
  const core = require('../lib/core');
  const originalCaches = globalThis.caches;
  const originalFetch = global.fetch;
  const originalHandler = core.handleCatalog;
  let handlerCalls = 0;

  delete globalThis.caches;
  responseCache.reset();
  config.reload({ TMDB_API_KEY: 'tmdb-scale-test', RESPONSE_CACHE_MB: '24' });
  core.handleCatalog = async (...args) => {
    handlerCalls++;
    return originalHandler.apply(core, args);
  };
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.themoviedb.org' && u.pathname.includes('/discover/')) {
      return new Response(JSON.stringify({ page: 1, total_pages: 1, results: [{ id: 1, title: 'Película de prueba', release_date: '2024-01-01' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ movie_results: [], tv_results: [] }), { status: 200 });
  };

  try {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => worker.fetch(new Request('https://scale.example/catalog/movie/cine_tendencias.json'), {}, {}))
    );
    assert.deepEqual([...new Set(responses.map((r) => r.status))], [200]);
    // Single-flight: 20 llegadas simultáneas sobre el mismo recurso frío
    // ejecutan UNA sola carga (las demás esperan el mismo resultado).
    assert.equal(handlerCalls, 1);
    await worker.fetch(new Request('https://scale.example/catalog/movie/cine_tendencias.json'), {}, {});
    assert.equal(handlerCalls, 1, 'la 21ª ya sale de memoria');
  } finally {
    core.handleCatalog = originalHandler;
    config.reload({ RESPONSE_CACHE_MB: '24' });
    responseCache.reset();
    global.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('escala: las respuestas del Worker se marcan para poder auditar qué tráfico es gratis', async () => {
  const worker = await loadWorker();
  const responseCache = require('../lib/responseCache');
  responseCache.reset();
  const res = await worker.fetch(new Request('https://scale.example/healthz'), {}, {});
  assert.equal(res.status, 200);
  // Los static assets de public/ se sirven SIN ejecutar el Worker, así que
  // una respuesta sin esta cabecera no consumió invocación: es lo que mide
  // scripts/scale-audit.mjs contra el despliegue real.
  assert.equal(res.headers.get('x-catalogos-runtime'), 'worker');
  const body = await res.json();
  assert.equal(typeof body.responseCache.entries, 'number');
  assert.equal(typeof body.responseCache.budgetBytes, 'number');
});
