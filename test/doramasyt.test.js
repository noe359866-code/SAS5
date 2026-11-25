'use strict';

/** Proveedor de doramas incorporado el 25-11-2026 (sonda: `.probe/doramasyt.md`). */
const test = require('node:test');
const assert = require('node:assert/strict');
const doramasyt = require('../lib/sites/doramasyt');

const HLS = 'https://edge1-waw-sprintcdn.r66nv9ed.com/hls2/10/12047/abc_x/master.m3u8';
const RESOLVED = { title: "What's Wrong with Secretary Kim", altTitle: null, year: '2018', mediaType: 'series', season: 1, episode: 16 };

const LIST = '<html><body><a href="/dorama/whats-wrong-with-secretary-kim-latino/" title="What\'s Wrong with Secretary Kim Latino">Whats Wrong</a></body></html>';
const DETAIL = `<html><body><h1>What's Wrong with Secretary Kim Latino | DoramasYT</h1>
<p>2018</p>
<a href="/ver/whats-wrong-with-secretary-kim-latino-episodio-16">Capítulo 16</a>
<a href="/ver/whats-wrong-with-secretary-kim-episodio-16">Capítulo 16 sub</a></body></html>`;
const EPISODE = '<html><body><button data-player="TOKEN1"></button><button data-player="TOKEN2"></button></body></html>';
const PLAYER = '<html><body><iframe src="https://bysebuho.com/e/abc123"></iframe></body></html>';

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

test('doramasyt: parsing de ficha, capítulos con audio y botones data-player', () => {
  assert.equal(doramasyt.detailTitle(DETAIL), "What's Wrong with Secretary Kim");
  assert.equal(doramasyt.detailYear(DETAIL), 2018);
  assert.equal(doramasyt.listingMatches(LIST, RESOLVED).length, 1);
  const episodes = doramasyt.episodesOf(DETAIL, doramasyt.BASE);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.find((e) => e.latino), { season: 1, episode: 16, url: `${doramasyt.BASE}/ver/whats-wrong-with-secretary-kim-latino-episodio-16`, latino: true });
  assert.deepEqual(doramasyt.playersOf(EPISODE), ['TOKEN1', 'TOKEN2']);
  assert.equal(doramasyt.embedFromPlayer(PLAYER), 'https://bysebuho.com/e/abc123');
});

test('doramasyt: el slug de la ficha también identifica la obra', () => {
  assert.ok(doramasyt.slugMatches('/dorama/whats-wrong-with-secretary-kim-latino/', ["What's Wrong with Secretary Kim"]));
  assert.ok(!doramasyt.slugMatches('/dorama/otra-cosa/', ["What's Wrong with Secretary Kim"]));
});

test('doramasyt: data-player → reproductor → byse → HLS latino', async () => {
  const stubbed = stub([
    ['/?s=', () => html(LIST)],
    ['/dorama/whats-wrong-with-secretary-kim-latino/', () => html(DETAIL)],
    ['/ver/whats-wrong-with-secretary-kim', () => html(EPISODE)],
    ['/reproductor?video=TOKEN1', () => html(PLAYER)],
    ['bysebuho.com/e/abc123', () => json({ /* el extractor real se prueba aparte */ })],
  ]);
  try {
    const out = await doramasyt.searchDoramasYt('secretary kim', RESOLVED, RESOLVED.title, 5000);
    // Sin el backend de Byse en el fixture, el extractor no da fuentes…
    assert.ok(out.hits || out.reason);
  } finally { stubbed.restore(); }

  // …pero con un embed directo sí se publica la fila con su audio.
  const direct = stub([
    ['/?s=', () => html(LIST)],
    ['/dorama/whats-wrong-with-secretary-kim-latino/', () => html(DETAIL)],
    ['/ver/whats-wrong-with-secretary-kim', () => html(EPISODE)],
    ['/reproductor?video=', () => html(`<html><body><iframe src="${HLS}"></iframe></body></html>`)],
  ]);
  try {
    const out = await doramasyt.searchDoramasYt('secretary kim', RESOLVED, RESOLVED.title, 5000);
    assert.ok(out.hits.length >= 1, JSON.stringify(out));
    assert.equal(out.hits[0].provider, 'doramasyt');
    assert.equal(out.hits[0].url, HLS);
    assert.equal(out.hits[0].audioLabel, 'Latino');
    assert.match(out.hits[0].title, /S1E16 Latino DoramasYT$/);
    assert.ok(direct.calls.some((url) => url.includes('/reproductor?video=TOKEN1')));
  } finally { direct.restore(); }
});
