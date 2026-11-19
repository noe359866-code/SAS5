'use strict';

/**
 * Pruebas del adaptador de animeflv.or.at.
 *
 * Los HTML de `test/fixtures/sites/animeflv-*.html` son recortes reales
 * medidos el 19-11-2026 con `scripts/sites-probe.mjs`, con el marcado y los
 * `data-src` en base64 tal como los sirve el sitio. No hay red: `fetch` se
 * sustituye por un mapa de rutas.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');

const animeflv = require('../lib/sites/animeflv');
const { isDirectMedia } = require('../lib/directMedia');
const cache = require('../lib/cache');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'sites', name), 'utf8');
const FICHA = fixture('animeflv-ficha.html');
const EPISODIO = fixture('animeflv-episodio.html');

const BASE = 'https://animeflv.or.at';
const FICHA_URL = `${BASE}/anime/ao-ashi-season-2/`;
// El recorte real lista los episodios 7, 6 y 5 (primero el más nuevo).
const EP_URL = `${BASE}/2026/11/15/ao-ashi-season-2-episodio-7/`;
const HLS = 'https://player.zilla-networks.com/m3u8/6db32c99cc153255de897d502f9cd079';

const SHOW = { title: 'Ao Ashi Season 2', year: 2022, mediaType: 'series', season: 2, episode: 7 };

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

function stub(routes) {
  cache.deletePrefix('animeflv:');
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [needle, reply] of routes) {
      if (!target.includes(needle)) continue;
      return typeof reply === 'function' ? reply(target) : reply;
    }
    return new Response('', { status: 404 });
  };
  return { calls, restore: () => { global.fetch = original; } };
}

// ── Interpretación del HTML real ──────────────────────────────────────────

test('animeflv: el slug sale del título y el og:title se limpia del SEO', () => {
  assert.equal(animeflv.slugify('Ao Ashi Season 2'), 'ao-ashi-season-2');
  assert.equal(animeflv.slugify('Shingeki no Kyojin: The Final'), 'shingeki-no-kyojin-the-final');
  assert.equal(animeflv.titleFromOg('Ver Ao Ashi Season 2 Online Sub Español - AnimeFLV'), 'Ao Ashi Season 2');
  assert.equal(animeflv.titleFromOg(''), '');
});

test('animeflv: la ficha se identifica por su h1, sin aceptar otro título', () => {
  const $ = load(FICHA);
  assert.equal(animeflv.matchDetail($, { title: 'Ao Ashi Season 2', altTitle: null }), true);
  assert.equal(animeflv.matchDetail($, { title: 'Blue Lock', altTitle: null }), false);
  assert.equal(animeflv.matchDetail($, { title: 'Ao Ashi', altTitle: null }), false);
});

test('animeflv: la temporada se lee del título de la ficha', () => {
  assert.equal(animeflv.seasonOf('Ao Ashi Season 2'), 2);
  assert.equal(animeflv.seasonOf('Black Clover 2nd Season'), 2);
  assert.equal(animeflv.seasonOf('Naruto'), null);
});

test('animeflv: los episodios salen del JSON embebido y se eligen por número', () => {
  const list = animeflv.episodesOf(FICHA);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((entry) => entry.number), [7, 6, 5]);
  assert.equal(animeflv.pickEpisode(list, { episode: 7 }).permalink.endsWith('ao-ashi-season-2-episodio-7/'), true);
  assert.equal(animeflv.pickEpisode(list, { episode: 1 }), null);
});

test('animeflv: los servidores salen del base64 de data-src, sin duplicados', () => {
  const servers = animeflv.serversOf(EPISODIO);
  assert.deepEqual(servers.map((server) => server.name), ['HLS', 'UPNShare', 'Voe', 'Byse', 'MP4Upload']);
  assert.equal(servers[0].url, HLS);
  assert.equal(servers.every((server) => /^https:\/\//.test(server.url)), true);
  assert.equal(servers.every((server) => server.audio === 'Sub'), true);
});

test('animeflv: «Sub» se publica como Subtitulado y un doblaje no se disfraza', () => {
  assert.equal(animeflv.audioOf({ audio: 'Sub', name: 'HLS' }), 'Subtitulado');
  assert.equal(animeflv.audioOf({ audio: 'Latino', name: 'HLS' }), 'Latino');
  assert.equal(animeflv.audioOf({ audio: 'Castellano', name: 'Byse' }), 'Castellano');
  // Sin etiqueta explícita se declara lo que el sitio dice de sí mismo: sub.
  assert.equal(animeflv.audioOf({}), 'Subtitulado');
});

test('animeflv: el manifiesto sin extensión se acepta solo en el host del player', () => {
  assert.deepEqual(animeflv.hlsByPath(HLS), { url: HLS, kind: 'hls' });
  assert.equal(animeflv.hlsByPath('https://player.zilla-networks.com/m3u8/'), null);
  assert.equal(animeflv.hlsByPath('https://player.zilla-networks.com.evil.test/m3u8/6db32c99cc153255de897'), null);
  assert.equal(animeflv.hlsByPath('https://otro.example/m3u8/6db32c99cc153255de897'), null);
});

// ── Recorrido completo ────────────────────────────────────────────────────

test('animeflv serie: ficha → episodio → HLS directo del player propio', async () => {
  const stubbed = stub([
    [`${BASE}/anime/ao-ashi-season-2/`, html(FICHA)],
    [EP_URL, html(EPISODIO)],
  ]);
  try {
    const out = await animeflv.searchAnimeFlv('Ao Ashi Season 2', SHOW, SHOW.title, 5000);
    assert.equal(out.hits.length, 1);
    const hit = out.hits[0];
    assert.equal(hit.provider, 'animeflv');
    assert.equal(hit.url, HLS);
    assert.equal(hit.quality, 'HLS');
    assert.equal(hit.audioLabel, 'Subtitulado');
    assert.match(hit.title, /S2E7/);
    // El registro descarta lo que no parece medio directo: el HLS sin
    // extensión del player propio tiene que pasar ese filtro.
    assert.equal(isDirectMedia(hit.url), true);
    // El HLS se publica por su forma: no se pide el manifiesto ni se abren los
    // visores opacos que iban detrás en la lista.
    assert.deepEqual(stubbed.calls, [FICHA_URL, EP_URL]);
  } finally { stubbed.restore(); }
});

test('animeflv: el enlace del player propio llega al registro y se publica', async () => {
  const stubbed = stub([
    [`${BASE}/anime/ao-ashi-season-2/`, html(FICHA)],
    [EP_URL, html(EPISODIO)],
  ]);
  const streams = require('../lib/streams');
  const original = streams.SEARCHERS.animeflv;
  try {
    // El adaptador real a través del registro: aquí se aplicaba el filtro que
    // dejaba a la fuente con `raw:1, accepted:0` y sin ningún stream visible.
    streams.SEARCHERS.animeflv = animeflv.searchAnimeFlv;
    const report = {};
    const hits = await streams.runProviders(['animeflv'], 'Ao Ashi S02E07', SHOW, SHOW.title, report, 5000, { ignorePause: true });
    assert.equal(report.animeflv.raw, 1);
    assert.equal(report.animeflv.accepted, 1);
    assert.deepEqual(hits.map((hit) => hit.url), [HLS]);
  } finally {
    streams.SEARCHERS.animeflv = original;
    stubbed.restore();
  }
});

test('animeflv: con el título base de TMDB se llega a la ficha de la temporada', async () => {
  // TMDB devuelve «Ao Ashi» y la temporada por separado; el sitio la publica
  // como una obra aparte («Ao Ashi Season 2»).
  const stubbed = stub([
    ['/anime/ao-ashi', (url) => (url === FICHA_URL ? html(FICHA) : new Response('', { status: 404 }))],
    [EP_URL, html(EPISODIO)],
  ]);
  const TMDB_SHOW = { title: 'Ao Ashi', altTitle: null, mediaType: 'series', season: 2, episode: 7 };
  try {
    const out = await animeflv.searchAnimeFlv('Ao Ashi', TMDB_SHOW, 'Ao Ashi', 5000);
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].url, HLS);
    // Se intenta primero el slug del título base y después el de la temporada.
    assert.deepEqual(stubbed.calls.slice(0, 2), [`${BASE}/anime/ao-ashi/`, FICHA_URL]);
  } finally { stubbed.restore(); }
});

test('animeflv: una temporada que no cuadra con la ficha no se abre', async () => {
  const stubbed = stub([[`${BASE}/anime/ao-ashi-season-2/`, html(FICHA)]]);
  try {
    const out = await animeflv.searchAnimeFlv('Ao Ashi Season 2', { ...SHOW, season: 1 }, SHOW.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-match');
    // Se prueba la ficha y, como no cuadra, no se abre ningún episodio.
    assert.ok(!stubbed.calls.some((url) => url.includes('/2026/')));
  } finally { stubbed.restore(); }
});

test('animeflv: el episodio pedido que la ficha no lista no inventa hits', async () => {
  const stubbed = stub([[`${BASE}/anime/ao-ashi-season-2/`, html(FICHA)]]);
  try {
    const out = await animeflv.searchAnimeFlv('Ao Ashi Season 2', { ...SHOW, episode: 1 }, SHOW.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-episode');
    assert.ok(!stubbed.calls.some((url) => url.includes('/2026/')));
  } finally { stubbed.restore(); }
});

test('animeflv: si solo hay visores opacos se cuentan y no se abren', async () => {
  // Se quitan los dos servidores con medio (HLS propio y Byse) y quedan los
  // opacos tal como los publica el sitio, con su base64 real.
  const { load: parse } = require('cheerio');
  const $ = parse(EPISODIO);
  const keep = new Set(['UPNShare', 'Voe', 'MP4Upload']);
  $('.iframe_code').each((_, el) => {
    const node = $(el);
    const name = node.closest('.button-container').find('.tooltip-text').first().text().trim();
    if (!keep.has(name)) node.closest('.button-container').remove();
  });
  const stubbed = stub([
    [`${BASE}/anime/ao-ashi-season-2/`, html(FICHA)],
    [EP_URL, html($.html())],
  ]);
  try {
    const out = await animeflv.searchAnimeFlv('Ao Ashi Season 2', SHOW, SHOW.title, 5000);
    assert.deepEqual(out.hits, []);
    assert.equal(out.reason, 'no-extractable-embed');
    assert.equal(out.notes.opaque, 3);
    // Ni Voe ni MP4Upload ni UPNShare se abren.
    assert.ok(!stubbed.calls.some((url) => /voe\.sx|mp4upload|uns\.bio/.test(url)));
  } finally { stubbed.restore(); }
});

test('animeflv: si el slug deducido no es el real, el buscador del sitio da la ficha', async () => {
  // Caso real del sitio: `BanG Dream! Yume∞Mita` se publica como
  // `/anime/bang-dream-yume%e2%88%9emita/`, que no es su slug deducido.
  const ficha = `<html><head><meta property="og:title" content="Ver BanG Dream! Yume\u221eMita Online Sub Espa\u00f1ol - AnimeFLV"></head>
    <body><h1 class="anime-title">BanG Dream! Yume\u221eMita</h1>
    <script class="animeflv-episodes-data">[{"post_id":9,"permalink":"${BASE}/2026/11/01/bang-dream-yume-episodio-3/","number":3,"range":1}]</script></body></html>`;
  const episodio = `<html><body><div class="iframe_btn_row server-frames"><div class="button-container">
    <span class="tooltip-text">HLS</span><button class="iframe_code server_btn" app_type="Sub"
    data-src="${Buffer.from(HLS).toString('base64')}">OPCIÓN 1</button></div></div></body></html>`;
  const listing = `<html><body>
    <a href="/anime/ao-ashi-season-2/" title="Ao Ashi Season 2 Anime">Ao Ashi Season 2 Anime</a>
    <a href="/anime/bang-dream-yume%e2%88%9emita/" title="BanG Dream! Yume\u221eMita Anime">BanG Dream! Yume\u221eMita Anime</a>
  </body></html>`;
  const stubbed = stub([
    [`${BASE}/anime/bang-dream-yume-mita/`, new Response('', { status: 404 })],
    [`${BASE}/search/`, html(listing)],
    [`${BASE}/anime/bang-dream-yume%e2%88%9emita/`, html(ficha)],
    [`${BASE}/2026/11/01/bang-dream-yume-episodio-3/`, html(episodio)],
  ]);
  try {
    const resolved = { title: 'BanG Dream! Yume\u221eMita', year: 2026, mediaType: 'series', season: 1, episode: 3 };
    const out = await animeflv.searchAnimeFlv(resolved.title, resolved, resolved.title, 6000);
    assert.ok(stubbed.calls.some((url) => url.includes('/search/')), 'se consultó el buscador');
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].url, HLS);
  } finally { stubbed.restore(); }
});

test('animeflv: sin identidad resuelta no se hacen peticiones', async () => {
  const stubbed = stub([]);
  try {
    assert.deepEqual(await animeflv.searchAnimeFlv('x', null, 'x', 5000), { skipped: 'identity-required' });
    assert.deepEqual(await animeflv.searchAnimeFlv('x', { ...SHOW, episode: 0 }, SHOW.title, 5000), { skipped: 'episode-required' });
    assert.equal(stubbed.calls.length, 0);
  } finally { stubbed.restore(); }
});
