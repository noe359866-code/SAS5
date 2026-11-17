'use strict';
const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const {searchAnimeflv, seriesUrl, episodeUrl, hlsUrl} = require('../lib/animeflv');
const {isDirectMedia} = require('../lib/directMedia');
const oldFetch=global.fetch; after(()=>{global.fetch=oldFetch;});
const show='https://animeflv.or.at/anime/example/';
const ep='https://animeflv.or.at/2026/11/17/example-episodio-2/';
const video='https://player.zilla-networks.com/m3u8/1234567890abcdef1234567890abcdef';
const button=`<span class="tooltip-text">HLS</span><button data-src="${Buffer.from(video).toString('base64')}" app_type="Sub">`;
test('validación estricta de ficha, episodio y origen HLS',()=>{
 assert.equal(seriesUrl(`<a href="${show}">x</a>`,{title:'Example'}),show);
 assert.equal(seriesUrl(`<a href="https://evil.test/anime/example/">x</a>`,{title:'Example'}),null);
 const html=`<script class="animeflv-episodes-data">${JSON.stringify([{number:2,permalink:ep}])}</script>`;
 assert.equal(episodeUrl(html,2,show),ep); assert.equal(episodeUrl(html,3,show),null);
 assert.equal(hlsUrl(button),video); assert.equal(hlsUrl(button.replace('HLS','Voe')),null);
 assert.equal(isDirectMedia(video,'animeflv'),true); assert.equal(isDirectMedia(video,'spinflix'),false);
 assert.equal(isDirectMedia('https://player.zilla-networks.com/embed/xyz','animeflv'),false);
});
test('entrega solo HLS verificado en primera temporada',async()=>{
 let n=0; global.fetch=async()=>new Response([`<a href="${show}">x</a>`,`<script class="animeflv-episodes-data">${JSON.stringify([{number:2,permalink:ep}])}</script>`,button,'#EXTM3U\n#EXTINF:10,\nsegment.html'][n++]);
 const r={title:'Example',mediaType:'series',season:1,episode:2};
 const result=await searchAnimeflv('',r,'Example',1000);
 assert.equal(n,4); assert.equal(result.hits[0].url,video); assert.equal(result.hits[0].audioLabel,undefined);
 assert.ok((await searchAnimeflv('',{...r,season:2},'Example',1000)).skipped); assert.equal(n,4);
});
