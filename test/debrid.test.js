'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');
const cache = require('../lib/cache');
const credentials = require('../lib/debridCredentials');
const debridShared = require('../lib/debridShared');
const providers = require('../lib/debridProviders');
const debridStreams = require('../lib/debridStreams');
const realDebrid = require('../lib/realDebrid');
const realDebridOAuth = require('../lib/realDebridOAuth');
const userConfig = require('../lib/userConfig');
const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');
const streams = require('../lib/streams');

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
  config.reload(null);
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function makeKv() {
  const entries = new Map();
  return {
    entries,
    async get(key) { return entries.get(key) ?? null; },
    async put(key, value) { entries.set(key, value); },
    async delete(key) { entries.delete(key); },
  };
}
function makeEnv(extra = {}) {
  return {
    DEBRID_ENCRYPTION_KEY: 'test-only-encryption-secret-at-least-32-chars',
    DEBRID_KV: makeKv(),
    ...extra,
  };
}
function hit(hash, title = 'Test Movie 1080p') {
  return {
    infoHash: hash,
    title,
    sources: [],
    magnet: `magnet:?xt=urn:btih:${hash}`,
    seeders: 100,
    size: 2_000_000_000,
  };
}

const rdEnv = () => makeEnv({
  REALDEBRID_CLIENT_ID: 'rd-app-id',
  REALDEBRID_CLIENT_SECRET: 'rd-app-client-secret',
  REALDEBRID_REDIRECT_URI: 'https://addon.example/internal/debrid/real-debrid/callback',
});

test('el vault cifra registros por proveedor y nunca vuelve a leer el token privado legado de RD', async () => {
  const env = makeEnv();
  const { credentialId, provider } = await credentials.createCredential({ provider: 'torbox', token: 'torbox-api-secret' }, env);
  assert.equal(provider, 'torbox');
  assert.match(credentialId, /^[A-Za-z0-9_-]{32}$/);
  const [stored] = [...env.DEBRID_KV.entries.values()];
  assert.match(stored, /^v3\./);
  assert.equal(stored.includes('torbox-api-secret'), false);
  const swappedId = 'R'.repeat(32);
  env.DEBRID_KV.entries.set(`debrid:v2:credential:${swappedId}`, stored);
  assert.equal(await credentials.getCredential(swappedId, env), null, 'el ciphertext no se puede mover a otra credencial');
  env.DEBRID_KV.entries.delete(`debrid:v2:credential:${swappedId}`);
  assert.deepEqual(await credentials.getCredential(credentialId, env), {
    version: 2,
    provider: 'torbox',
    token: 'torbox-api-secret',
  });

  // Las referencias antiguas no se consultan ni se interpretan como OAuth.
  const legacyId = 'L'.repeat(32);
  env.DEBRID_KV.entries.set(`rd:credential:${legacyId}`, 'v1.legacy.private-token-ciphertext');
  assert.equal(await credentials.getCredential(legacyId, env), null);

  assert.equal(await credentials.disconnect(credentialId, env), true);
  assert.equal(await credentials.getCredential(credentialId, env), null);
  assert.equal(env.DEBRID_KV.entries.size, 1, 'solo se mantiene una clave histórica ajena al lector nuevo');
});

test('credenciales TorBox, EasyDebrid y Premiumize se validan por Bearer y no por URL', async () => {
  const calls = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer provider-api-secret');
    assert.equal(url.href.includes('provider-api-secret'), false);
    if (url.hostname === 'api.torbox.app') return json({ success: true, data: { email: 'test@example.net' } });
    if (url.hostname === 'easydebrid.com') return json({ id: 123, paid_until: '2030-01-01' });
    if (url.hostname === 'www.premiumize.me') return json({ status: 'success', customer_id: '123', premium_until: 1 });
    throw new Error(`host inesperado ${url.hostname}`);
  };
  for (const provider of ['torbox', 'easydebrid', 'premiumize']) {
    const result = await providers.validateCredential(provider, 'provider-api-secret');
    assert.equal(result.provider, provider);
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.some((call) => call.url.pathname.endsWith('/user/me')));
  assert.ok(calls.some((call) => call.url.pathname.endsWith('/user/details')));
  assert.ok(calls.some((call) => call.url.pathname.endsWith('/account/info')));
});

