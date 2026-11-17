'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDirectMedia } = require('../lib/directMedia');
const streams = require('../lib/streams');
const config = require('../lib/config');
test('filtra iframes y rutas publicitarias, conserva MP4 y HLS', () => {
  assert.equal(isDirectMedia('https://dood.example/e/123','playlatin'), false);
  assert.equal(isDirectMedia('https://example.org/ad/video.m3u8','fanpelis'), false);
  assert.equal(isDirectMedia('https://example.org/ads/video.mp4','fanpelis'), false);
  assert.equal(isDirectMedia('https://cdn.example/movie/Ad-Astra/master.m3u8?x=ads','fanpelis'), true);
  assert.equal(isDirectMedia('https://cdn.example/movie.mp4','playlatin'), true);
  assert.equal(isDirectMedia('https://vixsrc.to/playlist/123?token=x','vixsrc'), true);
  assert.equal(isDirectMedia('https://vixsrc.to/playlist/123?token=x','other'), false);
  const oldBase = config.addonBaseUrl; config.addonBaseUrl = 'https://addon.example';
  assert.equal(isDirectMedia('https://addon.example/hls?u=' + encodeURIComponent('https://cdn.example/master.m3u8'),'fanpelis'),true);
  assert.equal(isDirectMedia('https://evil.example/hls?u=' + encodeURIComponent('https://cdn.example/master.m3u8'),'fanpelis'),false);
  assert.equal(isDirectMedia('https://ads.example.org/playlist.m3u8','fanpelis'),false);
  assert.equal(isDirectMedia('https://addon.example/hls?u=' + encodeURIComponent('https://cdn.example/embed/1'),'fanpelis'),false);
  assert.equal(isDirectMedia('javascript:alert(1)','x'),false);
  config.addonBaseUrl = oldBase;
});
test('el pipeline no presenta embeds como vídeos y lo informa al diagnóstico', async () => {
  const old = streams.SEARCHERS.videoapi;
  try {
    streams.SEARCHERS.videoapi = async () => ({hits: [
      {provider:'videoapi', title:'Movie', url:'https://vimeos.net/embed-123.html', relevant:true, seeders:0},
      {provider:'videoapi', title:'Movie', url:'https://vimeos.net/embed-456.html', infoHash:'a'.repeat(40), relevant:true, seeders:0},
      {provider:'videoapi', title:'Movie', url:'https://cdn.example/movie.mp4', relevant:true, seeders:0},
    ]});
    const report = {};
    const hits = await streams.runProviders(['videoapi'],'Movie',{title:'Movie',mediaType:'movie'},'Movie',report,1000,{ignorePause:true});
    assert.deepEqual(hits.map(h=>h.url), ['https://cdn.example/movie.mp4']);
    assert.equal(report.videoapi.rejectedNonMedia,2);
  } finally { streams.SEARCHERS.videoapi = old; }
});
test('si el embed mezcla un anuncio identificable y un master, no se escoge el anuncio', () => {
  const { extractFromEmbedHtml } = require('../lib/spinflix');
  const html = `<script>const ad='https://ads.example.org/preroll.m3u8'; const content='https://cdn.example.org/movie/master.m3u8?token=1';</script>`;
  assert.deepEqual(extractFromEmbedHtml(html).hls, ['https://cdn.example.org/movie/master.m3u8?token=1']);
});
