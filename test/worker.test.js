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
  assert.match(html, /Tendencias/);
  assert.match(html, /Explorar por/);
  assert.match(html, /Instalar en Stremio/);
  assert.match(html, /image\.tmdb\.org/);
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
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
});

test('TorBox conecta por POST, cifra la clave en KV y permite desconectarla', async () => {
  const originalFetch = global.fetch;
  const kvEntries = new Map();
  const envDebrid = {
    ...env,
    DEBRID_ENCRYPTION_KEY: 'worker-test-encryption-key-at-least-32-chars',
    DEBRID_KV: {
      async get(key) { return kvEntries.get(key) ?? null; },
      async put(key, value) { kvEntries.set(key, value); },
      async delete(key) { kvEntries.delete(key); },
    },
  };
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v1/api/user/me');
    assert.equal(url.searchParams.get('settings'), 'false');
    assert.equal(options.headers.Authorization, 'Bearer worker-test-api-secret');
    assert.equal(url.href.includes('worker-test-api-secret'), false);
    return new Response(JSON.stringify({ success: true, data: { email: 'test@example.net' } }), { status: 200 });
  };
  try {
    const connected = await worker.fetch(new Request('https://addon.example/internal/debrid/connect', {
      method: 'POST',
      headers: { Origin: 'https://addon.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'torbox', token: 'worker-test-api-secret' }),
    }), envDebrid, {});
    assert.equal(connected.status, 200);
    assert.equal(connected.headers.get('cache-control'), 'no-store');
    const body = await connected.json();
    assert.match(body.credentialId, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(body.provider, 'torbox');
    assert.equal(JSON.stringify(body).includes('worker-test-api-secret'), false);
    const [encrypted] = [...kvEntries.values()];
    assert.match(encrypted, /^v3\./);
    assert.equal(encrypted.includes('worker-test-api-secret'), false);

    const disconnected = await worker.fetch(new Request('https://addon.example/internal/debrid/connect', {
      method: 'DELETE',
      headers: { Origin: 'https://addon.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: body.credentialId }),
    }), envDebrid, {});
    assert.equal(disconnected.status, 200);
    assert.equal(kvEntries.size, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Real-Debrid rechaza el token privado pegado y exige OAuth', async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('no debe contactar Real-Debrid'); };
  try {
    const response = await worker.fetch(new Request('https://addon.example/internal/debrid/connect', {
      method: 'POST',
      headers: { Origin: 'https://addon.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'realdebrid', token: 'private-api-token' }),
    }), {}, {});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'oauth_required');
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Real-Debrid OAuth usa state/cookie, intercambia el código server-side y guarda tokens cifrados', async () => {
  const originalFetch = global.fetch;
  const kvEntries = new Map();
  const envOAuth = {
    ...env,
    DEBRID_ENCRYPTION_KEY: 'worker-oauth-encryption-key-at-least-32-chars',
    DEBRID_KV: {
      async get(key) { return kvEntries.get(key) ?? null; },
      async put(key, value) { kvEntries.set(key, value); },
      async delete(key) { kvEntries.delete(key); },
    },
    REALDEBRID_CLIENT_ID: 'worker-rd-client',
    REALDEBRID_CLIENT_SECRET: 'worker-rd-client-secret',
    REALDEBRID_REDIRECT_URI: 'https://addon.example/internal/debrid/real-debrid/callback',
  };
  const authorization = await worker.fetch(new Request('https://addon.example/internal/debrid/real-debrid/authorize'), envOAuth, {});
  assert.equal(authorization.status, 302);
  assert.equal(authorization.headers.get('cache-control'), 'no-store');
  assert.equal(authorization.headers.get('referrer-policy'), 'no-referrer');
  const authorizeUrl = new URL(authorization.headers.get('location'));
  assert.equal(authorizeUrl.origin, 'https://api.real-debrid.com');
  assert.equal(authorizeUrl.pathname, '/oauth/v2/auth');
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'worker-rd-client');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), envOAuth.REALDEBRID_REDIRECT_URI);
  const state = authorizeUrl.searchParams.get('state');
  const cookie = authorization.headers.get('set-cookie').split(';', 1)[0];
  assert.equal(cookie, `rd_oauth_state=${state}`);

  let exchangeCalls = 0;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    exchangeCalls++;
    if (url.pathname === '/oauth/v2/token') {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('client_id'), 'worker-rd-client');
      assert.equal(form.get('client_secret'), 'worker-rd-client-secret');
      assert.equal(form.get('code'), 'one-time-code');
      assert.equal(form.get('redirect_uri'), envOAuth.REALDEBRID_REDIRECT_URI);
      return new Response(JSON.stringify({ access_token: 'worker-access-secret', refresh_token: 'worker-refresh-secret', expires_in: 3600 }), { status: 200 });
    }
    assert.equal(url.pathname, '/rest/1.0/user');
    assert.equal(options.headers.Authorization, 'Bearer worker-access-secret');
    return new Response(JSON.stringify({ id: 88, username: 'worker-test' }), { status: 200 });
  };
  try {
    const rejected = await worker.fetch(new Request(`https://addon.example/internal/debrid/real-debrid/callback?code=one-time-code&state=wrong-state`), envOAuth, {});
    assert.equal(rejected.status, 302);
    assert.match(rejected.headers.get('location'), /debrid_error=oauth_failed/);
    assert.equal(exchangeCalls, 0);

    const callback = await worker.fetch(new Request(`https://addon.example/internal/debrid/real-debrid/callback?code=one-time-code&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: cookie },
    }), envOAuth, {});
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('cache-control'), 'no-store');
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
    assert.match(callback.headers.get('set-cookie'), /Max-Age=0/);
    const destination = new URL(callback.headers.get('location'));
    assert.equal(destination.pathname, '/configure');
    const credentialId = destination.searchParams.get('debrid_credential');
    assert.match(credentialId, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(destination.href.includes('one-time-code'), false);
    assert.equal(destination.href.includes('worker-access-secret'), false);
    assert.equal(exchangeCalls, 2);
    const encrypted = [...kvEntries.values()][0];
    assert.match(encrypted, /^v3\./);
    assert.equal(encrypted.includes('worker-access-secret'), false);
    assert.equal(encrypted.includes('worker-refresh-secret'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Real-Debrid no inicia OAuth si falta almacenamiento cifrado', async () => {
  const response = await worker.fetch(new Request('https://addon.example/internal/debrid/real-debrid/authorize'), {
    ...env,
    DEBRID_ENCRYPTION_KEY: 'oauth-storage-test-key-at-least-32-chars',
    REALDEBRID_CLIENT_ID: 'worker-client',
    REALDEBRID_CLIENT_SECRET: 'worker-client-secret',
    REALDEBRID_REDIRECT_URI: 'https://addon.example/internal/debrid/real-debrid/callback',
  }, {});
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /debrid_error=storage_not_configured/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('debrid connect rechaza cross-origin, exige almacenamiento y limita intentos por IP', async () => {
  const crossOrigin = await worker.fetch(new Request('https://addon.example/internal/debrid/connect', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'torbox', token: 'not-used' }),
  }), {}, {});
  assert.equal(crossOrigin.status, 403);

  const missingOrigin = await worker.fetch(new Request('https://addon.example/internal/debrid/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'torbox', token: 'not-used' }),
  }), {}, {});
  assert.equal(missingOrigin.status, 403);

  const notConfigured = await worker.fetch(new Request('https://addon.example/internal/debrid/connect', {
    method: 'POST',
    headers: { Origin: 'https://addon.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'torbox', token: 'not-used' }),
  }), { DEBRID_ENCRYPTION_KEY: 'test-encryption-key-is-long-enough-123' }, {});
  assert.equal(notConfigured.status, 503);

  const request = () => new Request('https://addon.example/internal/debrid/connect', {
    method: 'POST',
    headers: {
      Origin: 'https://addon.example',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.188',
    },
    body: JSON.stringify({ provider: 'torbox', token: 'not-used' }),
  });
  let last;
  for (let i = 0; i < 8; i++) last = await worker.fetch(request(), {}, {});
  assert.equal(last.status, 503);
  const limited = await worker.fetch(request(), {}, {});
  assert.equal(limited.status, 429);
});

test('cache endpoint: solo expone métricas agregadas', async () => {
  const res = await get('/internal/cache.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const stats = await res.json();
  assert.equal(typeof stats.entries, 'number');
  assert.equal(typeof stats.maxEntries, 'number');
  assert.equal(Object.hasOwn(stats, 'keys'), false);
});

test('Worker usa Cache API compartida para rutas públicas', async () => {
  const originalCaches = globalThis.caches;
  const entries = new Map();
  let matches = 0;
  let puts = 0;
  globalThis.caches = { default: {
    async match(request) { matches++; return entries.get(request.url)?.clone() || undefined; },
    async put(request, response) { puts++; entries.set(request.url, response.clone()); },
  } };
  try {
    const first = await worker.fetch(new Request('https://cache.example/manifest.json'), env, {});
    const second = await worker.fetch(new Request('https://cache.example/manifest.json'), env, {});
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(matches, 2);
    assert.equal(puts, 1);
    assert.equal((await second.json()).id, 'org.comunidad.catalogos.plus');
  } finally {
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('404: ruta inexistente en JSON', async () => {
  const res = await get('/no-existe');
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not_found');
});

test('configure: página con plataformas, estudios, idioma y región', async () => {
  const res = await get('/configure', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Plataformas/);
  assert.match(html, /Hulu/);
  assert.match(html, /AMC\+/);
  assert.match(html, /Idioma/);
  assert.match(html, /Región/);
  assert.match(html, /Instalar en Stremio/);
});

test('branding: sin TMDB devuelve objetos vacíos sin romper', async () => {
  const res = await get('/internal/branding.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.providers && typeof body.providers === 'object');
  assert.ok(body.studios && typeof body.studios === 'object');
});

test('manifest personal: filtra catálogos según config', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es-MX', region: 'MX', platforms: ['netflix'], studios: ['marvel'], base: ['tendencias'] })
  ).toString('base64url');
  const res = await get('/' + cfg + '/manifest.json');
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.name, 'Catálogos+ · MX');
  const ids = manifest.catalogs.map((c) => c.id).sort();
  assert.deepEqual(ids, [
    'cine_estudio_marvel', 'cine_netflix', 'cine_tendencias',
    'tv_estudio_marvel', 'tv_netflix', 'tv_tendencias',
  ]);
  assert.equal(manifest.behaviorHints.configurable, true);
});

test('catalog deshabilitado por config: lista vacía aunque el catálogo exista', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es', region: 'MX', platforms: [], studios: [], base: ['tendencias'] })
  ).toString('base64url');
  const res = await get('/' + cfg + '/catalog/movie/cine_netflix.json');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.metas, []);
});

test('configure con config: /<cfg>/configure abre con la región del usuario cargada', async () => {
  const cfg = Buffer.from(
    JSON.stringify({ lang: 'es', region: 'MX', platforms: ['netflix'], studios: [], base: ['tendencias'], streams: ['knaben'] })
  ).toString('base64url');
  const res = await get('/' + cfg + '/configure', { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /"region":"MX"/); // INITIAL precargado en la página
  assert.match(html, /Región de plataformas/);
});

test('config inválida: 404 invalid_config', async () => {
  const res = await get('/bm90LWpzb24/manifest.json'); // base64url de "not-json"
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'invalid_config');
});

test('manifest personal con config larga (~600 chars) responde 200 (no 404)', async () => {
  const userConfig = require('../lib/userConfig');
  const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');
  const streams = require('../lib/streams');
  const cfg = userConfig.encodeConfig({
    lang: 'es',
    region: 'MX',
    platforms: PLATFORM_KEYS,
    studios: STUDIO_KEYS,
    base: userConfig.BASE_KEYS,
    streams: streams.PROVIDER_KEYS,
  });
  assert.ok(cfg.length > 512, `el segmento mide ${cfg.length} caracteres`);

  const res = await get('/' + cfg + '/manifest.json');
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.name, 'Catálogos+ · MX');
  assert.equal(manifest.resources.includes('stream'), true);
  assert.ok(manifest.catalogs.length > 40);

  // La misma config debe servir catálogos (sin TMDB: lista vacía, pero 200)
  const cat = await get('/' + cfg + '/catalog/movie/cine_tendencias.json');
  assert.equal(cat.status, 200);
});

test('catálogos paginados: Worker acepta extra skip en la ruta de Stremio', async () => {
  const core = require('../lib/core');
  const original = core.handleCatalog;
  try {
    core.handleCatalog = async (type, id, cfg, extra) => {
      assert.equal(type, 'series');
      assert.equal(id, 'tv_anime');
      assert.equal(extra.skip, '20');
      return { metas: [], cacheMaxAge: 0 };
    };
    const response = await get('/catalog/series/tv_anime/skip=20.json');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).metas, []);
  } finally { core.handleCatalog = original; }
});
