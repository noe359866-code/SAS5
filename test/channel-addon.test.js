'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../lib/core');
const { manifestCatalogs, resolveCatalog } = require('../lib/catalogs');

const manifest = core.buildManifest();

test('el manifest publica únicamente TV en vivo y catálogos de canales', () => {
  assert.equal(manifest.id, 'net.ramdonlatam.catalogos');
  assert.equal(manifest.version, '2.1.0');
  assert.deepEqual(manifest.types, ['tv']);
  assert.deepEqual(manifest.idPrefixes, ['rlch:m3u:']);
  assert.ok(manifest.catalogs.length > 0);
  assert.ok(manifest.catalogs.every((catalog) => catalog.type === 'tv'));
  const groups = require('../lib/livePlaylist').playlistGroups();
  assert.deepEqual(manifest.catalogs.map((catalog) => catalog.name), groups.map((group) => group.name));
  assert.ok(manifest.catalogs.some((catalog) => catalog.id === 'tv_m3u_nicaragua'));
  assert.ok(!manifest.behaviorHints.configurable);
});

test('los handlers no sirven películas, series ni catálogos anteriores', async () => {
  assert.deepEqual(await core.handleCatalog('movie', 'cine_tendencias'), { metas: [], cacheMaxAge: 0 });
  assert.deepEqual(await core.handleCatalog('series', 'tv_netflix'), { metas: [], cacheMaxAge: 0 });
  assert.deepEqual(await resolveCatalog('movie', 'cine_tendencias', null), []);
  assert.deepEqual(await resolveCatalog('series', 'tv_anime', null), []);
  assert.deepEqual(await resolveCatalog('tv', 'tv_anime', null), []);
  assert.equal((await core.handleMeta('movie', 'tt0133093')).meta.name, 'Canal no disponible');
  assert.deepEqual(await core.handleStream('movie', 'tt0133093'), { streams: [], cacheMaxAge: 0 });
  assert.deepEqual(await core.handleStream('series', 'tt0903747:1:1'), { streams: [], cacheMaxAge: 0 });
});

test('cada group-title de la M3U es un catálogo paginado de canales tv', async () => {
  const playlist = require('../lib/livePlaylist');
  const groups = playlist.playlistGroups();
  assert.equal(manifestCatalogs().length, groups.length);
  for (const group of groups) {
    const result = await core.handleCatalog('tv', group.id, null, {});
    assert.ok(result.metas.length > 0, `${group.id} no contiene canales`);
    assert.ok(result.metas.every((meta) => meta.type === 'tv'), `${group.id} incluye otro tipo`);
    assert.equal(result.metas.length, Math.min(100, group.count), `${group.id} primera página`);
    assert.equal(new Set(result.metas.map((meta) => meta.id)).size, result.metas.length, `${group.id} tiene IDs duplicados`);
    assert.equal((await core.handleCatalog('tv', group.id, null, { skip: '100' })).metas.length,
      Math.min(100, Math.max(0, group.count - 100)), `${group.id} siguiente página`);
  }
});

