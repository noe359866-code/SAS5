'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { fetchJson, fetchText } = require('../lib/http');
const streams = require('../lib/streams');
const config = require('../lib/config');
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });
test('cf-mitigated challenge se detecta en 403 y también en 200 sin divulgar tokens', async () => {
  for (const status of [200, 403]) {
    global.fetch = async () => new Response('<html>secret</html>', {status, headers:{'cf-mitigated':'challenge'}});
    for (const fn of [fetchJson, fetchText]) await assert.rejects(fn('https://example.com/a?token=secret'), err => {
      assert.equal(err.challenge, true); assert.equal(err.status, status);
      assert.doesNotMatch(err.message, /secret|token/); return true;
    });
  }
});
