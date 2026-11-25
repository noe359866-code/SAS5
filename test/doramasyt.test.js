'use strict';

/** Proveedor de doramas incorporado el 25-11-2026 (sondas: `.probe/doramasyt.md`,
 *  `.probe/doramasyt-search.md`: el buscador enlaza directo a los capítulos). */
const test = require('node:test');
const assert = require('node:assert/strict');
const doramasyt = require('../lib/sites/doramasyt');

const HLS = 'https://edge1-waw-sprintcdn.r66nv9ed.com/hls2/10/12047/abc_x/master.m3u8';
const RESOLVED = { title: "What's Wrong with Secretary Kim", altTitle: null, year: '2018', mediaType: 'series', season: 1, episode: 16 };

// El buscador enlaza los capítulos directamente (medido el 25-11-2026).
const LIST = `<html><body>
<a href="/ver/whats-wrong-with-secretary-kim-latino-episodio-16" title="Qué le ocurre a la secretaria Kim Latino Capítulo 16">c16 latino</a>
<a href="/ver/whats-wrong-with-secretary-kim-latino-episodio-15">c15</a>
<a href="/ver/whats-wrong-with-secretary-kim-episodio-16">c16 sub</a>
</body></html>`;
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

test('doramasyt: enlaces /ver/ con serie, capítulo y audio deducidos', () => {
  const links = doramasyt.verLinksOf(LIST);
  assert.equal(links.length, 3);
  const latino = links.find((l) => l.latino);
  assert.deepEqual({ showSlug: latino.showSlug, season: latino.season, episode: latino.episode },
    { showSlug: 'whats-wrong-with-secretary-kim', season: 1, episode: 16 });
  assert.equal(latino.label, 'Qué le ocurre a la secretaria Kim');
  assert.deepEqual(doramasyt.playersOf(EPISODE), ['TOKEN1', 'TOKEN2']);
  assert.equal(doramasyt.embedFromPlayer(PLAYER), 'https://bysebuho.com/e/abc123');
});

test('doramasyt: el slug de la ruta también identifica la obra', () => {
  assert.ok(doramasyt.slugMatches('whats-wrong-with-secretary-kim', ["What's Wrong with Secretary Kim"]));
  assert.ok(!doramasyt.slugMatches('otra-cosa', ["What's Wrong with Secretary Kim"]));
});

test('doramasyt: búsqueda → capítulo → data-player → reproductor → HLS latino', async () => {
  const stubbed = stub([
    ['/?s=', () => html(LIST)],
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
    // Solo el capítulo pedido: el 15 no se visita
    assert.ok(!stubbed.calls.some((url) => url.includes('episodio-15')));
    assert.ok(stubbed.calls.some((url) => url.includes('/reproductor?video=TOKEN1')));
  } finally { stubbed.restore(); }
});

test('doramasyt: sin coincidencia de título responde no-match sin tocar capítulos', async () => {
  const stubbed = stub([['/?s=', () => html(LIST)]]);
  try {
    const out = await doramasyt.searchDoramasYt('xyz', { ...RESOLVED, title: 'Una Serie Que No Existe' }, 'Una Serie Que No Existe', 5000);
    assert.deepEqual(out, { hits: [], reason: 'no-match' });
    assert.ok(stubbed.calls.every((url) => url.includes('/?s=')));
  } finally { stubbed.restore(); }
});
