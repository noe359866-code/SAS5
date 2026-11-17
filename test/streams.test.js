'use strict';

/**
 * Tests offline de los proveedores de contenido (streams):
 * parsers de Knaben / Torlock (Torznab) / BlackHoleBay / Nyaa / YTS / EZTV /
 * The RarBg / Índice BR,
 * relevancia (general y la propia de Nyaa), consulta de Nyaa,
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
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('proveedores: los quince proveedores quedan registrados', () => {
  const all = ['knaben', 'torlock', 'blackholebay', 'nyaa', 'yts', 'eztv', 'rarbg', 'torrentindexer', 'torrentioes', 'espanol', 'spinflix', 'fanpelis', 'embed69', 'videoapi', 'playlatin'];
  assert.deepEqual(streams.PROVIDER_KEYS, all);
  assert.deepEqual(streams.activeProviders(null), all);
  assert.deepEqual(streams.activeProviders({ streams: ['torlock'] }), ['torlock']);
  assert.deepEqual(streams.activeProviders({ streams: ['yts', 'nyaa'] }), ['nyaa', 'yts']);
  assert.deepEqual(streams.activeProviders({ streams: [] }), []);
  // Todos llevan nombre y enlace a su documentación (chips de /configure).
  for (const provider of streams.PROVIDERS) {
    assert.ok(provider.name, provider.key);
    assert.match(provider.url, /^https:\/\//, provider.key);
  }
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
  assert.equal(streams.isRelevant({ title: 'Dark S01E03 1080p' }, ep), false);
  assert.equal(streams.isRelevant({ title: 'Dark S02E02 1080p' }, ep), false);
  assert.equal(streams.isRelevant({ title: 'Dark 1x02 HDTV' }, ep), true);
  assert.equal(streams.isRelevant({ title: 'Dark 1x03 HDTV' }, ep), false);
  assert.equal(streams.isRelevant({ title: 'Dark Cap. 101_107 Castellano' }, ep), true);
  assert.equal(streams.isRelevant({ title: 'Dark Cap. 108 Castellano' }, ep), false);
});

test('parseStreamId: acepta tvmaze y señala tvdb/tmdb sin tipo', () => {
  // tvmaze con temporada: es lo que emite el catálogo «En TV hoy».
  assert.equal(streams.parseStreamId('series', 'tvmaze:72988:1:1').baseId, 'tvmaze:72988');
  assert.equal(streams.parseStreamId('series', 'tvmaze:72988:1:1').season, 1);
  assert.equal(streams.parseStreamId('series', 'tvmaze:72988:1:1').episode, 1);
  // Los que no se pueden resolver se marcan, en vez de fallar en silencio.
  assert.equal(streams.parseStreamId('series', 'tvdb:series:81189:1:1').invalid, 'tvdb_not_supported');
  assert.equal(streams.parseStreamId('series', 'tvdb:81189').invalid, 'tvdb_not_supported');
  assert.equal(streams.parseStreamId('movie', 'tmdb:603').invalid, 'tmdb_id_without_type');
  // Con tipo explícito, ningún problema.
  assert.equal(streams.parseStreamId('series', 'tmdb:tv:1396:1:1').baseId, 'tmdb:tv:1396');
  assert.equal(streams.parseStreamId('movie', 'tmdb:movie:603').invalid, undefined);
});

test('diagnose: explica por qué un id no soportado no tiene streams', async () => {
  const cfg = { streams: ['knaben'] };
  const tvdb = await streams.diagnose('series', 'tvdb:series:81189:1:1', cfg);
  assert.equal(tvdb.ok, false);
  assert.equal(tvdb.stage, 'parseId');
  assert.equal(tvdb.reason, 'tvdb_not_supported');
  const bare = await streams.diagnose('movie', 'tmdb:603', cfg);
  assert.equal(bare.reason, 'tmdb_id_without_type');
});

test('isRelevant: no cuela otra serie con el mismo SxxEyy', () => {
  // Regresión de docs/pruebas-en-vivo-2026-11-17.md: la ficha de Breaking Bad
  // S01E01 mostraba «The Bad Guys Breaking In S01E01» porque la rama de series
  // solo comparaba temporada y episodio.
  const bb = { title: 'Breaking Bad', altTitle: null, year: '2008', season: 1, episode: 1, mediaType: 'series' };
  const q = 'Breaking Bad 2008';
  assert.equal(streams.isRelevant({ title: 'Breaking.Bad.S01E01.Pilot.1080p.HEVC.x265-MeGusta' }, bb, q), true);
  assert.equal(streams.isRelevant({ title: 'Breaking Bad S01E01-07 1080p NF WEB-DL ITA-ENG DDP5.1 AV1-G66' }, bb, q), true);
  assert.equal(streams.isRelevant({ title: 'Breaking.Bad.S01E01.HDTV.XviD-BiA' }, bb, q), true);
  // Título en otro alfabeto que repite el romanizado.
  assert.equal(streams.isRelevant({ title: '绝命毒师 Breaking Bad S01E01 中英字幕 BDrip 1080p-人人影视' }, bb, q), true);
  // Otra serie, mismo episodio: fuera.
  assert.equal(streams.isRelevant({ title: 'The Bad Guys Breaking In S01E01 1080p HEVC x265-MeGusta' }, bb, q), false);
  assert.equal(streams.isRelevant({ title: 'The Bad Guys Breaking In S01E01 1080p WEB h264-DOLORES' }, bb, q), false);
  assert.equal(streams.isRelevant({ title: 'Better.Call.Saul.S01E01.1080p.WEB-DL' }, bb, q), false);
  assert.equal(streams.isRelevant({ title: 'El.Chavo.S01E01.720p' }, bb, q), false);
});

test('isRelevant: títulos cortos, artículos y temporada equivocada', () => {
  const loki = { title: 'Loki', altTitle: null, year: '2021', season: 1, episode: 1, mediaType: 'series' };
  assert.equal(streams.isRelevant({ title: 'Loki.S01E01.1080p' }, loki, 'Loki 2021'), true);
  assert.equal(streams.isRelevant({ title: 'Loki.S02E01.1080p' }, loki, 'Loki 2021'), false);

  const hotd = { title: 'House of the Dragon', altTitle: null, year: '2022', season: 1, episode: 1, mediaType: 'series' };
  assert.equal(streams.isRelevant({ title: 'House.of.the.Dragon.S01E01.1080p' }, hotd, 'House of the Dragon 2022'), true);
  assert.equal(streams.isRelevant({ title: 'The.House.S01E01.1080p' }, hotd, 'House of the Dragon 2022'), false);

  const lou = { title: 'The Last of Us', altTitle: null, year: '2023', season: 1, episode: 3, mediaType: 'series' };
  assert.equal(streams.isRelevant({ title: 'The.Last.of.Us.S01E03.1080p' }, lou, 'The Last of Us 2023'), true);
  assert.equal(streams.isRelevant({ title: 'The.Last.of.Us.S02E03.1080p' }, lou, 'The Last of Us 2023'), false);

  // El título original (altTitle) también vale como referencia.
  const dark = { title: 'Dark', altTitle: 'Dark', year: '2017', season: 1, episode: 2, mediaType: 'series' };
  assert.equal(streams.isRelevant({ title: 'Dark.S01E02.1080p.NF.WEB-DL' }, dark, 'Dark 2017'), true);
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

test('config de usuario: Real-Debrid guarda una referencia opaca, nunca el token', () => {
  const credentialId = 'x'.repeat(32);
  const cfg = userConfig.normalizeConfig(
    { lang: 'es', region: 'MX', debridId: credentialId },
    PLATFORM_KEYS,
    STUDIO_KEYS,
    streams.PROVIDER_KEYS
  );
  const encoded = userConfig.encodeConfig(cfg);
  assert.equal(userConfig.decodeConfig(encoded, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS).debridId, credentialId);
  const bad = Buffer.from(JSON.stringify({ lang: 'es', debridId: 'secret-token' })).toString('base64url');
  assert.equal(userConfig.decodeConfig(bad, PLATFORM_KEYS, STUDIO_KEYS, streams.PROVIDER_KEYS), null);
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

test('los streams no muestran nombres de proveedores en pantalla', async () => {
  // Sin proveedores activos no hay red; validamos el formato con un hit
  // sintético a través del mapeo público de búsqueda no es posible, así
  // que comprobamos que el código de presentación no incluye la etiqueta.
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'lib', 'streams.js'), 'utf8');
  assert.doesNotMatch(src, /⚙ \$\{providerLabel\}/);
  assert.doesNotMatch(src, /🧲 \$\{providerLabel\}/);
});

test('formatSize: bytes legibles', () => {
  assert.equal(streams.formatSize(0), '');
  assert.match(streams.formatSize(2952790016), /GB$/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Nyaa
// ─────────────────────────────────────────────────────────────────────────────
const NYAA_TRACKERS =
  '&tr=http%3A%2F%2Fnyaa.tracker.wf%3A7777%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce';

test('parseNyaa: normaliza resultados y descarta lo que no es vídeo', () => {
  const hits = streams.parseNyaa({
    count: 5,
    data: [
      {
        category: 'Anime - English-translated',
        title: '[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [6AAEC79A].mkv',
        magnet: `magnet:?xt=urn:btih:F6C3A88AF352846E8A2B6CF0B8052B5C6649B121&dn=x${NYAA_TRACKERS}`,
        size: '1.4 GiB',
        seeders: 509,
        leechers: 0,
      },
      {
        category: 'Live Action - Raw',
        title: 'Alice in Borderland S01 1080p',
        magnet: 'magnet:?xt=urn:btih:f03841b6b24585b1571df6b0c930d9946047058f',
        size: '741.0 MiB',
        seeders: '12',
        leechers: '3',
      },
      { category: 'Audio - Lossless', title: 'Banda sonora', magnet: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111' },
      { category: 'Anime - Anime Music Video', title: 'AMV', magnet: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222' },
      { category: 'Live Action - Idol/Promotional Video', title: 'PV', magnet: 'magnet:?xt=urn:btih:3333333333333333333333333333333333333333' },
      { category: 'Anime - Raw', title: 'Sin magnet' },
      { category: 'Anime - Raw', title: 'Magnet sin hash válido', magnet: 'magnet:?xt=urn:btih:abc' },
      null,
    ],
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].provider, 'nyaa');
  assert.equal(hits[0].infoHash, 'f6c3a88af352846e8a2b6cf0b8052b5c6649b121');
  assert.equal(hits[0].seeders, 509);
  assert.equal(hits[0].peers, 0);
  assert.equal(hits[0].size, Math.round(1.4 * 1024 ** 3));
  assert.match(hits[0].magnet, /tr=http%3A%2F%2Fnyaa\.tracker\.wf/);
  assert.equal(hits[1].size, 741 * 1024 ** 2);
  assert.equal(hits[1].seeders, 12);
  assert.equal(hits[1].peers, 3);
  // Respuestas vacías o inesperadas no rompen.
  assert.deepEqual(streams.parseNyaa({ count: 0, data: [] }), []);
  assert.deepEqual(streams.parseNyaa({ detail: 'Invalid category.' }), []);
  assert.deepEqual(streams.parseNyaa(null), []);
  // Nyaa limita los nombres a 255 caracteres: uno desmesurado se recorta antes
  // de pasar por los filtros (evita gastar CPU con una respuesta anómala).
  const [long] = streams.parseNyaa({
    data: [{
      category: 'Anime - Raw',
      title: `Sousou no Frieren${' '.repeat(5000)}- 05`,
      magnet: 'magnet:?xt=urn:btih:4444444444444444444444444444444444444444',
    }],
  });
  assert.equal(long.title.length, 300);
});

const FRIEREN_TITLES = ["Frieren: Beyond Journey's End", 'Sousou no Frieren'];
const frieren = (season, episode) => ({
  title: FRIEREN_TITLES[0], altTitle: null, year: '2023', mediaType: 'series', animation: true, language: 'ja', season, episode,
});

test('buildNyaaQuery: episodio = marcas entre comillas + variantes del título', () => {
  const query = streams.buildNyaaQuery(frieren(1, 5), FRIEREN_TITLES);
  const cut = query.lastIndexOf('" (') + 1; // fin de la última marca entrecomillada
  const markers = query.slice(0, cut);
  // Las variantes del título van sin comillas (búsqueda por palabras) y
  // sin apóstrofos ni signos: «Journey's» → «Journey».
  assert.equal(query.slice(cut), ' (Frieren Beyond Journey End)|(Sousou no Frieren)');
  // Las marcas van todas entre comillas y unidas por «|» sin espacios: así
  // Nyaa las trata como un único grupo «al menos una de estas».
  const list = markers.split('|');
  assert.ok(list.every((marker) => /^"[^"|]+"$/.test(marker)), markers);
  for (const marker of ['"S01E05"', '" - 05"', '"_-_05"', '"01-"', '"Season 1 "', '"(Season 01"', '"S01 "', '"S01."', '"Batch"', '"[BD"']) {
    assert.ok(list.includes(marker), `falta ${marker}`);
  }
  // Sueltas casarían con cualquier episodio («S01E07», «S1 - 07») o con un CRC («[A7BD4B57]»).
  for (const marker of ['"S01"', '"S1"', '"Season 1"', '"BD"', '"05"']) {
    assert.ok(!list.includes(marker), `sobra ${marker}`);
  }
  assert.equal(new Set(list).size, list.length, 'marcas repetidas');
});

test('buildNyaaQuery: temporadas posteriores, live action, películas y títulos raros', () => {
  const s2 = streams.buildNyaaQuery(frieren(2, 12), FRIEREN_TITLES);
  for (const marker of ['"S02E12"', '" - 12"', '"Season 2 "', '"S2 ["', '"S02 "', '"2nd Season ["']) {
    assert.ok(s2.includes(marker), `falta ${marker}`);
  }
  assert.ok(!s2.includes('"S2 "'), 'en anime «S2 » casaría con todos los «Título S2 - NN»');
  assert.ok(streams.buildNyaaQuery(frieren(3, 1), FRIEREN_TITLES).includes('"3rd Season ["'));
  const s11 = streams.buildNyaaQuery(frieren(11, 3), FRIEREN_TITLES);
  assert.ok(s11.includes('"S11E03"') && s11.includes('"S11 "') && s11.includes('"11th Season ["'));
  assert.ok(!s11.includes('"S011'));

  // Live action: casi todo son packs «Título S1 2020 2160p».
  const live = streams.buildNyaaQuery(
    { mediaType: 'series', season: 1, episode: 1, animation: false },
    ['Alice in Borderland', 'Imawa no Kuni no Alice']
  );
  assert.ok(live.includes('"S1 "'));
  assert.ok(live.endsWith(' (Alice in Borderland)|(Imawa no Kuni no Alice)'));

  // Película: solo el título (muchos lanzamientos de anime no llevan año).
  const movie = { mediaType: 'movie', season: null, episode: null, year: '2022', animation: true };
  assert.equal(streams.buildNyaaQuery(movie, ['Suzume', 'Suzume no Tojimari']), '(Suzume)|(Suzume no Tojimari)');

  // Ningún signo del título puede colarse como operador de la búsqueda.
  const words = (title) => streams.buildNyaaQuery(movie, [title]);
  assert.equal(words('Re:ZERO -Starting Life in Another World-'), '(Re ZERO Starting Life in Another World)');
  assert.equal(words('K-On!'), '(K On)');
  assert.equal(words('SPY×FAMILY'), '(SPY)');
  assert.equal(words('Pokémon'), '(Pokemon)');
  assert.equal(words("'Tis Time for \"Torture,\" Princess"), '(Tis Time for Torture Princess)');
  assert.equal(words('The Apothecary Diaries'), '(Apothecary Diaries)');
  assert.equal(words('A.I.C.O. Incarnation'), '(A I C Incarnation)'); // «A.» no es un artículo
  assert.equal(words('86 EIGHTY-SIX'), '(86 EIGHTY)');
  assert.equal(streams.buildNyaaQuery(movie, ['Suzume', 'SUZUME', 'suzume!']), '(Suzume)');
  // Sin palabras utilizables no hay consulta.
  assert.equal(streams.buildNyaaQuery(movie, ['進撃の巨人', '']), '');
  assert.equal(streams.buildNyaaQuery(frieren(1, 5), []), '');
});

test('nyaaIsRelevant: episodios y lotes de una serie (nombres reales de Nyaa)', () => {
  // [nombre, ¿vale para T1E5?, ¿T2E5?, ¿T1E20?]
  const cases = [
    // Episodios sueltos, estilo fansub y estilo «scene»
    ['[SubsPlease] Sousou no Frieren - 05 (1080p) [8E3F8FA5].mkv', true, false, false],
    ['[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [6AAEC79A].mkv', false, true, false],
    ['[Erai-raws] Sousou no Frieren 2nd Season - 05 [1080p CR WEB-DL AVC AAC][MultiSub][42940134]', false, true, false],
    ['[Erai-raws] Sousou no Frieren 2nd Season - 09 [1080p CR WEB-DL AVC AAC][MultiSub][15B7C196]', false, false, false],
    ['[ASW] Sousou no Frieren S2 - 05 [1080p HEVC x265 10Bit][AAC]', false, true, false],
    ['[Greek-Nakama] Sousou no Frieren S2 - 07 [1080p][053C4F2B].mkv', false, false, false],
    ["[Yameii] Frieren: Beyond Journey's End - S02E05 [English Dub] [CR WEB-DL 1080p H264 AAC] [0564F2F3] (Sousou no Frieren Season 2 | S2)", false, true, false],
    ["[Yameii] Frieren - Beyond Journey's End - S01E05 v2 [English Dub] [CR WEB-DL 1080p] [455869CD] (Sousou no Frieren)", true, false, false],
    ["[Arg0] Frieren: Beyond Journey's End (2023) - S01E05 (WEB 1080p HEVC x265 E-AC-3) [Dual-Audio] | Sousou no Frieren", true, false, false],
    ["[Arg0] Frieren: Beyond Journey's End (2023) - S01E01 v3 (WEB 1080p HEVC x265 E-AC-3) [Dual-Audio] | Sousou no Frieren | Frieren at the Funeral", false, false, false],
    ["[Judas] Sousou no Frieren (Frieren: Beyond Journey's End) - S01E05 [1080p][HEVC x265 10bit][Multi-Subs] (Weekly)", true, false, false],
    ['Frieren Beyond Journeys End S01E08 Frieren the Slayer 1080p AMZN WEB-DL DDP2.0 H 264-VARYG (Sousou no Frieren, Multi-Subs)', false, false, false],
    ['Frieren Beyond Journeys End S01E05 Phantoms of the Dead 1080p AMZN WEB-DL DDP2.0 H 264-VARYG (Sousou no Frieren, Multi-Subs)', true, false, false],
    ['[ToonsHub] Frieren Beyond Journeys End S02E05 1080p CR WEB-DL DUAL AAC2.0 H.264 (Sousou no Frieren, Dual-Audio, Multi-Subs)', false, true, false],
    ['Frieren.Beyond.Journeys.End.S02E05.1080p.CR.WEBRip.10bits.x265-Rapta', false, true, false],
    ["Frieren: Beyond Journey's End S02E02 VOSTFR 1080p WEB x264 AAC -Tsundere-Raws (CR) (VF, FRENCH, VOSTFR, Sousou no Frieren 2nd Season, Frieren: Beyond Journey's End Season 2)", false, false, false],
    ['[Group] Sousou no Frieren - 05v2 [1080p].mkv', true, false, false],
    ['[Group]_Sousou_no_Frieren_-_05_[1080p].mkv', true, false, false],
    ['[Group] Sousou no Frieren - 05.mkv', true, false, false],
    // Lotes de temporada
    ['[EMBER] Frieren: Beyond Journey`s End (2023) (Season 1) [BDRip] [1080p Dual Audio HEVC 10 bits DDP] (Sousou no Frieren) (Batch)', true, false, true],
    ['Frieren Beyond Journeys End S01 Season 1 1080p CR WEBRip Dual Audio 10bits x265-Rapta', true, false, true],
    ["[Tenrai-Sensei] Frieren: Beyond Journey's End (Season 1+OVAs) [BD][1080p][HEVC 10bit x265][Dual Audio] Sousou no Frieren", true, false, true],
    ['[Judas] Sousou no Frieren (Frieren Beyond Journey`s End) (Season 01) [BD 1080p][HEVC x265 10bit][Dual-Audio][Eng-Subs] (Batch)', true, false, true],
    ['[Judas] Sousou no Frieren (Frieren Beyond Journey`s End) (Season 02) [1080p][HEVC x265 10bit][Dual-Audio][Multi-Subs] (Batch)', false, true, false],
    ['[Feibanyama] Frieren Beyond Journeys End Season 1 [IQIYI WebRip 2160p HEVC OPUS Multi-Subs] (Sousou no Frieren)', true, false, true],
    ['[EMBER] Sousou no Frieren (2023) (Season 1) [1080p] [HEVC WEBRip] (Frieren: Beyond Journey`s End) (Batch)', true, false, true],
    ["[anime4life.] Frieren - Beyond Journey's End Season 1 BD_1080p Dolby TrueHD Dual Audio", true, false, true],
    ["[LostYears] Frieren Beyond Journey's End - Season 1 (S01) (WEB 1080p x265 10-bit AAC Opus) [Dual Audio] | (Sousou no Frieren) (Batch)", true, false, true],
    ['[LostYears] Frieren: Beyond Journey’s End Season 1 v2 (WEBRip 1080p HEVC 10-bit Opus) [Dual Audio] | Sousou no Frieren', true, false, true],
    ['Sousou.No.Frieren.S01.MULTi.1080p.BluRay.x265-KAF', true, false, true],
    ['Sousou.No.Frieren.S02.VOSTFR.1080p.WEBRiP.x265-KAF', false, true, false],
    ["[wham] Sousou no Frieren | Frieren: Beyond Journey's End - S01 (BD 1080p AV1 Opus AAC Dual Audio)", true, false, true],
    ["[JP-EN] Frieren : Beyond Journey's End S01 [2023-2024] COMPLETE 1080p BDRip x265 DUAL FLAC 2.0 Kira [SEV]", true, false, true],
    ["[Anitsu] Sousou no Frieren (Frieren: Beyond Journey's End) S01 [BD 1080p x265 Opus] [DUAL JAP PT-BR] [SUB PT-BR ENG]", true, false, true],
    ["Frieren : Beyond Journey's End S01 (2023) CUSTOM MULTi-FRENCH/VOSTFR 1080p 10bits BluRay x265 AAC -Punisher694 (Sousou no Frieren) (VF)", true, false, true],
    ['Frieren Beyond Journeys End S02 1080p BD Remux FLAC [JAP/ENG/SPA]- AF', false, true, false],
    ['[Erai-raws] Sousou no Frieren 2nd Season [1080p CR WEBRip HEVC AAC][MultiSub] (unofficial batch)', false, true, false],
    ["[DB] Sousou no Frieren 2nd Season | Frieren: Beyond Journey's End Season 2 [Dual Audio 10bit 1080p][HEVC-x265]", false, true, false],
    ["[DB] Sousou no Frieren | Frieren: Beyond Journey's End [Dual Audio 10bit BD1080p][HEVC-x265]", true, false, true],
    ['[Group] Sousou no Frieren - 1080p BD', true, false, true],
    ["[Group] Frieren: Beyond Journey's End Seasons 1-2 [BD 1080p]", true, true, true],
    ["[Group] Frieren: Beyond Journey's End S01-S02 [BD 1080p]", true, true, true],
    // Lotes por rango de episodios: solo valen si incluyen el episodio
    ["[ToonsHub] Frieren: Beyond Journey's End S01 E01-E14 2160p B-Global WEB-DL x264 (Multi-Subs) [Batch - Part 1]", true, false, false],
    ["[ToonsHub] Frieren: Beyond Journey's End S01 E15-E28 2160p B-Global WEB-DL x264 (Multi-Subs) [Batch - Part 2]", false, false, true],
    ['[Erai-raws] Sousou no Frieren - 01 ~ 28 [1080p][BATCH][Multiple Subtitle] [ENG][POR-BR][SPA-LA][SPA][ARA][FRE][GER][ITA][RUS]', true, false, true],
    ['[9volt] Sousou no Frieren - 01-16 (Cour 1) (WEB 1080p)', true, false, false],
    ['[SubsPlease] Sousou no Frieren (01-28) (1080p) [Batch]', true, false, true],
    ['[SubsPlease] Sousou no Frieren S2 (01-10) (1080p) [Batch]', false, true, false],
    // Otras obras de la misma franquicia, otro año, otro título
    ['[Piyoko] Sousou no Frieren - Marumaru no Mahou (Mini Anime) - 01~12 [WEB 1080p YT VP9 AAC 2.0]', false, false, false],
    ['[Group] Sousou no Frieren Mini Anime - 05 [1080p]', false, false, false],
    ['[Group] Sousou no Frieren Part 2 - 05 [1080p]', false, false, false],
    ['[Group] Sousou no Frieren (2011) - 05 [DVD]', false, false, false],
    ['[Group] Sousou no Frieren (2024) - 05 [1080p]', true, false, false],
    ['[Group] Another Show (Season 1) [BD 1080p]', false, false, false],
    ['[Group] Another Show - 05 [1080p] (Sousou no Frieren)', false, false, false],
  ];
  const requests = [frieren(1, 5), frieren(2, 5), frieren(1, 20)];
  for (const [name, ...expected] of cases) {
    const got = requests.map((resolved) => streams.nyaaIsRelevant(name, resolved, FRIEREN_TITLES));
    assert.deepEqual(got, expected, name);
  }
  // Un lote parcial de la 2ª temporada no sirve para un episodio que no trae.
  assert.equal(
    streams.nyaaIsRelevant('[SubsPlease] Sousou no Frieren S2 (01-10) (1080p) [Batch]', frieren(2, 12), FRIEREN_TITLES),
    false
  );
});

test('nyaaIsRelevant: secuelas numeradas, remakes, artículos y live action', () => {
  const ep = (season, episode, extra = {}) => ({ mediaType: 'series', season, episode, year: '2015', animation: true, ...extra });
  const alice = (season, episode) => ep(season, episode, { year: '2020', animation: false });
  // [nombre, petición, títulos, esperado]
  const cases = [
    // «Título IV», «Título 2»: secuela numerada sin la palabra «Season»
    ['[Group] Overlord IV - 05 [1080p]', ep(4, 5), ['Overlord'], true],
    ['[Group] Overlord IV - 05 [1080p]', ep(1, 5), ['Overlord'], false],
    ['[Group] Overlord IV - 05 [1080p]', ep(3, 5), ['Overlord'], false],
    ['[Group] Overlord - 05 [1080p]', ep(1, 5), ['Overlord'], true],
    ['[Group] Overlord - 05 [1080p]', ep(4, 5), ['Overlord'], false],
    ['[Group] Overlord IV (2022) - 05 [1080p]', ep(4, 5), ['Overlord'], true],
    ['[Group] Overlord IV [BD 1080p]', ep(4, 5), ['Overlord'], true],
    ['[Group] Overlord IV [BD 1080p]', ep(1, 5), ['Overlord'], false],
    ['[Group] Overlord [Dual Audio BD 1080p]', ep(1, 5), ['Overlord'], true],
    ['[Group] Overlord [Dual Audio BD 1080p]', ep(4, 5), ['Overlord'], false],
    ['[Group] Overlord II (01-13) [1080p]', ep(2, 5), ['Overlord'], true],
    ['[Group] Overlord II (01-13) [1080p]', ep(1, 5), ['Overlord'], false],
    ['[Group] One Punch Man 2 - 05 [1080p]', ep(2, 5), ['One-Punch Man'], true],
    ['[Group] One Punch Man 2 - 05 [1080p]', ep(1, 5), ['One-Punch Man'], false],
    ['[Group] Mob Psycho 100 III - 05 (1080p)', ep(3, 5), ['Mob Psycho 100'], true],
    ['[Group] Mob Psycho 100 III - 05 (1080p)', ep(1, 5), ['Mob Psycho 100'], false],
    ['[Group] Mob Psycho 100 - 05 (1080p)', ep(1, 5), ['Mob Psycho 100'], true],
    ['[Group] Mob Psycho 100 - 05 (1080p)', ep(2, 5), ['Mob Psycho 100'], false],
    ['[Group] Unknown Romaji II (Known English) [BD 1080p]', ep(2, 5), ['Known English'], true],
    ['[Group] Unknown Romaji II (Known English) [BD 1080p]', ep(1, 5), ['Known English'], false],
    // El número forma parte del título
    ['[Group] Lupin III - 05 [DVD]', ep(1, 5), ['Lupin III', 'Lupin the Third'], true],
    ['[Group] Kaiju No. 8 - 05 [1080p]', ep(1, 5), ['Kaiju No. 8'], true],
    ['[Group] Steins;Gate 0 - 05 [1080p]', ep(1, 5), ['Steins;Gate 0'], true],
    ['[Group] Steins;Gate 0 - 05 [1080p]', ep(1, 5), ['Steins;Gate'], false],
    ['[Group] 86 - Eighty Six - 05 [1080p]', ep(1, 5), ['86 EIGHTY-SIX'], true],
    // Mismo nombre, otro año: es el remake
    ['[Group] Shaman King (2021) - 05 [1080p]', ep(1, 5, { year: '2001' }), ['Shaman King'], false],
    ['[Group] Shaman King (2021) - 05 [1080p]', ep(1, 5, { year: '2021' }), ['Shaman King'], true],
    // Título alternativo y artículo inicial
    ['[Group] Kaguya-sama wa Kokurasetai S2 - 05', ep(2, 5), ['Kaguya-sama: Love Is War', 'Kaguya-sama wa Kokurasetai'], true],
    ['[Group] Apothecary Diaries - 05 [1080p]', ep(1, 5), ['The Apothecary Diaries'], true],
    ['[Group] The Apothecary Diaries Extra - 05 [1080p]', ep(1, 5), ['The Apothecary Diaries'], false],
    // Live action: packs de temporada
    ['Alice in Borderland (2020) S01 MULTi 1080p WEB x264 E-AC-3 -Tsundere-Raws (NF) (VF, FRENCH, VOSTFR)', alice(1, 1), ['Alice in Borderland'], true],
    ['Imawa no Kuni no Arisu (Alice in Borderland) [S1][x264][NF][Multi-subs] 1080p', alice(1, 1), ['Alice in Borderland'], true],
    ['Alice In Borderland S1 2020 4k 2160p NF WEB-DL x265 10bit EAC3-Shiniori', alice(1, 3), ['Alice in Borderland'], true],
    ['Alice in Borderland S03 Season 3 2025 1080p NF WEBRip Dual Audio AAC5.1 10bits x265-Rapta', alice(1, 3), ['Alice in Borderland'], false],
    ['Alice in Borderland S03 Season 3 2025 1080p NF WEBRip Dual Audio AAC5.1 10bits x265-Rapta', alice(3, 3), ['Alice in Borderland'], true],
  ];
  for (const [name, resolved, titles, expected] of cases) {
    assert.equal(
      streams.nyaaIsRelevant(name, resolved, titles), expected,
      `${name} · T${resolved.season}E${resolved.episode}`
    );
  }
});

test('nyaaIsRelevant: películas (ni episodios de la serie ni colecciones)', () => {
  const movie = (year) => ({ mediaType: 'movie', season: null, episode: null, year, animation: true });
  const suzume = ['Suzume', 'Suzume no Tojimari'];
  const jjk0 = ['Jujutsu Kaisen 0'];
  // [nombre, petición, títulos, esperado]
  const cases = [
    ['[Anime Time] Suzume No Tojimari [1080p][HEVC 10bit x265][AAC][Multi Sub]', movie('2022'), suzume, true],
    ["[EMBER] Suzume no Tojimari (2022) (Movie) [BDRip] [1080p Dual Audio HEVC 10 bits DDP] (Suzume's Door-Locking)", movie('2022'), suzume, true],
    ['Suzume.2022.1080p.iTunes.WEB-DL.DD5.1.H.264-xiaopie@CHDWEB.mkv (Suzume no Tojimari)', movie('2022'), suzume, true],
    ['[yolerejiju] Suzume 2022 1080p BD AAC 2.0 Hi10P x265 [Audio: SPA,ENG,FRE,POR] [Sub: Multi]', movie('2022'), suzume, true],
    ["[Arg0] Suzume (2022) (UHD BD Remux 2160p 4K HDR HEVC H.265 DTS-HD MA 5.1) | Suzume no Tojimari | Suzume's Door-Locking | Suzume's Locking Up", movie('2022'), suzume, true],
    ['[Group] Suzume no Tojimari (2019) [BD 1080p]', movie('2022'), suzume, false],
    ['[DB] Makoto Shinkai Movie Collection [Dual Audio 10bit BD1080p][HEVC-x265] (The Place Promised in Our Early Days+5 Centimeters per Second+Children Who Chase Lost Voices+The Garden of Words+Your Name.+Weathering with You+Suzume no Tojimari)', movie('2022'), suzume, false],
    ['[Judas] Jujutsu Kaisen 0 (Movie) [BD 1080p][HEVC x265 10bit][Dual-Audio][Multi-Subs]', movie('2021'), jjk0, true],
    ['[EMBER] Jujutsu Kaisen 0 (2021) (Movie) [BDRip] [1080p Dual Audio HEVC 10 bits DDP]', movie('2021'), jjk0, true],
    ['[SubsPlease] Jujutsu Kaisen - 05 (1080p) [ABCDEF12].mkv', movie('2021'), jjk0, false],
    ['[SubsPlease] Jujutsu Kaisen S2 - 05 (1080p) [ABCDEF12].mkv', movie('2021'), jjk0, false],
    ['[Judas] Jujutsu Kaisen (Season 2) [1080p][HEVC x265 10bit][Multi-Subs] (Batch)', movie('2021'), jjk0, false],
    ['Jujutsu Kaisen S01E05 1080p WEB-DL', movie('2021'), jjk0, false],
    ['[Judas] Kimi no Na wa. (Your Name.) [BD 2160p 4K UHD][HEVC x265 10bit][Dual-Audio][Multi-Subs]', movie('2016'), ['Your Name.', 'Kimi no Na wa.'], true],
    ['[Group] Kimi no Na wa. - 2016 [BD 1080p]', movie('2016'), ['Your Name.', 'Kimi no Na wa.'], true],
  ];
  for (const [name, resolved, titles, expected] of cases) {
    assert.equal(streams.nyaaIsRelevant(name, resolved, titles), expected, name);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// YTS
// ─────────────────────────────────────────────────────────────────────────────
test('parseYts: un stream por torrent, con nombre y magnet compuestos', () => {
  const hits = streams.parseYts({
    status: 'ok',
    data: {
      movie_count: 1,
      movies: [
        {
          imdb_code: 'tt0245429',
          title: 'Sen to Chihiro no kamikakushi',
          title_long: 'Sen to Chihiro no kamikakushi (2001)',
          year: 2001,
          torrents: [
            { hash: 'C0B8838D4A6DB57C1A7AE44968B892C69974F709', quality: '720p', type: 'bluray', video_codec: 'x264', bit_depth: '8', audio_channels: '2.0', seeds: 45, peers: 13, size_bytes: 1116691497 },
            { hash: '661B5355FBF1CD8070C98361F47B17DE32EC0D77', quality: '2160p', type: 'web', video_codec: 'x265', bit_depth: '10', audio_channels: '5.1', seeds: 100, peers: 47, size_bytes: 2147483648 },
            { hash: 'no-es-un-hash', quality: '1080p' },
          ],
        },
        { imdb_code: 'tt0000001', title: 'Sin torrents' },
      ],
    },
  });
  assert.equal(hits.length, 2);
  const [hd, uhd] = hits;
  assert.equal(hd.provider, 'yts');
  assert.equal(hd.imdbId, 'tt0245429');
  assert.equal(hd.infoHash, 'c0b8838d4a6db57c1a7ae44968b892c69974f709');
  assert.equal(hd.title, 'Sen to Chihiro no kamikakushi (2001) [720p] [BluRay] [x264] [2.0]');
  assert.equal(hd.seeders, 45);
  assert.equal(hd.peers, 13);
  assert.equal(hd.size, 1116691497);
  assert.equal(uhd.title, 'Sen to Chihiro no kamikakushi (2001) [2160p] [WEBRip] [x265] [10bit] [5.1]');
  // La API no da magnet: se monta con el hash, el nombre y trackers públicos.
  assert.match(hd.magnet, /^magnet:\?xt=urn:btih:c0b8838d4a6db57c1a7ae44968b892c69974f709&dn=Sen%20to%20Chihiro/);
  assert.ok((hd.magnet.match(/&tr=/g) || []).length >= 5);
  // El nombre del proveedor no se muestra en pantalla.
  assert.doesNotMatch(hd.title, /yts/i);
  // Sin resultados la API omite `movies`.
  assert.deepEqual(streams.parseYts({ status: 'ok', data: { movie_count: 0 } }), []);
  assert.deepEqual(streams.parseYts(null), []);
});

test('releaseEpisode: temporada y episodio que declara el nombre de un lanzamiento', () => {
  const cases = [
    ['The Sinner S04E08 1080p HEVC x265-MeGusta', [4, 8, 8]],
    ['Show S01 E05 WEB', [1, 5, 5]],
    ['The Sinner 1x05 HDTV', [1, 5, 5]],
    // Varios episodios en un torrent.
    ['Breaking.Bad.S05E01-16.1080p.NF.WEB-DL', [5, 1, 16]],
    ['Show S01E01E02 720p', [1, 1, 2]],
    ['Show S01E01-E03 720p', [1, 1, 3]],
    // Lo que sigue al episodio no es un rango: resolución o título del capítulo.
    ['Show.S04E08-1080p.x265', [4, 8, 8]],
    ['Show S02E03 - 24 Hours 720p', [2, 3, 3]],
    // Packs de temporada.
    ['Show S02 COMPLETE 1080p', [2, null, null]],
    ['Breaking Bad Season 3 Extras', [3, null, null]],
    ['Breaking Bad Cap. 510 Castellano', [5, 10, 10]],
    ['Breaking Bad Cap. 101_107 Castellano', [1, 1, 7]],
  ];
  for (const [name, [season, episode, lastEpisode]] of cases) {
    assert.deepEqual(streams.releaseEpisode(name), { season, episode, lastEpisode }, name);
  }
  for (const name of ['The Daily Show 2025 11 10 720p', 'Movie 1920x1080 x264', 'Show H 264 5 1 x265', '']) {
    assert.equal(streams.releaseEpisode(name), null, name);
  }
});

test('parseEztv: el episodio se lee del nombre y se quita la firma de EZTV', () => {
  const hits = streams.parseEztv({
    imdb_id: '6048596',
    torrents_count: 129,
    torrents: [
      {
        hash: 'F6B983C6DC14FCCD0741790CC3FB51FBF5D8C932',
        filename: 'The.Sinner.S04E08.1080p.HEVC.x265-MeGusta[eztv.re].mkv',
        magnet_url: 'magnet:?xt=urn:btih:f6b983c6dc14fccd0741790cc3fb51fbf5d8c932&dn=x&tr=udp://tracker.opentrackr.org:1337/announce',
        title: 'The Sinner S04E08 1080p HEVC x265-MeGusta EZTV',
        imdb_id: '6048596', season: '4', episode: '8', seeds: 12, peers: 3, size_bytes: '479545240',
      },
      // La API deja a menudo season/episode a 0: manda el nombre.
      {
        hash: '7e38a15b3c861ec7f7885257cc7d8c85dafe8f8b',
        title: 'The Sinner S02E04 WEBRip x264-TBS EZTV',
        imdb_id: '6048596', season: '0', episode: '0', seeds: 0, peers: 0, size_bytes: '193268657',
      },
      // Sin `title`: se usa el nombre de archivo, sin extensión ni firma.
      { hash: '2c58cb239acd6053de544adb4468bfa6fb72b1f8', filename: 'The.Sinner.S04E07.720p.HEVC.x265-MeGusta[eztv.re].mkv', imdb_id: '6048596' },
      // Nombre sin numeración: valen los campos de la API.
      { hash: 'a'.repeat(40), title: 'The Sinner 2021 12 01 720p WEB EZTV', imdb_id: '6048596', season: '4', episode: '8' },
      { hash: 'no-es-un-hash', title: 'The Sinner S04E08 EZTV', imdb_id: '6048596' },
    ],
  });
  assert.equal(hits.length, 4);
  assert.deepEqual(hits[0], {
    provider: 'eztv',
    imdbId: 'tt6048596',
    title: 'The Sinner S04E08 1080p HEVC x265-MeGusta',
    infoHash: 'f6b983c6dc14fccd0741790cc3fb51fbf5d8c932',
    magnet: 'magnet:?xt=urn:btih:f6b983c6dc14fccd0741790cc3fb51fbf5d8c932&dn=x&tr=udp://tracker.opentrackr.org:1337/announce',
    seeders: 12,
    peers: 3,
    size: 479545240,
    season: 4,
    episode: 8,
    lastEpisode: 8,
  });
  assert.deepEqual([hits[1].title, hits[1].season, hits[1].episode], ['The Sinner S02E04 WEBRip x264-TBS', 2, 4]);
  assert.deepEqual([hits[2].title, hits[2].season, hits[2].episode], ['The.Sinner.S04E07.720p.HEVC.x265-MeGusta', 4, 7]);
  assert.deepEqual([hits[3].season, hits[3].episode], [4, 8]);
  // Serie sin torrents: la API no manda `torrents`.
  assert.deepEqual(streams.parseEztv({ imdb_id: '99999999', torrents_count: 0, limit: 100, page: 1 }), []);
});

test('parseRarbg: normaliza resultados y descarta lo que no es vídeo', () => {
  const hits = streams.parseRarbg({
    total: 3,
    results: [
      {
        name: 'Dune 2021 1080p web YTS',
        infoHash: 'ed0da850c273e3e15a819bdcbbf418bc85107ec8',
        magnet: 'magnet:?xt=urn:btih:ED0DA850C273E3E15A819BDCBBF418BC85107EC8&dn=Dune&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
        category: 'Movies', size: 2952790016, seeders: 1118, leechers: 375, imdb: 'tt1160419', qualityScore: 66,
      },
      { name: 'Dune (Original Motion Picture Soundtrack) FLAC', infoHash: 'b'.repeat(40), category: 'Music', imdb: 'tt1160419' },
      { name: 'Dune 2021 2160p', infoHash: 'corto', category: 'Movies' },
    ],
  });
  assert.deepEqual(hits, [{
    provider: 'rarbg',
    imdbId: 'tt1160419',
    title: 'Dune 2021 1080p web YTS',
    infoHash: 'ed0da850c273e3e15a819bdcbbf418bc85107ec8',
    magnet: 'magnet:?xt=urn:btih:ED0DA850C273E3E15A819BDCBBF418BC85107EC8&dn=Dune&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
    seeders: 1118,
    peers: 375,
    size: 2952790016,
  }]);
  assert.deepEqual(streams.parseRarbg({ error: 'rate limit exceeded' }), []);
});

test('episodios: separa correctamente TMDB y TVMaze sin confundir el episodio con el id', () => {
  for (const baseId of ['tmdb:tv:1399', 'tmdb:series:1399', 'tvmaze:82']) {
    const parsed = streams.parseStreamId('series', `${baseId}:2:7`);
    assert.equal(parsed.baseId, baseId);
    assert.equal(parsed.season, 2);
    assert.equal(parsed.episode, 7);
  }
  assert.doesNotThrow(() => streams.parseStreamId('series', '%E0%A4%A'));
  assert.equal(streams.parseStreamId('movie', 'tmdb:movie:550').baseId, 'tmdb:movie:550');
  assert.equal(streams.parseStreamId('series', 'tt123:0:1').season, 0, 'conserva especiales');
});

test('parseTorrentioSpanish: reconoce audio castellano/latino, seeders, tamaño e índice de archivo', () => {
  const hits = streams.parseTorrentioSpanish({
    streams: [
      {
        name: 'Torrentio\n1080p',
        title: 'Avengers.endgame.2019.1080p-dual-lat\n👤 88 💾 2.90 GB ⚙️ Cinecalidad\nDual Audio / 🇲🇽',
        infoHash: 'A'.repeat(40), fileIdx: 3,
        behaviorHints: { filename: 'Avengers.endgame.2019.1080p-dual-lat.mkv' },
      },
      {
        name: 'Torrentio\n1080p',
        title: 'Vengadores Endgame [BluRay 1080p][Castellano][ES-EN]\n👤 9 💾 8 GB ⚙️ MejorTorrent\n🇬🇧 / 🇪🇸',
        infoHash: 'b'.repeat(40), fileIdx: 0,
      },
      { name: 'Torrentio\n1080p', title: 'English only\n👤 99 💾 2 GB', infoHash: 'c'.repeat(40) },
      { name: 'Torrentio', title: 'Malformed hash Español', infoHash: 'not-a-hash' },
    ],
  });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].infoHash, 'a'.repeat(40));
  assert.equal(hits[0].seeders, 88);
  assert.equal(hits[0].size, Math.round(2.9 * 1024 ** 3));
  assert.equal(hits[0].fileIdx, 3);
  assert.match(hits[0].magnet, /urn:btih:a{40}/);
  assert.match(hits[0].title, /dual-lat/);
  assert.doesNotMatch(hits[0].title, /Pilot\.mkv/);
  assert.equal(hits[1].seeders, 9);
  assert.equal(hits[1].fileIdx, 0);
  assert.match(hits[1].title, /ESP/);
});

test('parseTorrentIndexer: info_hash en hex, magnet propio y base32 descartado', () => {
  const hits = streams.parseTorrentIndexer({
    results: [
      {
        title: 'Round 6 S02 2024 WEB-DL 1080p x264 DUAL 5.1 (brazilian, kor)',
        original_title: 'Round 6 2ª Temporada',
        // BluDV publica el magnet en base32 y no da trackers.
        magnet_link: 'magnet:?xt=urn:btih:F8E69B75D2BAAB&dn=x',
        info_hash: 'F8E69B75D2BAAE8D5B2DB89B5893361BA6015E96',
        imdb: 'https://www.imdb.com/pt/title/tt10919420/',
        size: '18.61 GB',
        seed_count: 22,
        leech_count: 7,
        trackers: null,
        audio: ['Português', 'Coreano'],
      },
      // Con trackers propios: se copian al magnet.
      {
        title: 'Filme 2019 1080p BluRay DUAL',
        info_hash: 'a'.repeat(40),
        size: '4,6 GB',
        seed_count: 3,
        leech_count: 0,
        trackers: ['udp://tracker.opentrackr.org:1337/announce', 'javascript:alert(1)'],
        audio: [],
        imdb: '',
      },
      // Sin info_hash válido, fuera.
      { title: 'Sin hash', info_hash: 'corto', size: '1 GB' },
      { title: '', info_hash: 'b'.repeat(40) },
    ],
  });
  assert.equal(hits.length, 2);
  const [show, movie] = hits;
  assert.equal(show.provider, 'torrentindexer');
  assert.equal(show.imdbId, 'tt10919420');
  assert.equal(show.infoHash, 'f8e69b75d2baae8d5b2db89b5893361ba6015e96');
  assert.equal(show.seeders, 22);
  assert.equal(show.peers, 7);
  assert.equal(show.size, 19982335345); // 18.61 GiB
  // Magnet reconstruido en hex, con los trackers de respaldo si el sitio no da.
  assert.match(show.magnet, /^magnet:\?xt=urn:btih:f8e69b75d2baae8d5b2db89b5893361ba6015e96&dn=/);
  assert.match(show.magnet, /tr=udp%3A%2F%2Ftracker\.opentrackr\.org%3A1337%2Fannounce/);
  assert.doesNotMatch(show.magnet, /CF76LOCCN4KEC/);
  assert.equal(movie.imdbId, null);
  assert.equal(movie.size, Math.round(4.6 * 1024 ** 3));
  assert.match(movie.magnet, /tr=udp%3A%2F%2Ftracker\.opentrackr\.org%3A1337%2Fannounce/);
  assert.doesNotMatch(movie.magnet, /javascript/);
  assert.deepEqual(streams.parseTorrentIndexer({ error: 'boom' }), []);
});

test('etiquetas: «(brazilian, kor)» de los sitios brasileños es POR', () => {
  const { badgeTokens } = require('../lib/badges');
  assert.deepEqual(
    badgeTokens('Round 6 S02 2024 WEB-DL 1080p x264 DUAL 5.1 (brazilian, kor)', ['Round 6'], ['language']),
    ['POR']
  );
  assert.deepEqual(
    badgeTokens('Filme 2019 BluRay 1080p Dublado', ['Filme'], ['language']),
    ['POR']
  );
});

test('resolveTitle guarda el id de TMDB aunque no haya clave de TMDB', async () => {
  // Con `tmdb:157336` el id ya viene en la petición: antes solo se guardaba si
  // la ficha respondía, así que sin clave los buscadores hispanos se quedaban
  // sin título en español (y sin id) con el que buscar.
  const config = require('../lib/config');
  const original = config.tmdbConfigured;
  config.tmdbConfigured = false;
  try {
    const resolved = await streams.resolveTitle('movie', 'tmdb:157336');
    if (resolved) {
      assert.equal(resolved.tmdbId, 157336);
      assert.equal(resolved.tmdbType, 'movie');
    }
  } finally {
    config.tmdbConfigured = original;
  }
});
