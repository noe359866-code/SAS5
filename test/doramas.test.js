'use strict';

/** Proveedores de doramas incorporados el 24-11-2026. */
const test = require('node:test');
const assert = require('node:assert');
const doramasyt = require('../lib/sites/doramasyt');
const seriesbl = require('../lib/sites/seriesbl');

const HLS = 'https://edge1-waw-sprintcdn.r66nv9ed.com/hls2/10/12047/abc_x/master.m3u8';
const DYT = { title: 'Qué le ocurre a la secretaria Kim', altTitle: "What's Wrong with Secretary Kim?", year: '2018', mediaType: 'series', season: 1, episode: 16 };
const SBL = { title: 'ABO Desire', altTitle: null, year: '2025', mediaType: 'series', season: 1, episode: 1 };

const DYT_LIST = `<html><body><a href="/dorama/whats-wrong-with-secretary-kim-latino-sub-espanol" title="Ver Qué le ocurre a la secretaria Kim Latino online - Dorama en español HD">Qué le ocurre a la secretaria Kim Latino</a></body></html>`;
const DYT_DETAIL = `<html><body><h1>Qué le ocurre a la secretaria Kim Latino</h1>
<p>Fecha de emisión: 06 de Junio de 2018</p>
<p>Nombre alternativo: What's Wrong with Secretary Kim? Audio Latino</p>
<a href="/ver/whats-wrong-with-secretary-kim-latino-episodio-16">Capítulo 16</a></body></html>`;
const DYT_EPISODE = '<html><body><button data-player="token-abc">filemoon</button></body></html>';
const DYT_PLAYER = `<html><body><iframe src="${HLS}"></iframe></body></html>`;

const SBL_LIST = '<html><body><a href="/series/abo-desire/" title="Ver ABO Desire Online Sub Español | Series BL">ABO Desire</a></body></html>';
const SBL_DETAIL = `<html><body><h1>Ver ABO Desire Online Sub Español | Series BL</h1>
<p>Fecha de emisión: 2025</p>
<a href="/episode/abo-desire-1x1/">Episodio 1</a></body></html>`;
const SBL_EPISODE = `<html><body><li class="dooplay_player_option" data-post="123" data-nume="1" data-type="tv">Ver Online</li></body></html>`;

const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

function stub(routes) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [needle, reply] of routes) {
      if (!target.includes(needle)) continue;
      return reply(target);
    }
    return new Response('', { status: 404 });
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test('doramasyt: parsing de ficha, año, audio y jugadores', () => {
  assert.deepEqual(doramasyt.detailTitle(DYT_DETAIL), ['Qué le ocurre a la secretaria Kim', "What's Wrong with Secretary Kim?"]);
  assert.equal(doramasyt.detailYear(DYT_DETAIL), 2018);
  assert.equal(doramasyt.audioOf(DYT_DETAIL, '/dorama/whats-wrong-with-secretary-kim-latino-sub-espanol'), 'Latino');
  assert.equal(doramasyt.listingMatches(DYT_LIST, DYT).length, 1);
  assert.equal(doramasyt.episodesOf(DYT_DETAIL, doramasyt.BASE)[0].number, 16);
  assert.deepEqual(doramasyt.playersOf(DYT_EPISODE), ['token-abc']);
  assert.equal(doramasyt.iframeOf(DYT_PLAYER, `${doramasyt.BASE}/reproductor`), HLS);
});

test('doramasyt: búsqueda → ficha → data-player → HLS con audio latino', async () => {
  const stubbed = stub([
    ['/buscar?q=', () => html(DYT_LIST)],
    ['/dorama/whats-wrong-with-secretary-kim-latino-sub-espanol', () => html(DYT_DETAIL)],
    ['/ver/whats-wrong-with-secretary-kim-latino-episodio-16', () => html(DYT_EPISODE)],
    ['/reproductor?video=token-abc', () => html(DYT_PLAYER)],
  ]);
  try {
    const out = await doramasyt.searchDoramasYt('secretaria kim', DYT, DYT.title, 5000);
    assert.equal(out.hits?.length, 1, out.reason);
    assert.equal(out.hits[0].provider, 'doramasyt');
    assert.equal(out.hits[0].url, HLS);
    assert.equal(out.hits[0].audioLabel, 'Latino');
    assert.equal(out.hits[0].quality, 'HLS');
    assert.match(out.hits[0].title, /S1E16 DoramasYT$/);
    assert.ok(stubbed.calls.some((url) => url.includes('/buscar?q=')));
    assert.ok(stubbed.calls.some((url) => url.includes('/reproductor?video=token-abc')));
  } finally { stubbed.restore(); }
});

test('seriesbl: parsing de DooPlay y episodios SxE', () => {
  assert.equal(seriesbl.detailTitle(SBL_DETAIL), 'ABO Desire');
  assert.equal(seriesbl.detailYear(SBL_DETAIL), 2025);
  assert.equal(seriesbl.audioOf(SBL_DETAIL), 'Subtitulado');
  assert.equal(seriesbl.listingMatches(SBL_LIST, SBL).length, 1);
  assert.deepEqual(seriesbl.episodesOf(SBL_DETAIL, seriesbl.BASE), [{ season: 1, episode: 1, url: 'https://seriesbl.net/episode/abo-desire-1x1/' }]);
  assert.deepEqual(seriesbl.playersOf(SBL_EPISODE), [{ post: '123', nume: '1', type: 'tv', label: 'Ver Online' }]);
});

test('seriesbl: DooPlay AJAX publica el HLS con la ficha identificada', async () => {
  const stubbed = stub([
    ['/seriesbl.net/?s=', () => html(SBL_LIST)],
    ['/seriesbl.net/series/abo-desire/', () => html(SBL_DETAIL)],
    ['/seriesbl.net/episode/abo-desire-1x1/', () => html(SBL_EPISODE)],
    ['admin-ajax.php', () => json({ embed_url: HLS })],
  ]);
  try {
    const out = await seriesbl.searchSeriesBl('abo desire', SBL, SBL.title, 5000);
    assert.equal(out.hits?.length, 1, out.reason);
    assert.equal(out.hits[0].provider, 'seriesbl');
    assert.equal(out.hits[0].url, HLS);
    assert.equal(out.hits[0].audioLabel, 'Subtitulado');
    assert.match(out.hits[0].title, /S1E1 SeriesBL$/);
    assert.ok(stubbed.calls.some((url) => url.includes('admin-ajax.php')));
  } finally { stubbed.restore(); }
});
