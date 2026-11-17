'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { searchFrenchStream, findId, vidzyUrl } = require('../lib/frenchstream');
const original = global.fetch; after(() => {global.fetch = original;});
const html = `<div class="search-item" onclick="location.href='/9841-matrix-film-streaming-complet-vf.html'"><div class="search-title">Matrix (1999)</div></div><div class="search-item" onclick="location.href='/2-matrix.html'"><div class="search-title">Matrix (2021)</div></div>`;
test('asocia únicamente título y año exactos, descarta enlaces no esperados', () => {
  assert.equal(findId(html,{title:'Matrix',year:'1999'}),'9841');
  assert.equal(findId(html,{title:'Matrix',year:'2000'}),null);
  assert.equal(findId(html,{title:'Matrix'}),null);
  assert.equal(vidzyUrl({players:{vidzy:{default:'https://evil.example/embed-abc.html'}}}),null);
});
test('máximo tres consultas y solo un HLS del host validado', async () => {
  let n=0;
  global.fetch=async () => { n++; if(n===1)return new Response(html); if(n===2)return Response.json({players:{vidzy:{default:'https://vidzy.org/embed-abc.html'}}}); return new Response('<script>file="https://v6.vidzy.org/a/master.m3u8?token=abc"</script>'); };
  const result=await searchFrenchStream('',{title:'Matrix',year:'1999',mediaType:'movie'},'Matrix',1000);
  assert.equal(n,3); assert.equal(result.hits.length,1); assert.match(result.hits[0].url,/\.m3u8/);
});
