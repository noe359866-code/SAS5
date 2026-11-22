'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { explorerHtml, EXPLORER_JS } = require('../lib/catalogExplorer');
const { buildDefs } = require('../lib/catalogs');

test('explorer lists every catalog once, in three accessible sections', () => {
  const doc = new JSDOM(explorerHtml()).window.document;
  assert.equal(doc.querySelectorAll('.catalog-item').length, buildDefs(null).length);
  assert.equal(doc.querySelectorAll('details > summary').length, 3);
  assert.ok(doc.querySelector('#catalogSearch').getAttribute('aria-label'));
  assert.equal(doc.querySelector('#catalogCount').getAttribute('aria-live'), 'polite');
});

test('explorer combines name and media filters and recovers from empty results', () => {
  const dom = new JSDOM(explorerHtml(), { runScripts: 'outside-only' });
  dom.window.eval(EXPLORER_JS);
  const doc = dom.window.document;
  const search = doc.querySelector('#catalogSearch');
  const type = doc.querySelector('#catalogType');
  const input = (value) => { search.value = value; search.dispatchEvent(new dom.window.Event('input')); };
  input('NETFLIX');
  assert.equal(doc.querySelectorAll('.catalog-item:not([hidden])').length, 2);
  type.value = 'series'; type.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelectorAll('.catalog-item:not([hidden])').length, 1);
  input('no-existe-12345');
  assert.equal(doc.querySelector('#catalogEmpty').hidden, false);
  input(''); type.value = 'all'; type.dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelector('#catalogEmpty').hidden, true);
  assert.equal(doc.querySelectorAll('.catalog-item:not([hidden])').length, buildDefs(null).length);
  dom.window.close();
});

test('manifest catalog order groups movies before series without losing IDs', () => {
  const defs = buildDefs(null);
  const firstSeries = defs.findIndex((d) => d.type === 'series');
  assert.ok(firstSeries > 0);
  assert.ok(defs.slice(firstSeries).every((d) => d.type === 'series'));
  assert.equal(new Set(defs.map((d) => d.id)).size, defs.length);
  assert.deepEqual(buildDefs({ base: ['top'], platforms: [], studios: [] }).map((d) => d.id), ['cine_top', 'tv_top']);
});

test('retired studios have no section, checkbox, or navigation link in the configurator', () => {
  const { renderConfigure } = require('../lib/configurePage');
  const html = renderConfigure({ origin: 'https://addon.example', host: 'addon.example' });
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('#estudios'), null);
  assert.equal(doc.querySelector('[data-group="studios"]'), null);
  assert.equal(doc.querySelector('a[href="#estudios"]'), null);
});
