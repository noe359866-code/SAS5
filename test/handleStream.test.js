'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const streams = require('../lib/streams');

test('handleStream conserva los resultados incluso si otro proveedor falla', async (t) => {
  const hit = { url: 'https://cdn.example/video.mp4' };
  let partial = false;
  t.mock.method(streams, 'searchStreams', async (_type, _id, _cfg, status) => {
    status.partial = partial;
    return [hit];
  });
  const { handleStream } = require('../lib/core');
  const complete = await handleStream('movie', 'tt0110357');
  assert.deepEqual(complete.streams, [hit]);
  assert.ok(complete.cacheMaxAge > 0);
  partial = true;
  assert.deepEqual(await handleStream('movie', 'tt0110357'), { streams: [hit], cacheMaxAge: 0 });
});

test('la etiqueta usa la resolución declarada y no inventa una para HLS', () => {
  const base = { title: '1080p en el título', url: 'https://cdn.example/master.m3u8', quality: 'HLS' };
  for (const resolution of ['1080p', '720p', '300p', '2160p']) {
    assert.equal(streams.toStream({ ...base, resolution }).name, `▶ ${resolution}`);
  }
  assert.equal(streams.toStream({ ...base, resolution: 'HD' }).name, '▶ HLS');
});
