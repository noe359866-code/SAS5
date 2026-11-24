'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const live = require('../lib/liveChannels');
const core = require('../lib/core');
const catalogs = require('../lib/catalogs');
const streams = require('../lib/streams');
const seed = require('../lib/data/liveChannelsSeed.json');

// Hermético: la resolución consulta las listas vivas cuando hay red; se
// bloquea fetch para fijar el camino «semilla pura» en cualquier entorno.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('sin red en tests'); };

describe('canales en vivo por categorías: semilla', () => {
  test('la semilla trae canales verificados con las categorías esperadas', () => {
    assert.ok(seed.length > 500, `semilla pobre: ${seed.length}`);
    const cats = new Set(seed.map((c) => c.category));
    for (const expected of ['deportes', 'entretenimiento', 'cine', 'infantil', 'anime', 'musica', 'noticias', 'documentales']) {
      assert.ok(cats.has(expected), `falta la categoría ${expected}`);
    }
    for (const ch of seed) {
      assert.match(ch.url, /^https?:\/\//, ch.name);
      assert.ok(ch.slug && ch.name, JSON.stringify(ch));
    }
  });

  test('las variantes [Opc.N] se colapsan en una sola tarjeta con varias URL', () => {
    const metasCine = live.liveMetas('cine');
    assert.ok(!metasCine.some((m) => /\[Opc/i.test(m.name)), 'quedan tarjetas Opc.N sin colapsar');
    // Debe haber menos tarjetas que entradas crudas de la categoría
    assert.ok(metasCine.length < seed.filter((s) => s.category === 'cine').length);
  });

  test('cada meta tiene id rlch:lv:, póster y tipo tv', () => {
    for (const cat of live.activeCategories()) {
      const metas = live.liveMetas(cat.key);
      assert.ok(metas.length > 0, cat.key);
      for (const m of metas) {
        assert.match(m.id, /^rlch:lv:/);
        assert.equal(m.type, 'tv');
        assert.ok(m.poster, `sin póster: ${m.id}`);
      }
    }
  });

  test('liveChannelById ida y vuelta', () => {
    const meta = live.liveMetas('noticias')[0];
    const ch = live.liveChannelById(meta.id);
    assert.ok(ch, meta.id);
    assert.equal(ch.category, 'noticias');
    assert.equal(live.liveChannelById('rlch:zzz'), null);
    assert.equal(live.liveChannelById('tt123'), null);
  });
});

describe('canales en vivo por categorías: catálogos y manifest', () => {
  test('el manifest por defecto trae las temáticas y no los países (margen 8 KB)', () => {
    const manifest = core.buildManifest();
    const tvIds = manifest.catalogs.filter((c) => c.type === 'tv').map((c) => c.id);
    for (const id of ['tv_deportes', 'tv_live_entretenimiento', 'tv_live_cine', 'tv_live_infantil',
      'tv_live_anime', 'tv_live_musica', 'tv_live_noticias', 'tv_live_documentales']) {
      assert.ok(tvIds.includes(id), `falta ${id}`);
    }
    assert.ok(!tvIds.includes('tv_live_mexico'), 'los países son opt-in');
    assert.ok(JSON.stringify(manifest).length <= 8000, 'manifest por encima del margen');
  });

  test('los países aparecen cuando el usuario los marca', () => {
    const manifest = core.buildManifest(null, {
      lang: 'es', region: 'MX', platforms: null, studios: null,
      base: ['live_mexico'], streams: null, isDefault: false,
    });
    const tvIds = manifest.catalogs.filter((c) => c.type === 'tv').map((c) => c.id);
    assert.deepEqual(tvIds, ['tv_live_mexico']);
  });

  test('tv_deportes mezcla curados y canales vivos sin duplicar', async () => {
    const metas = await catalogs.resolveCatalog('tv', 'tv_deportes', null, {});
    const curated = metas.filter((m) => !m.id.startsWith('rlch:lv:'));
    const extra = metas.filter((m) => m.id.startsWith('rlch:lv:deportes:'));
    assert.equal(curated.length, 20, 'los 20 curados primero');
    assert.ok(extra.length > 30, `pocos canales vivos de deportes: ${extra.length}`);
    // Ningún vivo debe replicar la regex de un curado
    const { SPORTS_CHANNELS } = require('../lib/sportsChannels');
    for (const m of extra) {
      assert.ok(!SPORTS_CHANNELS.some((c) => c.match.test(m.name)), `duplicado: ${m.name}`);
    }
    assert.equal(new Set(metas.map((m) => m.id)).size, metas.length, 'ids duplicados');
  });

  test('resolveCatalog sirve una categoría viva y pagina a vacío', async () => {
    const metas = await catalogs.resolveCatalog('tv', 'tv_live_noticias', null, {});
    assert.ok(metas.length > 20);
    assert.ok(metas.every((m) => m.type === 'tv'));
    assert.deepEqual(await catalogs.resolveCatalog('tv', 'tv_live_noticias', null, { skip: 20 }), []);
  });
});

describe('canales en vivo por categorías: streams', () => {
  test('handleStream sirve la URL de la semilla con UA propio si lo declara', async () => {
    // Un canal de la semilla que la sonda marcó con UA propio
    const withUa = seed.find((c) => c.ua);
    assert.ok(withUa, 'la semilla no tiene canales con UA propio');
    const id = `rlch:lv:${withUa.category}:${live.baseSlugOf(withUa.slug)}`;
    const result = await core.handleStream('tv', id, null);
    assert.ok(result.streams.length >= 1, 'sin streams de semilla');
    const s = result.streams[0];
    assert.equal(s.behaviorHints.notWebReady, true);
    const headers = s.behaviorHints.proxyHeaders?.request || {};
    if (s.url === withUa.url) assert.equal(headers['User-Agent'], withUa.ua);
    assert.ok(s.behaviorHints.bingeGroup.startsWith('catalogos-plus-canal-'));
    require('../lib/cache').deletePrefix('direct-channel:');
  });

  test('canal inexistente devuelve lista vacía sin lanzar', async () => {
    assert.deepEqual(await streams.searchStreams('tv', 'rlch:lv:cine:noexiste', {}), []);
  });
});

test('restaurar fetch global', () => { globalThis.fetch = realFetch; });
