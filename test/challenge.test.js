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
test('challenge pausa solo ese proveedor y diagnóstico lo identifica', async () => {
  const old = streams.SEARCHERS.frenchstream, cooldown = config.streamProviderCooldownSeconds;
  try {
    config.streamProviderCooldownSeconds = 30;
    streams.SEARCHERS.frenchstream = async () => { const err = new Error('challenge'); err.challenge = true; err.status = 403; throw err; };
    const report = {};
    await streams.runProviders(['frenchstream'], 'Matrix', {title:'Matrix'}, 'Matrix', report, 100, {ignorePause:true});
    assert.equal(report.frenchstream.challenge, true);
    assert.ok(streams.pausedProviders().includes('frenchstream'));
    streams.SEARCHERS.frenchstream = async () => ({hits: []});
    await streams.runProviders(['frenchstream'], 'Matrix', {title:'Matrix'}, 'Matrix', {}, 100, {ignorePause:true});
    assert.ok(!streams.pausedProviders().includes('frenchstream'));
  } finally { streams.SEARCHERS.frenchstream = old; config.streamProviderCooldownSeconds = cooldown; }
});