test('Real-Debrid rechaza claves pegadas y construye OAuth con state ligado a cookie', () => {
  const env = rdEnv();
  const authorization = realDebridOAuth.makeAuthorization({ origin: 'https://addon.example', env });
  const url = new URL(authorization.authorizationUrl);
  assert.equal(url.origin, 'https://api.real-debrid.com');
  assert.equal(url.pathname, '/oauth/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'rd-app-id');
  assert.equal(url.searchParams.get('redirect_uri'), env.REALDEBRID_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), authorization.state);
  assert.equal(realDebridOAuth.verifyState(authorization.state, `rd_oauth_state=${authorization.state}`), true);
  assert.equal(realDebridOAuth.verifyState('wrong-state', `rd_oauth_state=${authorization.state}`), false);
  assert.throws(() => realDebridOAuth.makeAuthorization({ origin: 'https://attacker.example', env }), { code: 'realdebrid_oauth_redirect_invalid' });
  assert.throws(() => realDebridOAuth.oauthConfig({
    ...env,
    REALDEBRID_REDIRECT_URI: 'https://user:pass@addon.example/internal/debrid/real-debrid/callback',
  }), { code: 'realdebrid_oauth_redirect_invalid' });
});

test('Real-Debrid OAuth intercambia el código server-side, valida la cuenta y cifra access/refresh tokens', async () => {
  const env = rdEnv();
  const calls = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.pathname === '/oauth/v2/token') {
      assert.equal(options.method, 'POST');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_id'), 'rd-app-id');
      assert.equal(body.get('client_secret'), 'rd-app-client-secret');
      assert.equal(body.get('code'), 'rd-one-time-code');
      assert.equal(body.get('redirect_uri'), env.REALDEBRID_REDIRECT_URI);
      return json({ access_token: 'rd-access-secret', refresh_token: 'rd-refresh-secret', expires_in: 3600 });
    }
    assert.equal(url.pathname, '/rest/1.0/user');
    assert.equal(options.headers.Authorization, 'Bearer rd-access-secret');
    return json({ id: 42, username: 'test-account' });
  };

  const connected = await realDebridOAuth.completeAuthorization('rd-one-time-code', env);
  const record = await credentials.getCredential(connected.credentialId, env);
  assert.equal(record.provider, 'realdebrid');
  assert.equal(record.accessToken, 'rd-access-secret');
  assert.equal(record.refreshToken, 'rd-refresh-secret');
  const encrypted = [...env.DEBRID_KV.entries.values()][0];
  assert.equal(encrypted.includes('rd-access-secret'), false);
  assert.equal(encrypted.includes('rd-refresh-secret'), false);
  assert.equal(calls.length, 2);
});

test('Real-Debrid OAuth renueva con el grant documentado y guarda el token rotado', async () => {
  const env = rdEnv();
  const { credentialId } = await credentials.createCredential({
    provider: 'realdebrid',
    accessToken: 'expired-access',
    refreshToken: 'old-refresh',
    expiresAt: Date.now() - 1,
  }, env);
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/oauth/v2/token');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'), 'http://oauth.net/grant_type/device/1.0');
    assert.equal(body.get('code'), 'old-refresh');
    assert.equal(body.get('client_id'), 'rd-app-id');
    assert.equal(body.get('client_secret'), 'rd-app-client-secret');
    return json({ access_token: 'fresh-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
  };
  assert.equal(await realDebridOAuth.getAccessToken(credentialId, env), 'fresh-access');
  const record = await credentials.getCredential(credentialId, env);
  assert.equal(record.accessToken, 'fresh-access');
  assert.equal(record.refreshToken, 'rotated-refresh');
  assert.ok(record.expiresAt > Date.now());
});

