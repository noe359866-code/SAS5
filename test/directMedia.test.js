'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDirectMedia } = require('../lib/directMedia');
const streams = require('../lib/streams');
test('filtra iframes, anuncios y la antigua ruta del relay; conserva MP4 y HLS', () => {
  assert.equal(isDirectMedia('https://dood.example/e/123'), false);
  assert.equal(isDirectMedia('https://example.org/ad/video.m3u8'), false);
  assert.equal(isDirectMedia('https://example.org/ads/video.mp4'), false);
  assert.equal(isDirectMedia('https://cdn.example/movie/Ad-Astra/master.m3u8?x=ads'), true);
  assert.equal(isDirectMedia('https://cdn.example/movie.mp4'), true);
  assert.equal(isDirectMedia('https://addon.example/hls?u=' + encodeURIComponent('https://cdn.example/master.m3u8')), false);
  assert.equal(isDirectMedia('https://ads.example.org/playlist.m3u8'), false);
  assert.equal(isDirectMedia('javascript:alert(1)'), false);
});

test('acepta el HLS cuya forma no lleva extensión en la ruta', () => {
  // El player propio de AnimeFLV sirve el master como token bajo /m3u8/.
  assert.equal(isDirectMedia('https://player.zilla-networks.com/m3u8/6db32c99cc153255de897d502f9cd079'), true);
  // UnLimPlay declara la extensión en el parámetro: `x=.m3u8`.
  assert.equal(isDirectMedia('https://unlimplay.com/cps.php?t=s_668fd14a&e=1795116600&s=94fb74eb&x=.m3u8'), true);
  assert.equal(isDirectMedia('https://unlimplay.com/cps.php?t=s_668fd14a&x=.mp4'), true);
  // Lo que no cambia: un relé con la URL dentro del parámetro sigue fuera, y
  // un segmento suelto bajo /m3u8/ sin token tampoco pasa.
  assert.equal(isDirectMedia('https://relay.example/hls?u=' + encodeURIComponent('https://cdn.example/master.m3u8')), false);
  assert.equal(isDirectMedia('https://example.com/m3u8/'), false);
  assert.equal(isDirectMedia('https://example.com/hls'), false);
  assert.equal(isDirectMedia('https://unlimplay.com/cps.php?t=x&x=m3u8'), false);
});
test('el pipeline no presenta embeds como vídeos y lo informa al diagnóstico', async () => {
  const old = streams.SEARCHERS.fanpelis;
  try {
    streams.SEARCHERS.fanpelis = async () => ({hits: [
      {provider:'fanpelis', title:'Movie', url:'https://vimeos.net/embed-123.html', relevant:true},
      {provider:'fanpelis', title:'Movie', url:'https://vimeos.net/embed-456.html', relevant:true},
      {provider:'fanpelis', title:'Movie', audioLabel:'Latino', url:'https://cdn.example/movie.mp4', relevant:true},
    ]});
    const report = {};
    const hits = await streams.runProviders(['fanpelis'],'Movie',{title:'Movie',mediaType:'movie'},'Movie',report,1000,{ignorePause:true});
    assert.deepEqual(hits.map(h=>h.url), ['https://cdn.example/movie.mp4']);
    assert.equal(report.fanpelis.raw, 3);
    assert.equal(report.fanpelis.relevant, 1);
  } finally { streams.SEARCHERS.fanpelis = old; }
});
test('si el embed mezcla un anuncio identificable y un master, no se escoge el anuncio', () => {
  const { extractFromEmbedHtml } = require('../lib/spinflix');
  const html = `<script>const ad='https://ads.example.org/preroll.m3u8'; const content='https://cdn.example.org/movie/master.m3u8?token=1';</script>`;
  assert.deepEqual(extractFromEmbedHtml(html).hls, ['https://cdn.example.org/movie/master.m3u8?token=1']);
});
