'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { searchDeVideoSrc, directSources } = require('../lib/devideosrc');
const original = global.fetch;
after(() => { global.fetch = original; });
test('solo entrega fuentes directas HTTPS y no embeds', () => {
  assert.deepEqual(directSources({sources:[{url:'https://cdn.example/a.m3u8',kind:'hls'},{url:'https://host.example/embed',kind:'embed'},{url:'http://host.example/a.mp4',kind:'mp4'}]}).map(s => s.kind), ['hls']);
});
test('consulta shell y resolver con IMDb, sin WebView', async () => {
  let n = 0;
  global.fetch = async (url, options) => {
    n++;
    if (n === 1) return new Response('<div data-id="tt0133093" data-type="movie" data-resolve-token="token"></div>');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).id, 'tt0133093');
    return Response.json({ok:true,sources:[{kind:'hls',url:'https://cdn.example/a.m3u8'},{kind:'embed',url:'https://host.example/embed'}]});
  };
  const result = await searchDeVideoSrc('', { mediaType:'movie', imdbId:'tt0133093', title:'Matrix' }, 'Matrix', 1000);
  assert.equal(n, 2); assert.equal(result.hits.length, 1); assert.equal(result.hits[0].provider, 'devideosrc');
});