test('TorBox devuelve link solo con cache hit, y usa add_only_if_cached y requestdl privado', async () => {
  const env = makeEnv();
  const hash = 'a'.repeat(40);
  const { credentialId } = await credentials.createCredential({ provider: 'torbox', token: 'tb-private-key' }, env);
  const calls = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.pathname.endsWith('/torrents/checkcached')) {
      assert.equal(options.headers.Authorization, 'Bearer tb-private-key');
      return json({ success: true, data: { [hash]: { hash, files: [{ id: 9, name: 'Dune.2021.1080p.mkv', size: 2100000000 }] } } });
    }
    if (url.pathname.endsWith('/torrents/mylist') && !url.searchParams.has('id')) {
      return json({ success: true, data: [] });
    }
    if (url.pathname.endsWith('/torrents/createtorrent')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('add_only_if_cached'), 'true');
      // TorBox documenta seed como 1=auto, 2=sembrar, 3=no sembrar.
      assert.equal(options.body.get('seed'), '3', 'el addon no debe sembrar contenido');
      assert.match(options.body.get('magnet'), /urn%3Abtih%3A|urn:btih:/);
      return json({ success: true, data: { torrent_id: 77 } });
    }
    if (url.pathname.endsWith('/torrents/mylist') && url.searchParams.get('id') === '77') {
      return json({ success: true, data: { id: 77, hash, files: [{ id: 9, name: 'Dune.2021.1080p.mkv', size: 2100000000 }] } });
    }
    if (url.pathname.endsWith('/torrents/requestdl')) {
      assert.equal(url.searchParams.get('token'), 'tb-private-key');
      assert.equal(url.searchParams.get('torrent_id'), '77');
      assert.equal(url.searchParams.get('file_id'), '9');
      return json({ success: true, data: 'https://download.torbox.example/dune.mkv' });
    }
    throw new Error(`ruta TorBox inesperada ${url.pathname}`);
  };

  const result = await debridStreams.streamsFor([hit(hash, 'Dune 2021')], credentialId, { mediaType: 'movie' }, env);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '⚡ TorBox');
  assert.equal(result[0].url, 'https://download.torbox.example/dune.mkv');
  assert.equal(calls.some((call) => call.url.pathname.endsWith('/torrents/instantAvailability/')), false);
  assert.equal(calls.some((call) => call.url.href.includes('tb-private-key')), true, 'la key solo aparece en la llamada requestdl requerida por TorBox');
});

test('TorBox no crea torrents ante misses del cache-check', async () => {
  const env = makeEnv();
  const hash = 'b'.repeat(40);
  const { credentialId } = await credentials.createCredential({ provider: 'torbox', token: 'tb-test-key' }, env);
  let creates = 0;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/torrents/checkcached')) return json({ success: true, data: {} });
    if (url.pathname.endsWith('/torrents/createtorrent')) creates++;
    throw new Error(`No se esperaba ${url.pathname}`);
  };
  const result = await debridStreams.streamsFor([hit(hash)], credentialId, { mediaType: 'movie' }, env);
  assert.deepEqual(result, []);
  assert.equal(creates, 0);
});

