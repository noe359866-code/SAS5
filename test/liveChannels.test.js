'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const live = require('../lib/liveChannels');
const core = require('../lib/core');
const catalogs = require('../lib/catalogs');
const streams = require('../lib/streams');
const seed = require('../lib/data/liveChannelsSeed.json');
const unverifiedSeed = require('../lib/data/liveChannelsUnverifiedSeed.json');

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
      // Los hosts de tokens caducos (m3uts.xyz) nunca entran a la semilla
      assert.doesNotMatch(new URL(ch.url).hostname, /(^|\.)m3uts\.xyz$/, ch.name);
      // tvcluboficial no exige UA (sonda 13): nunca debe guardarlo
      if (/m3u\.tvcluboficial\.com$/.test(new URL(ch.url).hostname)) {
        assert.equal(ch.ua || '', '', `${ch.name}: tvcluboficial no exige UA`);
      }
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
    // Invariante de la fusión HD: ninguna categoría muestra a la vez un canal
    // y su variante de calidad (o están fusionadas, o la base no existe)
    for (const cat of live.activeCategories()) {
      const names = live.liveMetas(cat.key).map((m) => m.name);
      for (const n of names) {
        const m = /\s+(?:F?HD|SD|4K|UHD)$/i.exec(n);
        if (m) assert.ok(!names.includes(n.slice(0, m.index)), `${n} sin fusionar en ${cat.key}`);
      }
    }
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
    // Género y descripción llevan la etiqueta de la categoría (y el país
    // como género secundario cuando la semilla lo conoce)
    const meta = live.liveMetas('anime')[0];
    assert.deepEqual(meta.genres.slice(0, 2), ['TV en vivo', 'Anime']);
    assert.match(meta.description, /· Anime(\.| ·)/);
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
  test('el manifest por defecto trae los temas y ya no hay países (margen 8 KB)', () => {
    const manifest = core.buildManifest();
    const tvIds = manifest.catalogs.filter((c) => c.type === 'tv').map((c) => c.id);
    assert.ok(tvIds.includes('tv_deportes'), 'falta tv_deportes');
    // «deportes» vive dentro de tv_deportes (curados + vivos), sin fila aparte
    assert.ok(!tvIds.includes('tv_live_deportes'), 'tv_live_deportes no debería existir');
    // Todos los temas activos entran por defecto; ningún país es catálogo
    for (const cat of live.activeCategories()) {
      const id = `tv_live_${cat.key}`;
      if (cat.key === 'deportes') continue;
      assert.ok(tvIds.includes(id), `falta ${id}`);
    }
    assert.ok(!tvIds.some((id) => /^tv_live_(espana|mexico|argentina|bolivia|chile|colombia|costarica|dominicana|ecuador|elsalvador|guatemala|honduras|nicaragua|paraguay|peru|puertorico|venezuela)$/.test(id)),
      'queda un catálogo por país en el manifest');
    assert.ok(JSON.stringify(manifest).length <= 8000, 'manifest por encima del margen');
  });

  test('una config vieja con live_<país> no rompe ni crea catálogos de país', () => {
    // Compatibilidad: las instalaciones previas guardaban live_mexico etc.;
    // ahora esas claves son inertes y el usuario ve los temas que marcó
    const manifest = core.buildManifest(null, {
      lang: 'es', region: 'MX', platforms: null, studios: null,
      base: ['live_mexico', 'live_cine'], streams: null, isDefault: false,
    });
    const tvIds = manifest.catalogs.filter((c) => c.type === 'tv').map((c) => c.id);
    assert.deepEqual(tvIds, ['tv_live_cine']);
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

  test('una categoría sin canales reclasificados no aparece en el manifest', async () => {
    // Mecanismo, no dato: activeCategories mira los temas YA reclasificados
    // (la semilla guarda países; liveTopics los reparte). Todo tema activo
    // tiene canales; un catálogo inexistente resuelve a vacío sin lanzar.
    for (const cat of live.activeCategories()) {
      assert.ok(live.liveMetas(cat.key).length > 0, `${cat.key} activa sin canales`);
    }
    assert.deepEqual(await catalogs.resolveCatalog('tv', 'tv_live_narnia', null, {}), []);
  });

  test('los canales etiquetados por país se reparten por tema y guardan el país', () => {
    // Canal 20 WTV: nombre único en toda la semilla (sin homónimos regionales)
    const nicaragua = unverifiedSeed.find((c) => c.category === 'nicaragua' && c.slug === 'canal-20-wtv-hd');
    assert.ok(nicaragua, 'la semilla ya no trae Canal 20 WTV de Nicaragua');
    const ch = live.liveChannelById(`rlch:lv:nicaragua:${live.baseSlugOf(nicaragua.slug)}`);
    assert.ok(ch, `id legado sin resolver: ${nicaragua.slug}`);
    assert.notEqual(ch.category, 'nicaragua', 'el país no debe quedar como tema');
    assert.ok(live.LIVE_CATEGORIES.some((c) => c.key === ch.category), `tema desconocido: ${ch.category}`);
    assert.equal(ch.country, 'Nicaragua');
    // El país aparece como género secundario de la tarjeta
    const meta = live.liveMeta(ch);
    assert.ok(meta.genres.includes('Nicaragua'), JSON.stringify(meta.genres));
  });

  test('el clasificador temático compartido (liveTopics)', () => {
    const { thematicCategoryOf } = live;
    // Tema válido de la semilla se respeta
    assert.equal(thematicCategoryOf('La 1', 'cine'), 'cine');
    assert.equal(thematicCategoryOf('Tigo Sports', 'deportes'), 'deportes');
    // Categoría-país se reparte por nombre
    assert.equal(thematicCategoryOf('ESPN 2', 'mexico'), 'deportes');
    assert.equal(thematicCategoryOf('Cartoon Network', 'peru'), 'infantil');
    assert.equal(thematicCategoryOf('CNN en Español', 'espana'), 'noticias');
    assert.equal(thematicCategoryOf('Canal 10', 'nicaragua'), 'entretenimiento');
    // Deporte manda sobre cine aunque la categoría del panel diga «cine»
    assert.equal(thematicCategoryOf('TNT Sports', 'cine'), 'deportes');
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

describe('canales sin verificar (iptvgo.cc)', () => {
  test('la semilla sin verificar tiene la forma esperada', () => {
    assert.ok(Array.isArray(unverifiedSeed));
    // La semilla cruda puede traer temas O países; la reclasificación por
    // tema ocurre al cargarla (liveTopics), no aquí.
    const cats = new Set([...live.LIVE_CATEGORIES.map((c) => c.key),
      'espana', 'mexico', 'argentina', 'bolivia', 'chile', 'colombia', 'costarica',
      'dominicana', 'ecuador', 'elsalvador', 'guatemala', 'honduras', 'nicaragua',
      'paraguay', 'peru', 'puertorico', 'venezuela']);
    for (const ch of unverifiedSeed) {
      assert.equal(ch.unverified, true, ch.name);
      assert.match(ch.url, /^http:\/\/iptvgo\.cc\/live\/[^/]+\/[^/]+\/\d+\.m3u8$/, ch.name);
      assert.ok(cats.has(ch.category), `categoría desconocida: ${ch.category}`);
      assert.ok(ch.slug && ch.name, JSON.stringify(ch));
    }
  });

  test('la tarjeta sin verificar avisa en la descripción', () => {
    const meta = live.liveMeta({ name: 'Prueba', slug: 'prueba', category: 'cine', logo: '', urls: [{ url: 'http://iptvgo.cc/live/u/p/1.m3u8' }], unverified: true });
    assert.match(meta.description, /⚠️ Señal sin verificar/);
    const okMeta = live.liveMeta({ name: 'Prueba', slug: 'prueba', category: 'cine', logo: '', urls: [] });
    assert.doesNotMatch(okMeta.description, /sin verificar/);
  });

  test('un canal sin verificar resuelve solo sus URLs de semilla', async () => {
    if (!unverifiedSeed.length) return; // la sonda semanal aún no la ha llenado
    const ch0 = unverifiedSeed[0];
    const ch = live.liveChannelById(`rlch:lv:${ch0.category}:${live.baseSlugOf(ch0.slug)}`);
    assert.ok(ch, `${ch0.category}:${ch0.slug}`);
    const hits = await live.resolveLiveChannel(ch);
    assert.ok(hits.length >= 1);
    for (const h of hits) assert.match(h.url, /^http:\/\/iptvgo\.cc\//);
  });
});

test('restaurar fetch global', () => { globalThis.fetch = realFetch; });