test('la ficha y reproducción de un canal salen de la misma entrada M3U', async () => {
  const playlist = require('../lib/livePlaylist');
  const channel = playlist.playlistMetas('Nicaragua', { limit: 1 })[0];
  assert.ok(channel, 'falta el grupo Nicaragua');
  const meta = await core.handleMeta('tv', channel.id);
  assert.equal(meta.meta.id, channel.id);
  assert.equal(meta.meta.name, channel.name);
  const streams = await core.handleStream('tv', channel.id);
  assert.equal(streams.streams.length, 1);
  assert.equal(streams.streams[0].name, channel.name);
  assert.match(streams.streams[0].url, /^https?:\/\//);
});

test('las URLs de streams se cifran en tokens opacos autenticados', async () => {
  const proxy = require('../lib/m3uProxy');
  const secret = 'test-secret-that-is-long-enough-for-aes-gcm';
  const source = 'https://origin.example/live/master.m3u8?key=private';
  const [masked] = await proxy.maskedStreams([{ url: source, name: 'Canal', behaviorHints: { proxyHeaders: { request: { Referer: 'https://origin.example/' } } } }], {
    origin: 'https://addon.example', secret,
  });
  assert.match(masked.url, /^https:\/\/addon\.example\/__channel\//);
  assert.ok(!masked.url.includes('origin.example'));
  const token = proxy.tokenFromPath(new URL(masked.url).pathname);
  assert.equal((await proxy.decryptTarget(token, secret)).url, source);
  await assert.rejects(() => proxy.decryptTarget(token, 'a-different-secret-that-is-long-enough'));
});

test('el proxy reescribe las URLs HLS para que el manifiesto tampoco revele el origen', async () => {
  const proxy = require('../lib/m3uProxy');
  const secret = 'test-secret-that-is-long-enough-for-aes-gcm';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXTINF:6,',
    'segments/part-1.ts',
    '#EXT-X-ENDLIST',
  ].join('\n'), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
  try {
    const token = await proxy.encryptTarget({ url: 'https://cdn.example/live/master.m3u8', headers: {} }, secret);
    const response = await proxy.proxyRequest(new Request(`https://addon.example/__channel/${token}`), token, {
      origin: 'https://addon.example', secret,
    });
    const body = await response.text();
    assert.match(body, /^#EXTM3U/m);
    assert.ok(!body.includes('cdn.example'));
    const targetTokens = [...body.matchAll(/https:\/\/addon\.example\/__channel\/([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
    assert.equal(targetTokens.length, 2);
    assert.equal((await proxy.decryptTarget(targetTokens[0], secret)).url, 'https://cdn.example/live/keys/key.bin');
    assert.equal((await proxy.decryptTarget(targetTokens[1], secret)).url, 'https://cdn.example/live/segments/part-1.ts');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('la lista M3U del repositorio sigue disponible como archivo de canales', () => {
  const playlist = fs.readFileSync(require.resolve('../listas/ramdonlatam-tv.m3u'), 'utf8');
  assert.match(playlist, /^#EXTM3U/m);
  assert.match(playlist, /^#EXTINF:/m);
  assert.doesNotMatch(playlist, /movie\/tt|series\/tt/i);
  const m3uGroups = [...new Set([...playlist.matchAll(/group-title="([^"]+)"/g)].map((match) => match[1]))];
  assert.deepEqual(m3uGroups, require('../lib/livePlaylist').playlistGroups().map((group) => group.name));
});

test('Worker /stream devuelve opciones directas sin M3U_PROXY_SECRET y cifradas cuando está configurado', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const workerUrl = pathToFileURL(path.join(__dirname, '..', 'worker.mjs')).href;
  const { default: worker } = await import(workerUrl);
  const playlist = require('../lib/livePlaylist');
  const channel = playlist.playlistMetas('Nicaragua', { limit: 1 })[0];
  assert.ok(channel);
  const reqUrl = `https://ramdonlatam.noe359866.workers.dev/stream/tv/${encodeURIComponent(channel.id)}.json`;

  // Sin M3U_PROXY_SECRET: entrega señales directas (nunca vacío)
  const directRes = await worker.fetch(new Request(reqUrl), {}, { waitUntil() {} });
  assert.equal(directRes.status, 200);
  const directJson = await directRes.json();
  assert.ok(directJson.streams.length >= 1, 'sin secreto debe entregar señales directas');
  assert.match(directJson.streams[0].url, /^https?:\/\//);
  assert.ok(!directJson.proxySecretRequired);

  // Con M3U_PROXY_SECRET válido: entrega señales cifradas vía /__channel/
  const secret = 'test-secret-that-is-long-enough-for-aes-gcm';
  const proxiedRes = await worker.fetch(new Request(reqUrl), { M3U_PROXY_SECRET: secret }, { waitUntil() {} });
  assert.equal(proxiedRes.status, 200);
  const proxiedJson = await proxiedRes.json();
  assert.ok(proxiedJson.streams.length >= 1);
  assert.match(proxiedJson.streams[0].url, /^https:\/\/ramdonlatam\.noe359866\.workers\.dev\/__channel\//);
});
