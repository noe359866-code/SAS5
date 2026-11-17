'use strict';
const {test,after}=require('node:test');const assert=require('node:assert/strict');
const {sessionFromPage,candidates,searchVumeto}=require('../lib/vumeto');
const old=global.fetch;after(()=>{global.fetch=old;});
const source={provider:'moviebox-0930',type:'video/mp4',language:'English',quality:'720p',directUrl:'https://macdn.hakunaymatata.com/resource/a/movie.mp4?token=x'};
const data={target:{type:'tv',tmdbId:1396,season:1,episode:1},sources:[source]};
const meta={title:'Breaking Bad',mediaType:'series',tmdbId:1396,season:1,episode:1};
test('limita la extracción a identidad, idioma y medio esperado',()=>{
 assert.equal(sessionFromPage('<meta name="vumeto-session" content="abc.def-123">'),'abc.def-123');
 assert.equal(candidates(data,meta).length,1);
 assert.equal(candidates({...data,target:{...data.target,episode:2}},meta).length,0);
 for(const s of [{...source,language:'Spanish'},{...source,directUrl:'https://macdn.hakunaymatata.com.evil.test/resource/a/a.mp4'},{...source,directUrl:'https://macdn.hakunaymatata.com/resource/a/embed.html'},{...source,type:'text/html'}]) assert.equal(candidates({...data,sources:[s]},meta).length,0);
});
test('extrae solo MP4 validado y consulta usando TMDB y episodio',async()=>{
 let n=0;const bodies=['<meta name="vumeto-session" content="abc.def-123">',JSON.stringify(data),new Uint8Array([0,0,0,24,102,116,121,112])];let url='';
 global.fetch=async(u)=>{n++;url=String(u);return new Response(bodies[n-1]);};
 const result=await searchVumeto('',meta,meta.title,1000);
 assert.equal(n,3);assert.equal(url,source.directUrl);assert.equal(result.hits[0].audioLabel,'English');assert.equal(result.hits[0].url,source.directUrl);
});
test('rechaza respuestas HTML y no busca sin datos exactos',async()=>{
 let n=0;const bodies=['<meta name="vumeto-session" content="abc.def-123">',JSON.stringify(data),'<!DOCTYPE html>'];global.fetch=async()=>new Response(bodies[n++]);
 assert.deepEqual((await searchVumeto('',meta,meta.title,1000)).hits,[]);
 assert.ok((await searchVumeto('',{...meta,tmdbId:null},meta.title,1000)).skipped);assert.equal(n,3);
});
