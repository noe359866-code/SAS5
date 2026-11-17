'use strict';

/**
 * Planificador de estáticos: qué archivos conviene pregenerar para que las
 * peticiones de Stremio no ejecuten el Worker (en `*.workers.dev` cada
 * invocación cuenta contra las 100.000/día del plan free).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ASSET_FILE_LIMIT,
  BASE_RESERVE,
  buildPlan,
  configKey,
  isPlannableConfig,
  pageSuffix,
} = require('../lib/staticPlan');

const catalogs = require('../lib/catalogs');
const userConfig = require('../lib/userConfig');
const { PLATFORM_KEYS, STUDIO_KEYS } = catalogs;
const { PROVIDER_KEYS } = require('../lib/streams');

const cfgFor = (segment) => userConfig.decodeConfig(segment, PLATFORM_KEYS, STUDIO_KEYS, PROVIDER_KEYS);

test('configKey ignora lo que no cambia un catálogo (streams, filtros, orden)', () => {
  const base = { lang: 'es', region: 'NI', platforms: ['netflix'], studios: ['marvel'], base: ['tendencias'] };
  const withStreams = { ...base, streams: ['knaben'], hide: ['cam'], sort: 'size', maxSize: 10 };
  assert.equal(configKey(base), configKey(withStreams));
  // Lo que sí cambia el contenido sí cuenta.
  assert.notEqual(configKey(base), configKey({ ...base, region: 'MX' }));
  assert.notEqual(configKey(base), configKey({ ...base, platforms: ['netflix', 'disney'] }));
  assert.notEqual(configKey(base), configKey({ ...base, studios: [] }));
  // Sin configuración es un grupo propio.
  assert.equal(configKey(null), 'default');
  // El orden de la selección no crea grupos distintos.
  assert.equal(
    configKey({ ...base, platforms: ['disney', 'netflix'] }),
    configKey({ ...base, platforms: ['netflix', 'disney'] })
  );
});

test('nunca se planifica una config con debrid (segmento por usuario, streams privados)', () => {
  assert.equal(isPlannableConfig({ debridId: 'a'.repeat(32) }), false);
  assert.equal(isPlannableConfig({ debridId: null }), true);
  assert.equal(isPlannableConfig(null), false);

  const segment = userConfig.encodeConfig({ lang: 'es', region: 'NI', debridId: 'a'.repeat(32) });
  const plan = buildPlan({
    configs: [{ segment, cfg: cfgFor(segment), popularity: 100 }],
    defs: [],
    budget: 100,
  });
  assert.deepEqual(plan.files, []);
});

test('pageSuffix: la página 1 es el archivo del catálogo', () => {
  assert.equal(pageSuffix(1), '');
  assert.equal(pageSuffix(2), '/page-2');
  assert.equal(pageSuffix(3), '/page-3');
});

test('con presupuesto de sobra se escriben catálogos por defecto, manifest y catálogos de la config', () => {
  const segment = userConfig.encodeConfig({ lang: 'es', region: 'MX', platforms: ['netflix'], studios: [], base: ['tendencias'] });
  const plan = buildPlan({
    configs: [{ segment, cfg: cfgFor(segment), popularity: 2 }],
    defs: [{ id: 'cine_tendencias', type: 'movie' }],
    defsFor: (cfg) => catalogs.buildDefs(cfg),
    budget: 5000,
  });

  const paths = plan.files.map((file) => file.path);
  assert.equal(paths.includes('/catalog/movie/cine_tendencias.json'), true);
  assert.equal(paths.includes(`/${segment}/manifest.json`), true);
  // Tres páginas por catálogo: la 1, la 2 y la 3.
  const pages = paths.filter((path) => path.startsWith(`/${segment}/catalog/movie/cine_tendencias`));
  assert.deepEqual(pages.sort(), [
    `/${segment}/catalog/movie/cine_tendencias.json`,
    `/${segment}/catalog/movie/cine_tendencias/page-2.json`,
    `/${segment}/catalog/movie/cine_tendencias/page-3.json`,
  ]);
  assert.equal(plan.skipped, 0);
});

test('el plan respeta el tope de 20.000 archivos de Cloudflare Free', () => {
  const segment = userConfig.encodeConfig({ lang: 'es', region: 'MX', platforms: ['netflix'], studios: [], base: ['tendencias'] });
  const plan = buildPlan({
    configs: [{ segment, cfg: cfgFor(segment), popularity: 1 }],
    defsFor: () => catalogs.buildDefs(null),
    budget: ASSET_FILE_LIMIT - BASE_RESERVE,
  });
  assert.ok(plan.files.length <= plan.budget);
  assert.ok(plan.budget < ASSET_FILE_LIMIT, 'se reserva espacio para la web y el logo');
});

test('con presupuesto ajustado gana el ROI y el manifest nunca se queda fuera', () => {
  const hot = userConfig.encodeConfig({ lang: 'es', region: 'MX', platforms: ['netflix'], studios: [], base: ['tendencias'] });
  const cold = userConfig.encodeConfig({ lang: 'en', region: 'US', platforms: ['hulu'], studios: [], base: ['tendencias'] });
  const plan = buildPlan({
    configs: [
      { segment: cold, cfg: cfgFor(cold), popularity: 0.01 },
      { segment: hot, cfg: cfgFor(hot), popularity: 50 },
    ],
    defs: [{ id: 'cine_tendencias', type: 'movie' }],
    defsFor: (cfg) => catalogs.buildDefs(cfg),
    // 13 archivos por config (manifest + 4 catálogos × 3 páginas) y aquí
    // entran 14: solo cabe una config completa, no las dos.
    budget: 14,
  });

  const paths = plan.files.map((file) => file.path);
  // El manifest cuesta 1 archivo y evita una invocación por sesión: siempre entra.
  assert.equal(paths.includes(`/${hot}/manifest.json`), true);
  assert.equal(paths.includes(`/${cold}/manifest.json`), true);
  // No cabe todo: se descarta lo menos rentable.
  assert.ok(plan.skipped > 0);
  const hotCatalogs = paths.filter((path) => path.startsWith(`/${hot}/catalog/`)).length;
  const coldCatalogs = paths.filter((path) => path.startsWith(`/${cold}/catalog/`)).length;
  assert.ok(hotCatalogs >= coldCatalogs);
});

test('es determinista: los mismos datos producen el mismo plan', () => {
  const a = userConfig.encodeConfig({ lang: 'es', region: 'MX', platforms: ['netflix', 'max'], studios: [], base: ['tendencias'] });
  const b = userConfig.encodeConfig({ lang: 'pt-BR', region: 'BR', platforms: ['max', 'netflix'], studios: [], base: ['tendencias'] });
  const input = {
    configs: [{ segment: a, cfg: cfgFor(a), popularity: 3 }, { segment: b, cfg: cfgFor(b), popularity: 3 }],
    defs: [{ id: 'cine_tendencias', type: 'movie' }, { id: 'tv_tendencias', type: 'series' }],
    defsFor: (cfg) => catalogs.buildDefs(cfg),
    budget: 200,
  };
  const first = buildPlan(input).files.map((file) => file.path);
  const second = buildPlan(input).files.map((file) => file.path);
  assert.deepEqual(first, second, 'sin orden estable, cada despliegue reescribiría archivos distintos');
});

test('las fichas no dependen de la config y no se duplican', () => {
  const plan = buildPlan({
    titles: [
      { id: 'tt1', type: 'movie' },
      { id: 'tt1', type: 'movie' }, // repetida: un solo archivo
      { id: 'tt1', type: 'series' }, // mismo id, otro tipo: es otro archivo
      { id: '', type: 'movie' },
    ],
    budget: 100,
  });
  const metas = plan.files.map((file) => file.path).filter((path) => path.startsWith('/meta/'));
  assert.deepEqual(metas.sort(), ['/meta/movie/tt1.json', '/meta/series/tt1.json']);
});

test('sin presupuesto no se escribe nada (y no se rompe)', () => {
  const plan = buildPlan({ defs: [{ id: 'cine_tendencias', type: 'movie' }], budget: 0 });
  assert.deepEqual(plan.files, []);
  assert.equal(plan.skipped, 1);
});
