'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const userConfig = require('../lib/userConfig');

let app;
let server;
let origin;
let originalFetch;
let originalEnv = {};
const envNames = [
  'NODE_ENV', 'VERCEL', 'DEBRID_ENCRYPTION_KEY',
  'REALDEBRID_CLIENT_ID', 'REALDEBRID_CLIENT_SECRET', 'REALDEBRID_REDIRECT_URI',
];

before(async () => {
  originalFetch = global.fetch;
  for (const name of envNames) originalEnv[name] = process.env[name];
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;
  process.env.DEBRID_ENCRYPTION_KEY = 'node-api-test-encryption-key-at-least-32-chars';
  app = require('../api/index');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  global.fetch = originalFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${origin}${path}`, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
        json() { return JSON.parse(this.text || '{}'); },
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('API Express valida una clave de proveedor, solo devuelve id opaco y permite desconectar', async () => {
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'api.torbox.app');
    assert.equal(url.pathname, '/v1/api/user/me');
    assert.equal(options.headers.Authorization, 'Bearer api-route-secret');
    assert.equal(url.href.includes('api-route-secret'), false);
    return new Response(JSON.stringify({ success: true, data: { email: 'api-test@example.net' } }), { status: 200 });
  };

  const connected = await request('/internal/debrid/connect', {
    method: 'POST',
    headers: { Origin: origin },
    body: { provider: 'torbox', token: 'api-route-secret' },
  });
  assert.equal(connected.status, 200);
  assert.equal(connected.headers['cache-control'], 'no-store');
  const result = connected.json();
  assert.equal(result.provider, 'torbox');
  assert.match(result.credentialId, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(connected.text.includes('api-route-secret'), false);

  const personalConfig = userConfig.encodeConfig({
    lang: 'es', region: 'NI', debridId: result.credentialId, debridProvider: 'torbox',
  });
  const manifest = await request(`/${personalConfig}/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers['cache-control'], 'no-store');

  const disconnected = await request('/internal/debrid/connect', {
    method: 'DELETE',
    headers: { Origin: origin },
    body: { credentialId: result.credentialId },
  });
  assert.equal(disconnected.status, 200);
  assert.deepEqual(disconnected.json(), { ok: true });
});

test('API Express bloquea token privado RD y rechaza conexiones cross-origin', async () => {
  let providerCalled = false;
  global.fetch = async () => { providerCalled = true; throw new Error('no debe llamar al proveedor'); };
  const rd = await request('/internal/debrid/connect', {
    method: 'POST',
    headers: { Origin: origin },
    body: { provider: 'realdebrid', token: 'private-rd-api-token' },
  });
  assert.equal(rd.status, 400);
  assert.equal(rd.json().error, 'oauth_required');
  assert.equal(providerCalled, false);

  const crossOrigin = await request('/internal/debrid/connect', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
    body: { provider: 'torbox', token: 'not-used' },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.json().error, 'origin_not_allowed');

  const missingOrigin = await request('/internal/debrid/connect', {
    method: 'POST',
    body: { provider: 'torbox', token: 'not-used' },
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.json().error, 'origin_not_allowed');
});

test('API Express completa Real-Debrid OAuth con cookie state y no filtra el código', async () => {
  process.env.REALDEBRID_CLIENT_ID = 'api-rd-client';
  process.env.REALDEBRID_CLIENT_SECRET = 'api-rd-client-secret';
  process.env.REALDEBRID_REDIRECT_URI = `${origin}/internal/debrid/real-debrid/callback`;

  const authorization = await request('/internal/debrid/real-debrid/authorize');
  assert.equal(authorization.status, 302);
  assert.equal(authorization.headers['cache-control'], 'no-store');
  const authUrl = new URL(authorization.headers.location);
  assert.equal(authUrl.origin, 'https://api.real-debrid.com');
  assert.equal(authUrl.pathname, '/oauth/v2/auth');
  assert.equal(authUrl.searchParams.get('client_id'), 'api-rd-client');
  assert.equal(authUrl.searchParams.get('redirect_uri'), process.env.REALDEBRID_REDIRECT_URI);
  const state = authUrl.searchParams.get('state');
  const cookie = authorization.headers['set-cookie'][0].split(';', 1)[0];
  assert.equal(cookie, `rd_oauth_state=${state}`);

  const originalCalls = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    originalCalls.push(url.pathname);
    if (url.pathname === '/oauth/v2/token') {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'api-one-time-code');
      return new Response(JSON.stringify({ access_token: 'api-access-secret', refresh_token: 'api-refresh-secret', expires_in: 3600 }), { status: 200 });
    }
    assert.equal(url.pathname, '/rest/1.0/user');
    assert.equal(options.headers.Authorization, 'Bearer api-access-secret');
    return new Response(JSON.stringify({ id: 900, username: 'api-test' }), { status: 200 });
  };

  const callback = await request(`/internal/debrid/real-debrid/callback?code=api-one-time-code&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers['cache-control'], 'no-store');
  assert.equal(callback.headers['referrer-policy'], 'no-referrer');
  assert.match(callback.headers['set-cookie'][0], /Max-Age=0/);
  const destination = new URL(callback.headers.location);
  assert.equal(destination.pathname, '/configure');
  assert.match(destination.searchParams.get('debrid_credential'), /^[A-Za-z0-9_-]{32}$/);
  assert.equal(destination.href.includes('api-one-time-code'), false);
  assert.deepEqual(originalCalls, ['/oauth/v2/token', '/rest/1.0/user']);
});
