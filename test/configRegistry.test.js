'use strict';

/**
 * Registro de configuraciones vistas: qué pregenerar (`npm run prerender`).
 *
 * Guarda solo el segmento base64url (que ya viaja en la URL del manifest) y la
 * selección normalizada. Nunca credenciales.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../lib/configRegistry');
const userConfig = require('../lib/userConfig');
const catalogs = require('../lib/catalogs');
const { PROVIDER_KEYS } = require('../lib/streams');

const cfgFor = (segment) => userConfig.decodeConfig(
  segment, catalogs.PLATFORM_KEYS, catalogs.STUDIO_KEYS, PROVIDER_KEYS
);

beforeEach(() => registry.reset());

test('cuenta visitas y normaliza la popularidad a la más vista', () => {
  const a = userConfig.encodeConfig({ lang: 'es', region: 'NI', platforms: ['netflix'], studios: [], base: ['tendencias'] });
  const b = userConfig.encodeConfig({ lang: 'en', region: 'US', platforms: ['hulu'], studios: [], base: ['tendencias'] });

  registry.note(a, cfgFor(a));
  registry.note(a, cfgFor(a));
  registry.note(a, cfgFor(a));
  registry.note(b, cfgFor(b));

  const report = registry.report();
  assert.equal(report.configs.length, 2);
  assert.equal(report.configs[0].segment, a, 'primero la más vista');
  assert.equal(report.configs[0].popularity, 1);
  assert.equal(report.configs[0].hits, 3);
  assert.equal(report.configs[1].popularity, 0.333);
  assert.equal(report.totalHits, 4);
});

test('las configs con debrid no se registran (segmento por usuario, streams privados)', () => {
  const segment = userConfig.encodeConfig({ lang: 'es', region: 'NI', debridId: 'b'.repeat(32) });
  registry.note(segment, cfgFor(segment));
  const report = registry.report();
  assert.deepEqual(report.configs, []);
  assert.equal(report.totalHits, 0);
});

test('el informe no filtra nada que no sea idioma, región y selección', () => {
  const segment = userConfig.encodeConfig({
    lang: 'es', region: 'NI', platforms: ['netflix'], studios: ['marvel'], base: ['tendencias'],
    hide: ['cam'], sort: 'size', maxSize: 20,
  });
  const cfg = cfgFor(segment);
  registry.note(segment, cfg);
  const [entry] = registry.report().configs;
  assert.deepEqual(Object.keys(entry.cfg).sort(), ['base', 'lang', 'platforms', 'region', 'studios']);
});

test('olvida lo que no se ha visto en una semana', () => {
  const segment = userConfig.encodeConfig({ lang: 'es', region: 'NI', platforms: ['netflix'], studios: [], base: [] });
  const old = Date.now() - registry.STALE_MS - 1000;
  registry.note(segment, cfgFor(segment), old);
  assert.deepEqual(registry.report().configs, []);
  // Con el instante explícito sigue ahí.
  assert.equal(registry.report({ now: old + 1000 }).configs.length, 1);
});

test('la memoria del isolate está acotada', () => {
  for (let i = 0; i < registry.MAX_SEGMENTS + 50; i++) {
    const segment = `seg${String(i).padStart(8, '0')}`;
    registry.note(segment, { lang: 'es', region: 'NI', platforms: [], studios: [], base: [] });
  }
  assert.equal(registry.report({ limit: 1000 }).totalSegments, registry.MAX_SEGMENTS);
});