test('EasyDebrid solo genera enlaces después de lookupdetails positivo', async () => {
  const env = makeEnv();
  const missHash = 'c'.repeat(40);
  const missCredential = await credentials.createCredential({ provider: 'easydebrid', token: 'ed-miss-key' }, env);
  let missGenerates = 0;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/link/lookupdetails')) return json({ result: [{ cached: false, files: [] }] });
    if (url.pathname.endsWith('/link/generate')) missGenerates++;
    throw new Error(`No se esperaba ${url.pathname}`);
  };
  assert.deepEqual(await debridStreams.streamsFor([hit(missHash)], missCredential.credentialId, { mediaType: 'movie' }, env), []);
  assert.equal(missGenerates, 0);

  const hitHash = 'd'.repeat(40);
  const hitCredential = await credentials.createCredential({ provider: 'easydebrid', token: 'ed-hit-key' }, env);
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(options.headers.Authorization, 'Bearer ed-hit-key');
    if (url.pathname.endsWith('/link/lookupdetails')) return json({ result: [{ cached: true, files: [{ name: 'Film.mkv', size: 1000 }] }] });
    if (url.pathname.endsWith('/link/generate')) {
      assert.deepEqual(JSON.parse(options.body), { url: debridShared.buildMagnet(hit(hitHash)) });
      return json({ files: [
        { filename: 'Film.mkv', directory: ['Movie'], size: 1000, url: 'https://download.easydebrid.example/film.mkv' },
        { filename: 'poster.jpg', directory: ['Movie'], size: 100, url: 'https://download.easydebrid.example/poster.jpg' },
      ] });
    }
    throw new Error(`ruta EasyDebrid inesperada ${url.pathname}`);
  };
  const direct = await debridStreams.streamsFor([hit(hitHash)], hitCredential.credentialId, { mediaType: 'movie' }, env);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].name, '⚡ EasyDebrid');
  assert.equal(direct[0].behaviorHints.filename, 'Film.mkv');
});

test('Premiumize usa cache/check antes de directdl y manda la clave solo como Bearer', async () => {
  const env = makeEnv();
  const missHash = 'e'.repeat(40);
  const missCredential = await credentials.createCredential({ provider: 'premiumize', token: 'pm-miss-key' }, env);
  let missDirectDl = 0;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(options.headers.Authorization, 'Bearer pm-miss-key');
    assert.equal(url.href.includes('pm-miss-key'), false);
    if (url.pathname.endsWith('/cache/check')) {
      assert.equal(options.method, 'POST');
      assert.match(String(options.body), /items%5B%5D=/);
      return json({ status: 'success', response: [false] });
    }
    if (url.pathname.endsWith('/transfer/directdl')) missDirectDl++;
    throw new Error(`No se esperaba ${url.pathname}`);
  };
  assert.deepEqual(await debridStreams.streamsFor([hit(missHash)], missCredential.credentialId, { mediaType: 'movie' }, env), []);
  assert.equal(missDirectDl, 0);

  const hitHash = 'f'.repeat(40);
  const hitCredential = await credentials.createCredential({ provider: 'premiumize', token: 'pm-hit-key' }, env);
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(options.headers.Authorization, 'Bearer pm-hit-key');
    assert.equal(url.href.includes('pm-hit-key'), false);
    if (url.pathname.endsWith('/cache/check')) return json({ status: 'success', response: [true] });
    if (url.pathname.endsWith('/transfer/directdl')) {
      assert.equal(new URLSearchParams(options.body).get('src'), debridShared.buildMagnet(hit(hitHash)));
      return json({ status: 'success', content: [
        { path: 'Movie/Feature.mkv', size: 10000, link: 'https://cdn.premiumize.example/feature.mkv' },
        { path: 'Movie/poster.png', size: 200, link: 'https://cdn.premiumize.example/poster.png' },
      ] });
    }
    throw new Error(`ruta Premiumize inesperada ${url.pathname}`);
  };
  const direct = await debridStreams.streamsFor([hit(hitHash)], hitCredential.credentialId, { mediaType: 'movie' }, env);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].name, '⚡ Premiumize');
  assert.equal(direct[0].behaviorHints.filename, 'Feature.mkv');
});

