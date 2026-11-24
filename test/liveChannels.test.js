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
  test('la semilla trae canales verificados, todos del proveedor único', () => {
    assert.ok(seed.length > 100, `semilla pobre: ${seed.length}`);
    const cats = new Set(seed.map((c) => c.category));
    for (const expected of ['deportes', 'cine', 'infantil', 'anime', 'documentales']) {
      assert.ok(cats.has(expected), `falta la categoría ${expected}`);
    }
    for (const ch of seed) {
      assert.match(ch.url, /^https?:\/\//, ch.name);
      // Proveedor único: m3u.tvcluboficial.com (sonda 13: sin UA, CORS abierto)
      assert.match(new URL(ch.url).hostname, /(^|\.)m3u\.tvcluboficial\.com$/, ch.name);
      assert.equal(ch.ua || '', '', `${ch.name}: el proveedor no exige UA, no debe guardarse`);
      assert.ok(ch.slug && ch.name, JSON.stringify(ch));
    }
  });

  test('las variantes [Opc.N] y de calidad se colapsan en una sola tarjeta', () => {
    // Nunca se muestra una tarjeta con el sufijo de variante
    for (const cat of live.activeCategories()) {
      assert.ok(!live.liveMetas(cat.key).some((m) => /\[Opc/i.test(m.name)), `Opc.N sin colapsar en ${cat.key}`);
    }
    // Y la lógica de colapso recorta bien el sufijo (unitario, sin semilla)
    assert.equal(live.baseSlugOf('claro-sports-2-hd-mexico-opc-2'), 'claro-sports-2-hd-mexico');
    assert.equal(live.baseSlugOf('distrito-comedia'), 'distrito-comedia');
    // «Telefe HD» no es otra tarjeta: es otra señal dentro de «Telefe»
    const argentina = live.liveMetas('argentina').map((m) => m.name);
    assert.ok(!argentina.includes('Telefe HD'), 'queda tarjeta de calidad suelta');
    const telefe = live.liveChannelById('rlch:lv:argentina:telefe');
    assert.ok(telefe.urls.length >= 2, 'Telefe debe juntar sus señales HD');
    // Sin tarjeta base («La 1 HD» en España), la variante se queda como está
    assert.ok(live.liveMetas('espana').some((m) => m.name === 'La 1 HD'));
  });

  test('los metadatos vienen ordenados y con logo cuando hay', () => {
    // Orden alfabético dentro de cada categoría
    for (const cat of live.activeCategories()) {
      const names = live.liveMetas(cat.key).map((m) => m.name);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'es')), `orden en ${cat.key}`);
    }
    // Logos de iptv-org: una parte sólida de la semilla los trae (los canales
    // de franquicia propios del proveedor usan el póster de respaldo)
    const withLogo = seed.filter((c) => c.logo);
    assert.ok(withLogo.length >= seed.length * 0.4, `pocos logos: ${withLogo.length}/${seed.length}`);
    for (const c of withLogo) assert.match(c.logo, /^https:\/\//, c.name);
    // Género y descripción llevan la etiqueta de la categoría
    const meta = live.liveMetas('anime')[0];
    assert.deepEqual(meta.genres, ['TV en vivo', 'Anime']);
    assert.match(meta.description, /· Anime\./);
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
    const meta = live.liveMetas('cine')[0];
    const ch = live.liveChannelById(meta.id);
    assert.ok(ch, meta.id);
    assert.equal(ch.category, 'cine');
    assert.equal(live.liveChannelById('rlch:zzz'), null);
    assert.equal(live.liveChannelById('tt123'), null);
  });
});

describe('canales en vivo por categorías: catálogos y manifest', () => {
  test('el manifest por defecto trae las temáticas y no los países (margen 8 KB)', () => {
    const manifest = core.buildManifest();
    const tvIds = manifest.catalogs.filter((c) => c.type === 'tv').map((c) => c.id);
    // Con el proveedor único quedan las temáticas que él cubre; las demás
    // (música, noticias, entretenimiento) se ocultan solas al quedar vacías.
    for (const id of ['tv_deportes', 'tv_live_cine', 'tv_live_infantil', 'tv_live_anime', 'tv_live_documentales']) {
      assert.ok(tvIds.includes(id), `falta ${id}`);
    }
    for (const id of ['tv_live_entretenimiento', 'tv_live_musica', 'tv_live_noticias']) {
      assert.ok(!tvIds.includes(id), `${id} debería estar oculta (sin señales del proveedor)`);
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
    assert.ok(extra.length >= 15, `pocos canales vivos de deportes: ${extra.length}`);
    // Ningún vivo debe replicar la regex de un curado
    const { SPORTS_CHANNELS } = require('../lib/sportsChannels');
    for (const m of extra) {
      assert.ok(!SPORTS_CHANNELS.some((c) => c.match.test(m.name)), `duplicado: ${m.name}`);
    }
    assert.equal(new Set(metas.map((m) => m.id)).size, metas.length, 'ids duplicados');
  });

  test('resolveCatalog sirve una categoría viva y pagina a vacío', async () => {
    const metas = await catalogs.resolveCatalog('tv', 'tv_live_infantil', null, {});
    assert.ok(metas.length > 20);
    assert.ok(metas.every((m) => m.type === 'tv'));
    assert.deepEqual(await catalogs.resolveCatalog('tv', 'tv_live_infantil', null, { skip: 20 }), []);
  });

  test('una categoría sin señales del proveedor no aparece en el manifest', async () => {
    assert.equal(live.liveMetas('noticias').length, 0);
    assert.deepEqual(await catalogs.resolveCatalog('tv', 'tv_live_noticias', null, {}), []);
  });
});

describe('canales en vivo por categorías: streams', () => {
  test('handleStream sirve la URL de la semilla sin cabeceras especiales', async () => {
    // El proveedor único no exige UA (sonda 13): ningún stream debe pedirlo
    const ch = seed.find((c) => c.category === 'cine');
    const id = `rlch:lv:${ch.category}:${live.baseSlugOf(ch.slug)}`;
    const result = await core.handleStream('tv', id, null);
    assert.ok(result.streams.length >= 1, 'sin streams de semilla');
    const s = result.streams[0];
    assert.equal(s.behaviorHints.notWebReady, true);
    const headers = s.behaviorHints.proxyHeaders?.request || {};
    assert.equal(headers['User-Agent'], undefined, 'no debe arrastrar User-Agent');
    assert.ok(s.behaviorHints.bingeGroup.startsWith('catalogos-plus-canal-'));
    require('../lib/cache').deletePrefix('direct-channel:');
  });

  test('canal inexistente devuelve lista vacía sin lanzar', async () => {
    assert.deepEqual(await streams.searchStreams('tv', 'rlch:lv:cine:noexiste', {}), []);
  });
});

test('restaurar fetch global', () => { globalThis.fetch = realFetch; });
