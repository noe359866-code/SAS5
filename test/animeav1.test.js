'use strict';
const { test, after } = require('node:test'); const assert=require('node:assert/strict');
const {findSeries,hasEpisode,subEmbed,directMp4,searchAnimeav1}=require('../lib/animeav1');
const old=global.fetch; after(()=>{global.fetch=old;});
const title='Sora wa Akai Kawa no Hotori';
const catalog=`<article><div class="text-subs">TV Anime</div><h3>${title}</h3><a href="/media/sora-wa-akai-kawa-no-hotori">Ver</a></article>`;
const series='episodes:[{id:4412,number:20},{id:4411,number:19}]';
const embed='https://www.mp4upload.com/embed-abc123.html';
const episode=`embeds:{SUB:[{server:"MP4Upload",url:"${embed}"}]},downloads:{SUB:[{server:"MP4Upload",url:"https://evil.test/embed-abc123.html"}]}`;
const direct='https://a3.mp4upload.com/path/episode.mp4?token=abc';
const media=new Uint8Array([0,0,0,24,102,116,121,112]);
test('título y tipo exactos, episodio y URL de origen válidos',()=>{
 assert.equal(findSeries(catalog,{title}),'https://animeav1.com/media/sora-wa-akai-kawa-no-hotori');
 assert.equal(findSeries(catalog.replace('TV Anime','Película'),{title}),null);
 assert.equal(findSeries(catalog,{title:'Sora'}),null);
 assert.equal(hasEpisode(series,20),true);assert.equal(hasEpisode(series,21),false);
 assert.equal(subEmbed(episode),embed);assert.equal(subEmbed(episode.replace('SUB:[','DUB:[')),null);
 assert.equal(directMp4(`src:"${direct}"`),direct);
 assert.equal(directMp4('src:"https://mp4upload.com.evil.test/a.mp4"'),null);
});
test('extrae MP4 y valida cabecera, sin asumir idioma de audio',async()=>{
 let n=0; const bodies=[catalog,series,episode,`src:"${direct}"`,media];global.fetch=async()=>new Response(bodies[n++]);
 const r={title,mediaType:'series',season:1,episode:20};const result=await searchAnimeav1('',r,title,1000);
 assert.equal(n,5);assert.equal(result.hits[0].url,direct);assert.equal(result.hits[0].audioLabel,undefined);
 assert.ok((await searchAnimeav1('',{...r,season:2},title,1000)).skipped);assert.equal(n,5);
});
test('no entrega página HTML ni vídeo bloqueado',async()=>{
 let n=0;const bodies=[catalog,series,episode,`src:"${direct}"`,'<!DOCTYPE html>'];global.fetch=async()=>new Response(bodies[n++]);
 const result=await searchAnimeav1('',{title,mediaType:'series',season:1,episode:20},title,1000);
 assert.deepEqual(result.hits,[]);
});
