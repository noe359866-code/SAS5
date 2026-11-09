'use strict';

/**
 * Tests del Cloudflare Worker (sin red externa ni claves):
 * importan worker.mjs y llaman a fetch() con un env simulado.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let worker;
const env = { WATCH_REGION: 'NI' }; // sin claves → degradación elegante

before(async () => {
  worker = (await import('../worker.mjs')).default;
});

const get = (path, options = {}) =>
  worker.fetch(new Request(`http://worker.local${path}`, options), env, {});

test('manifest: válido, con logo apuntando al Worker', async () => {
  const res = await get('/manifest.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const manifest = await res.json();
  assert.equal(manifest.id, 'org.comunidad.catalogos.plus');
  assert.equal(manifest.resources.includes('catalog'), true);
  assert.equal(manifest.catalogs.length >= 30, true);
  assert.equal(manifest.logo, 'http://worker.local/assets/logo.png');
});

test('logo: se sirve como image/png embebido', async () => {
  const res = await get('/assets/logo.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(buf[0], 0x89); // PNG magic
  assert.equal(buf[1], 0x50);
  assert.ok(buf.length > 5000, 'el logo pesa más de 5 KB');
});

test('healthz: reporta runtime cloudflare-workers', async () => {
  const res = await get('/healthz');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.runtime, 'cloudflare-workers');
  assert.equal(body.sources.tvmaze, true);
  assert.equal(body.sources.tmdb, false);
});

test('catalog: sin TMDB key devuelve metas=[] con 200', async () => {
  const res = await get('/catalog/movie/cine_top.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metas, []);
});

test('meta: id desconocido devuelve ficha mínima válida', async () => {
  const res = await get('/meta/movie/tt0111161.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meta.id, 'tt0111161');
  assert.ok(body.meta.name);
});

test('landing: HTML con botón de instalación', async () => {
  const res = await get('/', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Instalar en Stremio/);
});

test('meta: id tvdb explícito con clave dummy devuelve ficha válida (sin red)', async () => {
  const envTvdb = { ...env, TVDB_API_KEY: 'dummy-key-inexistente' };
  const res = await worker.fetch(
    new Request('http://worker.local/meta/series/tvdb:series:121361.json'),
    envTvdb,
    {}
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meta.id, 'tvdb:series:121361');
  assert.ok(body.meta.name);
});

test('preflight OPTIONS: 204 con CORS', async () => {
  const res = await get('/manifest.json', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('404: ruta inexistente en JSON', async () => {
  const res = await get('/no-existe');
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found');
});
