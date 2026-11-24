'use strict';

/** OtakusTV: ficha con año/audio, episodio absoluto y visor declarado. */
const test = require('node:test');
const assert = require('node:assert');
const otakustv = require('../lib/sites/otakustv');
const { extractorFor } = require('../lib/extractors');

const HLS = 'https://edge1-madrid-sprintcdn.r66nv9ed.com/hls/abcd1234/master.m3u8';
const RESOLVED = { title: 'One Piece', altTitle: null, year: '1999', mediaType: 'series', season: 1, episode: 1 };

const DETAIL = `<html><body>
<div class="info"><h1><strong>One Piece <i>Sub Español</i></strong></h1>
<span><i>Estreno: Oct 20 de 1999</i></span>
<ul class="u"><li><span>Audio:</span> <span>Sub Español</span></li></ul></div>
<div class="th"><span id="dt" data-e="1180">1180 episodios</span></div>
<a href="https://otakustv2.com/ver/one-piece-1" title="Ver One Piece episodio 1">Episodio 1</a>
</body></html>`;

const EPISODE = `<html><body><div id="epdata">
<h1><strong>Ver One Piece episodio 1 Sub Español</strong></h1>
<a class="ep-btn d" data-dwn="[[&quot;xxx&quot;, &quot;https://bysesukior.com/d/abc123&quot;], [&quot;xxx&quot;, &quot;${HLS}&quot;]]">Descargar</a>
</div></body></html>`;

const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

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

test('otakustv: parsea ficha, audio y visores', () => {
  assert.equal(otakustv.detailTitle(DETAIL), 'One Piece');
  assert.equal(otakustv.detailYear(DETAIL), 1999);
  assert.equal(otakustv.audioOf(DETAIL), 'Subtitulado');
  assert.equal(otakustv.seasonOf('One Piece', 'https://otakustv2.com/anime/one-piece'), null);
  assert.equal(otakustv.seasonOf('Ao no Hako', 'https://otakustv2.com/anime/ao-no-hako-season-2'), 2);
  assert.deepEqual(otakustv.episodesOf(DETAIL, otakustv.BASE), [{ number: 1, url: 'https://otakustv2.com/ver/one-piece-1' }]);
  const servers = otakustv.serversOf(EPISODE);
  assert.equal(servers.length, 2);
  assert.equal(extractorFor(servers[0].url), 'byse');
  assert.equal(servers[1].url, HLS);
});

test('otakustv: cadena completa identifica el episodio y publica el HLS directo', async () => {
  const stubbed = stub([
    ['/anime/one-piece', () => html(DETAIL)],
    ['/ver/one-piece-1', () => html(EPISODE)],
  ]);
  try {
    const out = await otakustv.searchOtakusTv('one piece', RESOLVED, RESOLVED.title, 5000);
    assert.equal(out.hits?.length, 1, out.reason);
    assert.equal(out.hits[0].provider, 'otakustv');
    assert.equal(out.hits[0].url, HLS);
    assert.equal(out.hits[0].quality, 'HLS');
    assert.equal(out.hits[0].audioLabel, 'Subtitulado');
    assert.equal(out.hits[0].playbackOrigin, `https://${new URL(HLS).hostname}`);
    assert.match(out.hits[0].title, /S1E1 OtakusTV$/);
    assert.ok(stubbed.calls.some((url) => url.includes('/anime/one-piece')));
    assert.ok(stubbed.calls.some((url) => url.includes('/ver/one-piece-1')));
  } finally { stubbed.restore(); }
});

test('otakustv: no inventa episodios de temporadas posteriores sin declaración', async () => {
  const stubbed = stub([['/anime/one-piece', (target) => target.endsWith('/anime/one-piece') ? html(DETAIL) : new Response('', { status: 404 })]]);
  try {
    const out = await otakustv.searchOtakusTv('one piece', { ...RESOLVED, season: 2, episode: 1 }, 'One Piece', 5000);
    assert.equal(out.hits.length, 0);
    assert.equal(out.reason, 'no-match');
    assert.ok(!stubbed.calls.some((url) => url.includes('/ver/')));
  } finally { stubbed.restore(); }
});