test('Real-Debrid resuelve solo la biblioteca personal y no añade ni comprueba cache global', async () => {
  const env = rdEnv();
  const hash = '1'.repeat(40);
  const { credentialId } = await credentials.createCredential({
    provider: 'realdebrid',
    accessToken: 'rd-oauth-access',
    refreshToken: 'rd-oauth-refresh',
    expiresAt: Date.now() + 3600_000,
  }, env);
  const calls = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer rd-oauth-access');
    assert.equal(url.href.includes('rd-oauth-access'), false);
    if (url.pathname === '/rest/1.0/torrents') {
      assert.equal(url.searchParams.get('limit'), '500');
      assert.equal(url.searchParams.get('page'), '1');
      return json([{ id: 'rd-torrent-9', hash, status: 'downloaded' }]);
    }
    if (url.pathname.endsWith('/torrents/info/rd-torrent-9')) {
      return json({
        status: 'downloaded',
        files: [
          { id: 1, path: 'notes.txt', selected: 0, bytes: 10 },
          { id: 2, path: 'Series.S01E02.mkv', selected: 1, bytes: 900 },
        ],
        links: ['https://real-debrid.example/selected-file'],
      });
    }
    if (url.pathname.endsWith('/unrestrict/link')) {
      assert.equal(options.method, 'POST');
      assert.match(options.body.get('link'), /selected-file/);
      return json({ download: 'https://download.real-debrid.example/episode.mkv' });
    }
    throw new Error(`ruta RD inesperada ${url.pathname}`);
  };
  const direct = await debridStreams.streamsFor([hit(hash)], credentialId, { mediaType: 'series', season: 1, episode: 2 }, env);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].name, '⚡ Real-Debrid');
  assert.equal(direct[0].url, 'https://download.real-debrid.example/episode.mkv');
  assert.equal(calls.some((call) => call.url.pathname.includes('instantAvailability')), false);
  assert.equal(calls.some((call) => call.url.pathname.endsWith('/torrents/addMagnet')), false);
  assert.equal(calls.some((call) => call.url.pathname.includes('/selectFiles/')), false);
  assert.equal(realDebrid.validateAccessToken instanceof Function, true);
});

test('Real-Debrid pagina la biblioteca y no reutiliza una lista parcial para hashes distintos', async () => {
  const env = rdEnv();
  const { credentialId } = await credentials.createCredential({
    provider: 'realdebrid', accessToken: 'rd-pages-access', refreshToken: 'rd-pages-refresh', expiresAt: Date.now() + 3600_000,
  }, env);
  const firstHash = 'a'.repeat(40);
  const secondHash = 'b'.repeat(40);
  const calls = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(options.headers.Authorization, 'Bearer rd-pages-access');
    assert.equal(url.searchParams.get('limit'), '500');
    calls.push({ page: Number(url.searchParams.get('page')), path: url.pathname });
    if (url.pathname === '/rest/1.0/torrents') {
      const page = Number(url.searchParams.get('page'));
      if (page === 1) {
        return json(Array.from({ length: 500 }, (_, index) => ({
          id: `filler-${index}`, hash: String(index + 1).padStart(40, '0'), status: 'downloaded',
        })));
      }
      if (page === 2 && calls.filter((call) => call.path === '/rest/1.0/torrents').length <= 2) {
        return json([{ id: 'rd-page-2-a', hash: firstHash, status: 'downloaded' }]);
      }
      return json([]);
    }
    throw new Error(`No se esperaba ${url.pathname}`);
  };

  const first = await realDebrid.checkCached('rd-pages-access', credentialId, [hit(firstHash)]);
  assert.equal(first.get(firstHash).id, 'rd-page-2-a', 'busca el hash más allá de la primera página');
  const second = await realDebrid.checkCached('rd-pages-access', credentialId, [hit(secondHash)]);
  assert.equal(second.get(secondHash), null, 'no reutiliza como completa la página parcial del otro batch');
  assert.deepEqual(calls.filter((call) => call.path === '/rest/1.0/torrents').map((call) => call.page), [1, 2, 1, 2]);
});

