'use strict';

/**
 * Smoke tests offline (no requieren claves ni red externa):
 *  - El manifest cumple el contrato de Stremio y no tiene catálogos duplicados.
 *  - Endpoints HTTP: /healthz, /manifest.json, /catalog/..., /meta/..., 404.
 *  - Sin TMDB_API_KEY, los catálogos TMDB devuelven 200 con metas=[] y no crashean.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Forzar entorno sin claves para que las pruebas sean deterministas
delete process.env.TMDB_API_KEY;
delete process.env.TMDB_ACCESS_TOKEN;
delete process.env.OMDB_API_KEY;

let server;
let baseUrl;

before(async () => {
  const app = require('../api/index');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

test('manifest: contrato Stremio válido', async () => {
  const res = await fetch(`${baseUrl}/manifest.json`);
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.id, 'net.ramdonlatam.catalogos');
  assert.ok(manifest.name);
  assert.ok(Array.isArray(manifest.resources));
  assert.ok(manifest.resources.includes('catalog'));
  assert.ok(manifest.resources.includes('meta'));
  assert.ok(Array.isArray(manifest.types));
  assert.ok(Array.isArray(manifest.catalogs));
  assert.ok(manifest.catalogs.length >= 15, 'debe declarar múltiples catálogos');
  const ids = manifest.catalogs.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'no debe haber catálogos duplicados');
  for (const catalog of manifest.catalogs) {
    assert.ok(catalog.name && catalog.type && catalog.id, 'cada catálogo lleva id, type y name');
    assert.ok(['movie', 'series'].includes(catalog.type));
  }
  assert.ok(ids.includes('cine_top') && ids.includes('tv_top'));
  assert.ok(ids.includes('cine_netflix') && ids.includes('tv_netflix'));
  assert.ok(ids.includes('cine_estudio_marvel'));
  assert.ok(ids.includes('tvmaze_hoy'));
});

test('healthz: reporta estado de fuentes', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.sources.tmdb, 'boolean');
  assert.equal(body.sources.tvmaze, true);
  assert.ok(body.catalogs > 0);
});

test('catalog: sin TMDB key devuelve 200 con metas=[] (no crashea)', async () => {
  for (const path of [
    '/catalog/movie/cine_popular.json',
    '/catalog/movie/cine_top.json',
    '/catalog/series/tv_top.json',
    '/catalog/movie/cine_netflix.json',
    '/catalog/movie/cine_estudio_marvel.json',
  ]) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 200, path);
    const body = await res.json();
    assert.ok(Array.isArray(body.metas), path);
    assert.equal(body.metas.length, 0, path);
  }
});

test('catalog: id desconocido devuelve lista vacía', async () => {
  const res = await fetch(`${baseUrl}/catalog/movie/no_existe.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metas, []);
});

test('meta: sin claves devuelve ficha mínima válida', async () => {
  const res = await fetch(`${baseUrl}/meta/movie/tt0111161.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.meta && typeof body.meta === 'object');
  assert.equal(body.meta.id, 'tt0111161');
  assert.equal(body.meta.type, 'movie');
  assert.ok(body.meta.name);
});

test('404: ruta inexistente', async () => {
  const res = await fetch(`${baseUrl}/ruta-inexistente`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found');
});

test('landing: renderiza HTML con el nombre del addon', async () => {
  const res = await fetch(`${baseUrl}/`, { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Addon de Stremio/);
  assert.match(html, /Tendencias/);
  assert.match(html, /Explorar por/);
  assert.match(html, /Instalar en Stremio/);
  assert.match(html, /image\.tmdb\.org/);
});

test('configure: 200 HTML con plataformas y estudios', async () => {
  const res = await fetch(`${baseUrl}/configure`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Plataformas/);
  assert.match(html, /AMC\+/);
  assert.match(html, /Hulu/);
});

test('manifest personal: filtra catálogos según config (Express)', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es-MX', region: 'MX', platforms: ['netflix'], studios: [], base: ['tendencias'] })
  ).toString('base64url');
  const res = await fetch(`${baseUrl}/${cfg}/manifest.json`);
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.catalogs.length, 4);
  assert.equal(manifest.name, 'RamdonLatam · MX');
});

test('config inválida: 404 (Express)', async () => {
  const res = await fetch(`${baseUrl}/bm90LWpzb24/manifest.json`);
  assert.equal(res.status, 404);
});
