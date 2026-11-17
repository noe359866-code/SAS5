'use strict';

/**
 * Caché de respuestas del isolate: es la única caché que funciona en
 * `*.workers.dev`, donde la Cache API de Cloudflare no hace nada. Debe
 * proteger los 128 MB del isolate, respetar `no-store` y no amplificar
 * peticiones concurrentes.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const responseCache = require('../lib/responseCache');
const config = require('../lib/config');

const originalNow = Date.now;
let clock = Date.now();

before(() => {
  clock = Date.now();
  Date.now = () => clock;
  responseCache.reset();
  responseCache.configure(1); // 1 MB: presupuesto pequeño para forzar expulsiones
});

after(() => {
  Date.now = originalNow;
  responseCache.reset();
  responseCache.configure(24);
});

test('la caché de respuestas respeta el presupuesto en bytes, no el número de entradas', () => {
  responseCache.reset();
  // 12 respuestas de 100 KB = 1,2 MB, por encima del presupuesto de 1 MB.
  for (let i = 0; i < 12; i++) {
    assert.equal(responseCache.set(`k${i}`, 'x'.repeat(100_000), 60), true);
  }
  const stats = responseCache.stats();
  assert.ok(stats.bytes <= 1024 * 1024, `bytes=${stats.bytes}`);
  assert.ok(stats.entries <= 11, `entradas=${stats.entries}`);
  assert.ok(stats.evictions > 0, 'tuvo que expulsar las menos usadas');
  // Lo último guardado sigue dentro; lo más antiguo ya no.
  assert.ok(responseCache.get('k11'));
  assert.equal(responseCache.get('k0'), undefined);
});

test('una respuesta por encima del tope no se guarda ni desplaza a las demás', () => {
  responseCache.reset();
  responseCache.set('pequena', 'x'.repeat(1000), 60);
  assert.equal(responseCache.set('enorme', 'x'.repeat(responseCache.MAX_ENTRY_BYTES + 1), 60), false);
  assert.ok(responseCache.get('pequena'), 'la respuesta gigante no echó a las útiles');
  assert.equal(responseCache.get('enorme'), undefined);
});

test('con RESPONSE_CACHE_MB=0 la caché se desactiva sin romper nada', () => {
  config.reload({ RESPONSE_CACHE_MB: '0' });
  responseCache.reset();
  assert.equal(responseCache.stats().enabled, false);
  assert.equal(responseCache.set('k', 'valor', 60), false);
  assert.equal(responseCache.get('k'), undefined);
  config.reload({ RESPONSE_CACHE_MB: '1' });
  responseCache.configure(1);
  assert.equal(responseCache.stats().enabled, true);
});

test('caduca según el TTL y sigue sirviendo en su ventana stale', () => {
  responseCache.reset();
  assert.equal(responseCache.set('ttl', 'v', 60, { staleSeconds: 60 }), true);
  assert.equal(responseCache.get('ttl'), 'v');
  clock += 61_000; // pasado el tiempo fresco, dentro de la gracia
  assert.equal(responseCache.get('ttl'), undefined, 'ya no es fresca');
  assert.equal(responseCache.getStale('ttl'), 'v', 'sirve caducada (stale-while-revalidate)');
  clock += 121_000; // fuera de la gracia
  assert.equal(responseCache.getStale('ttl'), undefined);
});

test('single-flight: 20 peticiones concurrentes del mismo recurso cargan una sola vez', async () => {
  responseCache.reset();
  let loads = 0;
  const loader = async () => {
    loads++;
    return 'cargado';
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => responseCache.coalesce('clave', loader)));
  assert.equal(loads, 1);
  assert.deepEqual([...new Set(results)], ['cargado']);
  assert.ok(responseCache.stats().coalesced >= 19);

  // En cuanto termina, la siguiente vuelve a cargar (no queda nada en vuelo).
  loads = 0;
  assert.equal(await responseCache.coalesce('clave', loader), 'cargado');
  assert.equal(loads, 1);
});

test('las métricas distinguen aciertos, fallos y aciertos stale', () => {
  responseCache.reset();
  responseCache.set('a', 'valor', 60, { staleSeconds: 60 });
  responseCache.get('a');
  responseCache.get('no-existe');
  clock += 61_000;
  responseCache.getStale('a');
  const stats = responseCache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.staleHits, 1);
  assert.equal(stats.entries, 1);
  assert.equal(stats.bytes, 5);
});

test('la ventana de gracia admite las 24 h que promete stale-while-revalidate', () => {
  const cache = require('../lib/responseCache');
  const config = require('../lib/config');
  config.reload({ RESPONSE_CACHE_MB: '24' });
  cache.reset();
  try {
    // Un catálogo publica `stale-while-revalidate=86400`: si la caché lo
    // recortara a 6 h, a las 7 h volvería a ejecutar TMDB en vez de servir.
    cache.set('k', '{"a":1}', 60, { staleSeconds: 86400 });
    const stats = cache.stats();
    assert.ok(stats.entries >= 1);
    // Sigue disponible como "stale" (y por tanto evita ejecutar el handler).
    assert.equal(cache.getStale('k'), '{"a":1}');
  } finally {
    cache.reset();
    config.reload(null);
  }
});
