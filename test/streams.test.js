'use strict';

/**
 * Tests offline de los proveedores de contenido (streams):
 * parsers de Knaben / Torlock (Torznab) / BlackHoleBay, relevancia,
 * codec de config de usuario y contrato del recurso `stream`.
 * Sin red: no se llama a searchStreams con proveedores activos.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.TMDB_API_KEY;
delete process.env.TMDB_ACCESS_TOKEN;

const streams = require('../lib/streams');
const core = require('../lib/core');
const userConfig = require('../lib/userConfig');
const { PLATFORM_KEYS, STUDIO_KEYS } = require('../lib/catalogs');

test('manifest: declara el recurso stream', () => {
  const manifest = core.buildManifest('http://localhost/assets/logo.png');
  assert.ok(manifest.resources.includes('stream'));
  assert.equal(manifest.version, '1.2.0');
});

test('proveedores: Knaben, Torlock y BlackHoleBay registrados', () => {
  assert.deepEqual(streams.PROVIDER_KEYS, ['knaben', 'torlock', 'blackholebay']);
  assert.deepEqual(streams.activeProviders(null), ['knaben', 'torlock', 'blackholebay']);
  assert.deepEqual(streams.activeProviders({ streams: ['torlock'] }), ['torlock']);
  assert.deepEqual(streams.activeProviders({ streams: [] }), []);
});

test('parseKnaben: normaliza hits de la API v2', () => {
  const hits = streams.parseKnaben({
    hits: [
      {
        title: 'Dune (2021) [1080p] [WEBRip]',
        hash: 'ED0DA850C273E3E15A819BDCBBF418BC85107EC8',
        magnetUrl: 'magnet:?xt=urn:btih:ED0DA850C273E3E15A819BDCBBF418BC85107EC8',
        bytes: 2952790016,
        liveSeeders: 1070,
        livePeers: 299,
      },
      { title: 'Sin hash ni magnet' },
    ],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'knaben');
  assert.equal(hits[0].infoHash, 'ed0da850c273e3e15a819bdcbbf418bc85107ec8');
  assert.equal(hits[0].seeders, 1070);
  assert.equal(hits[0].size, 2952790016);
});

test('parseBlackHoleBay: normaliza resultados de /api/search', () => {
  const hits = streams.parseBlackHoleBay({
    results: [
      {
        name: 'Dune.2021.1080p.BluRay.REMUX-FGT',
        info_hash: 'D0EDBFA5F48275BCC841E6979B7601E6F7EEA6BC',
        magnet: 'magnet:?xt=urn:btih:D0EDBFA5',
        seeders: 302,
        leechers: 91,
        size: '39962824835',
      },
    ],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'blackholebay');
  assert.equal(hits[0].infoHash, 'd0edbfa5f48275bcc841e6979b7601e6f7eea6bc');
  assert.equal(hits[0].peers, 91);
});

test('parseTorlock: normaliza el feed Torznab XML', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Dune (2021) [1080p] [WEBRip] [YTS]</title>
      <link>https://www.torlock.com/torrent/1/dune.html</link>
      <size>2947989023</size>
      <enclosure url="magnet:?xt=urn:btih:ed0da850c273e3e15a819bdcbbf418bc85107ec8&amp;dn=Dune" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="321" />
      <torznab:attr name="peers" value="45" />
      <torznab:attr name="infohash" value="ED0DA850C273E3E15A819BDCBBF418BC85107EC8" />
    </item>
    <item><title>Sin magnet</title></item>
  </channel></rss>`;
  const hits = streams.parseTorlock(xml);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].provider, 'torlock');
  assert.equal(hits[0].infoHash, 'ed0da850c273e3e15a819bdcbbf418bc85107ec8');
  assert.equal(hits[0].seeders, 321);
  assert.match(hits[0].magnet, /^magnet:\?xt=urn:btih:/);
  assert.doesNotMatch(hits[0].magnet, /&amp;/);
});

test('parseStreamId + buildQuery: película y episodio', () => {
  assert.deepEqual(streams.parseStreamId('series', 'tt0944947:1:2'), {
    raw: 'tt0944947:1:2',
    baseId: 'tt0944947',
    season: 1,
    episode: 2,
  });
  assert.equal(
    streams.buildQuery({ title: 'Game of Thrones', year: '2011', season: 1, episode: 2, mediaType: 'series' }),
    'Game of Thrones S01E02'
  );
  assert.equal(
    streams.buildQuery({ title: 'Dune', year: '2021', season: null, episode: null, mediaType: 'movie' }),
    'Dune 2021'
  );
});

test('isRelevant: filtra secuelas y episodios equivocados', () => {
  const movie = { title: 'Dune', year: '2021', season: null, episode: null, mediaType: 'movie' };
  assert.equal(streams.isRelevant({ title: 'Dune (2021) [1080p]' }, movie), true);
  assert.equal(streams.isRelevant({ title: 'Dune Part Two (2024) [1080p]' }, movie), false);
  const ep = { title: 'Dark', year: '2017', season: 1, episode: 2, mediaType: 'series' };
  assert.equal(streams.isRelevant({ title: 'Dark S01E02 1080p' }, ep), true);
  assert.equal(streams.isRelevant({ title: 'Dark S01 COMPLETE 1080p' }, ep), true);
  assert.equal(streams.isRelevant({ title: 'Dark S02E02 1080p' }, ep), false);
});

test('handleStream: sin proveedores activos devuelve [] sin tocar la red', async () => {
  const result = await core.handleStream('movie', 'tt1160419', { streams: [] });
  assert.deepEqual(result.streams, []);
});

test('config de usuario: campo streams sobrevive al codec base64url', () => {
  const cfg = userConfig.normalizeConfig(
    { lang: 'es', region: 'MX', streams: ['knaben', 'inventado'] },
    PLATFORM_KEYS,
    STUDIO_KEYS,
    streams.PROVIDER_KEYS
  );
  assert.deepEqual(cfg.streams, ['knaben']);
  const encoded = userConfig.encodeConfig(cfg);
  const decoded = userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS);
  assert.deepEqual(decoded.streams, ['knaben']);
});

test('buildQuery: título alternativo (original) para la 2ª pasada', () => {
  const resolved = { title: 'Spirited Away', altTitle: 'Sen to Chihiro no Kamikakushi', year: '2001', season: null, episode: null, mediaType: 'movie' };
  assert.equal(streams.buildQuery(resolved), 'Spirited Away 2001');
  assert.equal(streams.buildQuery(resolved, resolved.altTitle), 'Sen to Chihiro no Kamikakushi 2001');
});

test('isRelevant: coincidencia parcial fuerte con año correcto', () => {
  const movie = { title: 'The Lord of the Rings', year: '2001', season: null, episode: null, mediaType: 'movie' };
  assert.equal(streams.isRelevant({ title: 'Lord of the Rings (2001) [1080p]' }, movie), true);
  assert.equal(streams.isRelevant({ title: 'The Matrix (1999) [1080p]' }, movie), false);
});

test('diagnose: sin proveedores activos no resuelve ni busca', async () => {
  const result = await streams.diagnose('movie', 'tt1160419', { streams: [] });
  assert.equal(result.providers.length, 0);
});

test('formatSize: bytes legibles', () => {
  assert.equal(streams.formatSize(0), '');
  assert.match(streams.formatSize(2952790016), /GB$/);
});
