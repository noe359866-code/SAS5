'use strict';

/** Presupuesto de CPU del Worker gratuito: concurrencia y reloj compartido. */
const test = require('node:test');
const assert = require('node:assert');
const streams = require('../lib/streams');
const config = require('../lib/config');

const RESOLVED = { title: 'Control', altTitle: null, year: '2024', mediaType: 'movie' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubSearchers(keys, fn) {
  const originals = keys.map((key) => [key, streams.SEARCHERS[key]]);
  for (const key of keys) streams.SEARCHERS[key] = () => fn(key);
  return () => { for (const [key, searcher] of originals) streams.SEARCHERS[key] = searcher; };
}

test('runProviders no lanza más fuentes que el máximo configurado', async () => {
  const keys = ['fanpelis', 'spinflix', 'cuevanas3', 'allpeliculas'];
  let active = 0;
  let peak = 0;
  const restore = stubSearchers(keys, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(20);
    active -= 1;
    return { hits: [] };
  });
  config.reload({ STREAM_MAX_CONCURRENT: '2', STREAM_REQUEST_BUDGET_MS: '9000' });
  try {
    await streams.runProviders(keys, 'control 2024', RESOLVED, RESOLVED.title, {});
    assert.equal(peak, 2);
  } finally {
    restore();
    config.reload({});
  }
});

test('runProviders omite las fuentes que ya no caben en el presupuesto', async () => {
  const keys = ['fanpelis', 'spinflix', 'cuevanas3'];
  const calls = [];
  const restore = stubSearchers(keys, async (key) => {
    calls.push(key);
    await delay(60);
    return { hits: [] };
  });
  config.reload({ STREAM_MAX_CONCURRENT: '2', STREAM_REQUEST_BUDGET_MS: '1500' });
  try {
    const deadline = Date.now() + 20;
    const report = {};
    const hits = await streams.runProviders(keys, 'control 2024', RESOLVED, RESOLVED.title, report, 5000, { deadline });
    assert.deepEqual(calls, ['fanpelis', 'spinflix']);
    assert.equal(hits.length, 0);
    assert.equal(report.cuevanas3.skipped, true);
    assert.equal(report.cuevanas3.reason, 'budget');
  } finally {
    restore();
    config.reload({});
  }
});