test('Real-Debrid no cachea misses cuando la paginación alcanza su tope defensivo', async () => {
  const hash = 'c'.repeat(40);
  const repeatedPage = Array.from({ length: 500 }, (_, index) => ({
    id: `large-library-${index}`, hash: String(index + 1).padStart(40, '0'), status: 'downloaded',
  }));
  const credentialId = 'P'.repeat(32);
  let listCalls = 0;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/1.0/torrents');
    assert.ok(Number(url.searchParams.get('page')) <= 20);
    listCalls++;
    return json(repeatedPage);
  };

  assert.equal((await realDebrid.checkCached('rd-access', credentialId, [hit(hash)])).get(hash), null);
  assert.equal(listCalls, 20);
  assert.equal((await realDebrid.checkCached('rd-access', credentialId, [hit(hash)])).get(hash), null);
  assert.equal(listCalls, 40, 'el miss parcial no se guarda como definitivo durante el TTL');
});

test('un hash ausente de la biblioteca RD no produce enlace directo', async () => {
  const env = rdEnv();
  const { credentialId } = await credentials.createCredential({
    provider: 'realdebrid', accessToken: 'rd-access', refreshToken: 'rd-refresh', expiresAt: Date.now() + 3600_000,
  }, env);
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/1.0/torrents') return json([{ id: 1, hash: 'not-the-hit', status: 'downloaded' }]);
    throw new Error(`No se esperaba ${url.pathname}`);
  };
  assert.deepEqual(await debridStreams.streamsFor([hit('2'.repeat(40))], credentialId, { mediaType: 'movie' }, env), []);
});

test('config serializa solo id opaco y el proveedor, nunca la clave API', () => {
  const credentialId = 'A'.repeat(32);
  const cfg = userConfig.normalizeConfig(
    { lang: 'es', region: 'NI', debridId: credentialId, debridProvider: 'torbox' },
    PLATFORM_KEYS,
    STUDIO_KEYS,
    streams.PROVIDER_KEYS
  );
  assert.equal(cfg.debridId, credentialId);
  assert.equal(cfg.debridProvider, 'torbox');
  const encoded = userConfig.encodeConfig(cfg);
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS);
  assert.equal(decoded.debridId, credentialId);
  assert.equal(decoded.debridProvider, 'torbox');
  const invalid = Buffer.from(JSON.stringify({ lang: 'es', region: 'NI', debridId: 'not-a-secret' })).toString('base64url');
  assert.equal(userConfig.decodeConfig(invalid, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS), null);
  const invalidProvider = Buffer.from(JSON.stringify({ lang: 'es', region: 'NI', debridId: credentialId, debridProvider: 'unknown' })).toString('base64url');
  assert.equal(userConfig.decodeConfig(invalidProvider, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS), null);
});

test('links con cuenta no se sirven desde caché pública y conservan magnets', async () => {
  const env = makeEnv();
  const hash = '3'.repeat(40);
  const { credentialId } = await credentials.createCredential({ provider: 'easydebrid', token: 'ed-stream-key' }, env);
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'v3-cinemeta.strem.io') return json({ meta: { name: 'Dune', year: '2021' } });
    if (url.hostname === 'api.knaben.org') return json({ hits: [{
      title: 'Dune (2021) [1080p] WEB-DL', hash, magnetUrl: `magnet:?xt=urn:btih:${hash}`, bytes: 2100000000, liveSeeders: 300,
    }] });
    if (url.hostname === 'easydebrid.com' && url.pathname.endsWith('/link/lookupdetails')) {
      return json({ result: [{ cached: true, files: [{ name: 'Dune.mkv', size: 2100000000 }] }] });
    }
    if (url.hostname === 'easydebrid.com' && url.pathname.endsWith('/link/generate')) {
      return json({ files: [{ filename: 'Dune.mkv', size: 2100000000, url: 'https://download.easydebrid.example/dune.mkv' }] });
    }
    throw new Error(`ruta inesperada ${url.hostname}${url.pathname}`);
  };
  config.reload({ STREAM_PROVIDERS: 'knaben', STREAM_MAX_RESULTS: '10' });
  const cfg = userConfig.normalizeConfig(
    { lang: 'es', region: 'NI', streams: ['knaben'], debridId: credentialId, debridProvider: 'easydebrid' },
    PLATFORM_KEYS,
    STUDIO_KEYS,
    streams.PROVIDER_KEYS
  );
  const result = await require('../lib/core').handleStream('movie', 'tt900001', cfg, { env });
  assert.equal(result.cacheMaxAge, 0);
  assert.equal(result.streams.some((item) => item.name === '⚡ EasyDebrid'), true);
  assert.equal(result.streams.some((item) => item.infoHash === hash), true);
});

