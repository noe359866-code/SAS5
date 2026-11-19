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
  'NODE_ENV', 'VERCEL',
];

before(async () => {
  originalFetch = global.fetch;
  for (const name of envNames) originalEnv[name] = process.env[name];
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;
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

test('API Express: healthz solo anuncia las fuentes vigentes', async (t) => {
  const config = require('../lib/config');
  t.after(() => config.reload());
  config.reload({ STREAM_PROVIDERS: 'playlatin,spinflix' });
  const response = await request('/healthz');
  assert.equal(response.status, 200);
  const body = response.json();
  assert.deepEqual(body.streamProviders, ['spinflix']);
  assert.deepEqual(body.sources, { tmdb: false, tvmaze: true, omdb: false, fanpelis: false, spinflix: true, gnulahd: false, videoapp: false, pelisplus: false, tubeonline: false, mirandogratis: false, gnulaone: false, ultra: false, cuevanas3: false, animeflv: false, fuegocine: false });
});

test('API Express entrega extras de paginación para catálogos personales', async () => {
  const core = require('../lib/core');
  const original = core.handleCatalog;
  const cfg = userConfig.encodeConfig({ lang: 'es', region: 'NI' });
  try {
    core.handleCatalog = async (type, id, decoded, extra) => {
      assert.equal(type, 'series');
      assert.equal(id, 'tv_anime');
      assert.equal(extra.skip, '40');
      return { metas: [], cacheMaxAge: 0 };
    };
    const response = await request(`/${cfg}/catalog/series/tv_anime/skip=40.json`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json().metas, []);
  } finally { core.handleCatalog = original; }
});
