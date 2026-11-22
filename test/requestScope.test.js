'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const scope = require('../lib/requestScope');

for (const name of ['cache', 'responseCache']) {
  const cache = require(`../lib/${name}`);
  test(`${name}: requests never inherit an abandoned pending promise`, async () => {
    scope.run(() => cache.coalesce('abandoned', () => new Promise(() => {})));
    assert.equal(await scope.run(() => cache.coalesce('abandoned', () => 'new request')), 'new request');
  });
  test(`${name}: deduplicates locally, isolates concurrent requests and cleans rejection`, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = scope.run(async () => {
      const a = cache.coalesce('concurrent', () => gate);
      const b = cache.coalesce('concurrent', () => assert.fail('duplicate load'));
      assert.equal(a, b);
      return a;
    });
    assert.equal(await scope.run(() => cache.coalesce('concurrent', () => 'independent')), 'independent');
    release('original');
    assert.equal(await first, 'original');
    await scope.run(async () => {
      await assert.rejects(cache.coalesce('failure', async () => { throw new Error('failed'); }));
      assert.equal(await cache.coalesce('failure', () => 'retry'), 'retry');
    });
  });
}

test('packer rejects invalid radix and excessive decoding work', () => {
  const { fromPacker } = require('../lib/mediaParse');
  const pack = (radix, count, payload = '0') =>
    `eval(function(p,a,c,k,e,d){}('${payload}',${radix},${count},'url'.split('|')))`;
  assert.equal(fromPacker(pack(1, 2)), null);
  assert.equal(fromPacker(pack(63, 2)), null);
  assert.equal(fromPacker(pack(36, 999999999)), null);
  assert.equal(fromPacker(pack(36, 4096, '0'.repeat(4096))), null);
  assert.equal(fromPacker(pack(36, 1)), 'url');
});