// ── Diagnóstico de validación (lo que ve el usuario cuando algo falla) ──────

const blockedPage = () => new Response('<html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>', {
  status: 403,
  headers: { 'Content-Type': 'text/html; charset=UTF-8' },
});

test('los proveedores reciben User-Agent: sin él, Cloudflare responde 403 y eso no es una clave inválida', async () => {
  const seen = [];
  global.fetch = async (input, options = {}) => {
    seen.push({ url: String(input), headers: options.headers || {} });
    return blockedPage();
  };
  await assert.rejects(
    () => providers.validateCredential('torbox', 'k'.repeat(40)),
    (err) => {
      assert.equal(err.code, 'provider_blocked', 'un 403 con HTML es un bloqueo del borde, no BAD_TOKEN');
      return true;
    }
  );
  assert.ok(seen.length >= 2, 'el bloqueo por transporte se reintenta una vez');
  for (const call of seen) {
    assert.match(String(call.headers['User-Agent'] || ''), /CatalogosPlus/, 'Cloudflare Workers no manda UA: hay que ponerla');
    assert.equal(String(call.headers.Accept), 'application/json');
    assert.equal(call.url.includes('k'.repeat(40)), false, 'la clave no viaja en la URL');
  }
});

test('TorBox 403 con BAD_TOKEN se reporta como credencial inválida y se conserva su mensaje público', async () => {
  global.fetch = async () => new Response(JSON.stringify({
    success: false, error: 'BAD_TOKEN', detail: 'The token provided is invalid.', data: null,
  }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    () => providers.validateCredential('torbox', 'bad'.repeat(14)),
    (err) => {
      const diagnostic = debridShared.describeError(err);
      assert.equal(diagnostic.code, 'invalid_credential');
      assert.equal(diagnostic.providerMessage, 'The token provided is invalid.');
      return true;
    }
  );
});

test('un timeout al validar se distingue de una clave mala y reintenta una sola vez', async () => {
  const urls = [];
  global.fetch = async (input) => {
    urls.push(String(input));
    // Simula el AbortError del runtime al vencer el plazo.
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    throw error;
  };
  await assert.rejects(
    () => providers.validateCredential('torbox', 't'.repeat(40)),
    (err) => {
      const diagnostic = debridShared.describeError(err);
      assert.equal(diagnostic.code, 'provider_timeout');
      assert.match(diagnostic.message, /tardó demasiado/);
      return true;
    }
  );
  assert.equal(urls.filter((url) => url.includes('/user/me')).length, 2, 'un solo reintento: no se martillea la cuota del proveedor');
  assert.ok(urls.every((url) => url.startsWith('https://api.torbox.app/v1/api/')));
});

test('si /user/me está caído pero la cuenta responde por mylist, la clave se acepta', async () => {
  const calls = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/user/me')) return new Response('<html>502 Bad Gateway</html>', { status: 502 });
    if (url.pathname.endsWith('/torrents/mylist')) return json({ success: true, data: [] });
    throw new Error(`ruta inesperada ${url.pathname}`);
  };
  const result = await providers.validateCredential('torbox', 'v'.repeat(40));
  assert.equal(result.provider, 'torbox');
  assert.ok(calls.some((call) => call.startsWith('/v1/api/torrents/mylist')), 'usa el endpoint de respaldo documentado');
});

