'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { SPORTS_CHANNELS, CHANNEL_ID_PREFIX, channelById, channelMeta, channelMetas } = require('../lib/sportsChannels');
const iptvOrg = require('../lib/iptvOrg');
const core = require('../lib/core');
const streams = require('../lib/streams');

describe('canales de deportes: definiciones', () => {
  test('los canales tienen id rlch:, nombre, regex y fallback https válidos', () => {
    assert.ok(SPORTS_CHANNELS.length >= 15, `solo ${SPORTS_CHANNELS.length} canales definidos`);
    for (const ch of SPORTS_CHANNELS) {
      assert.equal(ch.id, `rlch:${ch.key}`, ch.key);
      assert.ok(channelById(ch.id) === ch, `channelById(${ch.id})`);
      assert.ok(ch.name.length > 2, ch.key);
      if (ch.fallback) assert.match(ch.fallback, /^https?:\/\//, `fallback de ${ch.key}`);
      // La regex casa con un nombre real de lista (ESPN → «ESPN Latin America», Fox Sports → «Fox Sports HD», …).
      const probes = {
        'espn': 'ESPN Latin America (1080p)',
        'espn2': 'ESPN 2 Latin America (1080p)',
        'espn3': 'ESPN 3 Latin America (1080p)',
        'espn-premium': 'ESPN Premium',
        'fox-sports': 'Fox Sports HD',
        'tnt-sports': 'TNT Sports (Argentina)',
        'bein-xtra-es': 'beIN SPORTS XTRA en Espanol (1080p)',
      };
      const probe = probes[ch.key] || ch.name;
      assert.ok(ch.match.test(probe), `la regex de ${ch.key} debería coincidir con «${probe}»`);
      // Y no mezcla hermanos: ESPN no debe casar ESPN 2 ni Fox Sports con Fox Sports 1.
      if (ch.key === 'espn') assert.ok(!ch.match.test('ESPN 2 Latin America (1080p)'));
      if (ch.key === 'fox-sports') assert.ok(!ch.match.test('Fox Sports 1'));
      if (ch.key === 'dsports') assert.ok(!ch.match.test('DSports 2'));
    }
  });

  test('channelMeta produce meta Stremio con póster y fondo', () => {
    const ch = channelById('rlch:espn');
    const meta = channelMeta(ch);
    assert.equal(meta.id, 'rlch:espn');
    assert.equal(meta.type, 'tv');
    assert.match(meta.poster, /^https:\/\//);
    assert.match(meta.background, /^https:\/\//);
    assert.match(meta.description, /ESPN/);
    assert.equal(meta.posterShape, 'square');
  });

  test('channelMetas lista el catálogo completo sin duplicados', () => {
    const metas = channelMetas();
    assert.equal(metas.length, SPORTS_CHANNELS.length);
    assert.equal(new Set(metas.map((m) => m.id)).size, metas.length);
    assert.ok(metas.every((m) => m.type === 'tv'));
  });
});

describe('canales de deportes: catálogo y manifest', () => {
  test('el manifest por defecto incluye el catálogo tv_deportes de tipo tv', () => {
    const manifest = core.buildManifest();
    const cat = manifest.catalogs.find((c) => c.id === 'tv_deportes');
    assert.ok(cat, 'falta tv_deportes');
    assert.equal(cat.type, 'tv');
    assert.ok(manifest.idPrefixes.includes('rlch:'));
    assert.ok(manifest.types.includes('tv'));
    assert.equal(cat.extraSupported, undefined, 'el catálogo de canales no pagina');
  });

  test('sin la opción base deportes el catálogo no aparece', () => {
    const coreFresh = require('../lib/core');
    const manifest = coreFresh.buildManifest(null, {
      lang: 'es', region: 'MX', platforms: null, studios: null,
      base: ['top'], streams: null, isDefault: false,
    });
    assert.equal(manifest.catalogs.find((c) => c.id === 'tv_deportes'), undefined);
    assert.ok(manifest.idPrefixes.includes('rlch:'), 'el prefijo debe quedar para configs previas');
  });

  test('resolveCatalog devuelve los metas de canales para tv_deportes y [] con skip', async () => {
    const catalogs = require('../lib/catalogs');
    const metas = await catalogs.resolveCatalog('tv', 'tv_deportes', null, {});
    assert.ok(metas.length >= 15);
    assert.ok(metas.every((m) => m.type === 'tv'));
    assert.deepEqual(await catalogs.resolveCatalog('tv', 'tv_deportes', null, { skip: 20 }), []);
  });

  test('handleMeta responde fichas de canales sin TMDB', async () => {
    const result = await core.handleMeta('tv', 'rlch:fox-sports', null);
    assert.equal(result.meta.id, 'rlch:fox-sports');
    assert.match(result.meta.name, /Fox Sports/);
    const missing = await core.handleMeta('tv', 'rlch:noexiste', null);
    assert.match(String(missing.meta.name || ''), /rlch:noexiste/);
  });
});

describe('canales de deportes: streams en vivo', () => {
  test('handleStream devuelve HLS directos del fallback aunque las listas fallen', async () => {
    const original = iptvOrg.loadEntries;
    iptvOrg.loadEntries = async () => ({ entries: [], at: Date.now() });
    try {
      const result = await core.handleStream('tv', 'rlch:espn', null);
      assert.ok(result.streams.length >= 1, 'sin streams de fallback');
      const s = result.streams[0];
      assert.match(s.url, /^https?:\/\//);
      assert.equal(s.behaviorHints.notWebReady, true);
      assert.equal(s.behaviorHints.bingeGroup, 'catalogos-plus-canal-espn');
      assert.match(s.title, /Español latino/);
    } finally {
      iptvOrg.loadEntries = original;
      require('../lib/cache').deletePrefix('direct-channel:');
    }
  });

  test('dedupe contra el fallback cuando la lista ya trae la misma URL', async () => {
    const original = iptvOrg.loadEntries;
    iptvOrg.loadEntries = async () => ({
      entries: [{ name: 'ESPN (720p)', logo: '', url: 'https://example.com/espn/index.m3u8' }], at: Date.now(),
    });
    const channel = { ...channelById('rlch:espn'), fallback: 'https://example.com/espn/index.m3u8' };
    const hits = iptvOrg.hitsFor(channel, [{ name: 'ESPN (720p)', logo: '', url: 'https://example.com/espn/index.m3u8' }]);
    assert.equal(hits.length, 1, 'no debe duplicar la URL de la lista');
    void original;
  });

  test('los marcadores [Geo-blocked] y [Not 24/7] se descartan de las listas', async () => {
    const original = iptvOrg.loadEntries;
    iptvOrg.loadEntries = async () => ({
      entries: [
        { name: 'ESPN (720p) [Geo-blocked]', logo: '', url: 'https://x.example/a.m3u8' },
        { name: 'ESPN (1080p) [Not 24/7]', logo: '', url: 'https://x.example/b.m3u8' },
      ], at: Date.now(),
    });
    // hitsFor descarta los marcados aunque la caché los trajera.
    const hits = iptvOrg.hitsFor(channelById('rlch:espn'), [
      { name: 'ESPN Latin America (720p) [Geo-blocked]', url: 'https://x.example/a.m3u8' },
      { name: 'ESPN Latin America (1080p) [Not 24/7]', url: 'https://x.example/b.m3u8' },
    ]);
    assert.equal(hits.length, 1, `solo debe quedar el fallback: ${JSON.stringify(hits)}`);
    assert.match(hits[0].title, /verificada/);
    void original;
  });

  test('searchStreams despacha tv a canales y respeta el formato directo', async () => {
    // hitsFor es puro: lista viva + fallback dedupeado, en ese orden.
    const hits = iptvOrg.hitsFor(channelById('rlch:tyc-sports'), [
      { name: 'TyC Sports (720p)', logo: '', url: 'https://live.example/tyc.m3u8?token=1' },
    ]);
    assert.equal(hits.length, 2, 'hit de la lista + fallback verificado');
    assert.equal(hits[0].url, 'https://live.example/tyc.m3u8?token=1');

    // Y el despacho por type tv devuelve al menos el fallback con el formato directo.
    const result = await streams.searchStreams('tv', 'rlch:tyc-sports', {});
    assert.ok(result.length >= 1);
    assert.equal(result[0].behaviorHints.bingeGroup, 'catalogos-plus-canal-tyc-sports');
    assert.equal(result[0].behaviorHints.notWebReady, true);
    require('../lib/cache').deletePrefix('direct-channel:');
  });

  test('canal desconocido devuelve lista vacía sin lanzar', async () => {
    assert.deepEqual(await streams.searchStreams('tv', 'rlch:zzz', {}), []);
  });
});
