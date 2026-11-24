'use strict';

/** Proveedor de doramas/series BL incorporado el 24-11-2026. */
const test = require('node:test');
const assert = require('node:assert');
const seriesbl = require('../lib/sites/seriesbl');

const HLS = 'https://edge1-waw-sprintcdn.r66nv9ed.com/hls2/10/12047/abc_x/master.m3u8';
const RESOLVED = { title: 'ABO Desire', altTitle: null, year: '2025', mediaType: 'series', season: 1, episode: 1 };

const LIST = '<html><body><a href="/series/abo-desire/" title="Ver ABO Desire Online Sub Español | Series BL">ABO Desire</a></body></html>';
const DETAIL = `<html><body><h1>Ver ABO Desire Online Sub Español | Series BL</h1>
<p>Fecha de emisión: 2025</p>
<a href="/episode/abo-desire-1x1/">Episodio 1</a></body></html>`;
const EPISODE = `<html><body><li class="dooplay_player_option" data-post="123" data-nume="1" data-type="tv">Ver Online</li></body></html>`;

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

test('seriesbl: parsing de DooPlay, título, año y episodios SxE', () => {
  assert.equal(seriesbl.detailTitle(DETAIL), 'ABO Desire');
  assert.equal(seriesbl.detailYear(DETAIL), 2025);
  assert.equal(seriesbl.audioOf(DETAIL), 'Subtitulado');
  assert.equal(seriesbl.listingMatches(LIST, RESOLVED).length, 1);
  assert.deepEqual(seriesbl.episodesOf(DETAIL, seriesbl.BASE), [{ season: 1, episode: 1, url: 'https://seriesbl.net/episode/abo-desire-1x1/' }]);
  assert.deepEqual(seriesbl.playersOf(EPISODE), [{ post: '123', nume: '1', type: 'tv', label: 'Ver Online' }]);
});

test('seriesbl: DooPlay AJAX publica el HLS con la ficha identificada', async () => {
  const stubbed = stub([
    ['/seriesbl.net/?s=', () => html(LIST)],
    ['/seriesbl.net/series/abo-desire/', () => html(DETAIL)],
    ['/seriesbl.net/episode/abo-desire-1x1/', () => html(EPISODE)],
    ['admin-ajax.php', () => json({ embed_url: HLS })],
  ]);
  try {
    const out = await seriesbl.searchSeriesBl('abo desire', RESOLVED, RESOLVED.title, 5000);
    assert.equal(out.hits?.length, 1, out.reason);
    assert.equal(out.hits[0].provider, 'seriesbl');
    assert.equal(out.hits[0].url, HLS);
    assert.equal(out.hits[0].audioLabel, 'Subtitulado');
    assert.equal(out.hits[0].quality, 'HLS');
    assert.match(out.hits[0].title, /S1E1 SeriesBL$/);
    assert.ok(stubbed.calls.some((url) => url.includes('admin-ajax.php')));
  } finally { stubbed.restore(); }
});