test('Premiumize responde status:error con message y eso es credencial inválida (no 502 genérico)', async () => {
  global.fetch = async () => json({ status: 'error', message: 'Wrong API key or other credentials' });
  await assert.rejects(
    () => providers.validateCredential('premiumize', 'p'.repeat(40)),
    (err) => {
      assert.equal(err.code, 'invalid_credential');
      assert.match(err.detail, /Wrong API key/);
      return true;
    }
  );
});

test('las claves pegadas se normalizan y las formas imposibles se detectan sin llamar al proveedor', () => {
  assert.equal(debridShared.normalizeApiKey('  Bearer abc123\n'), 'abc123');
  assert.equal(debridShared.normalizeApiKey('"abc 123"\n'), 'abc123');
  assert.equal(debridShared.normalizeApiKey('Authorization: Bearer abc123'), 'abc123');
  assert.equal(debridShared.apiKeyShapeError(''), 'empty');
  assert.equal(debridShared.apiKeyShapeError('abc'), 'too_short');
  assert.equal(debridShared.apiKeyShapeError('x'.repeat(300)), 'too_long');
  assert.equal(debridShared.apiKeyShapeError('x'.repeat(40)), null);
});

test('el formato de la clave se rechaza antes de gastar una llamada al proveedor', async () => {
  let called = 0;
  global.fetch = async () => { called++; return json({ success: true, data: {} }); };
  const connect = require('../lib/debridConnect');
  const env = makeEnv();
  const tooShort = await connect.connect({ provider: 'torbox', token: 'corta' }, { env });
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.payload.error, 'credential_format');
  assert.match(tooShort.payload.message, /demasiado corta/);
  const noKey = await connect.connect({ provider: 'torbox' }, { env });
  assert.equal(noKey.payload.code, 'empty');
  assert.equal(called, 0, 'no se llama al proveedor con una clave obviously inválida');
});

test('connect() exige almacenamiento antes que nada y devuelve solo el id opaco', async () => {
  global.fetch = async () => json({ success: true, data: { id: 1, email: 'privada@example.net', is_subscribed: true, plan: 2 } });
  const connect = require('../lib/debridConnect');
  const missing = await connect.connect({ provider: 'torbox', token: 'k'.repeat(40) }, { env: {} });
  assert.equal(missing.status, 503);
  const env = makeEnv();
  const ok = await connect.connect({ provider: 'torbox', token: 'k'.repeat(40) }, { env });
  assert.equal(ok.status, 200);
  assert.match(ok.payload.credentialId, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(ok.payload.account.subscribed, true);
  const serialized = JSON.stringify(ok.payload);
  assert.equal(serialized.includes('k'.repeat(40)), false, 'la clave nunca sale en la respuesta');
  assert.equal(serialized.includes('privada@example.net'), false, 'ni el correo de la cuenta');
});

test('connect() avisa cuando la clave vale pero el plan está inactivo', async () => {
  global.fetch = async () => json({ success: true, data: { id: 1, is_subscribed: false, plan: 0 } });
  const connect = require('../lib/debridConnect');
  const result = await connect.connect({ provider: 'torbox', token: 'k'.repeat(40) }, { env: makeEnv() });
  assert.equal(result.status, 200);
  assert.equal(result.payload.warning, 'plan_inactive');
});

test('la redirección 3xx no se sigue: el Bearer no sale hacia otro origen', async () => {
  const seen = [];
  global.fetch = async (input, options = {}) => {
    seen.push(options.redirect);
    return new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } });
  };
  await assert.rejects(
    () => providers.validateCredential('torbox', 'r'.repeat(40)),
    (err) => {
      assert.equal(err.code, 'provider_login_redirect', 'una 302 de la API no es una clave invalida: es un problema de endpoint');
      return true;
    }
  );
  assert.deepEqual([...new Set(seen)], ['manual'], 'no se sigue la redireccion: el Bearer no sale del origen');
});
