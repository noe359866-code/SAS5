// Diagnóstico de estructura; no publica tokens, URL completas de vídeo ni cookies.
const base='https://shinchaneros.tv';
for(const path of ['/seasons/1/1','/seasons/2/34','/movies/superheroe','/movies/dinosaurios']) {
 try {
  const r=await fetch(base+path,{signal:AbortSignal.timeout(15000)}); const html=await r.text();
  console.log(`${path}: HTTP ${r.status}, bytes=${html.length}, challenge=${r.headers.get('cf-mitigated')==='challenge'}`);
  const normalized=html.replace(/\\\//g,'/').replace(/&quot;|\\"/g,'"');
  for (const match of [...normalized.matchAll(/.{0,90}(?:\.m3u8|\.mp4|iframe|videoUrl|video_url|streamUrl|sources|<video|\.mpd).{0,130}/gi)].slice(0,12)) {
   console.log('  medio: '+match[0].replace(/https?:\/\/[^\s"'<>\\]+/g, '[URL]').replace(/\s+/g,' ').slice(0,220));
  }
  const urls=[...normalized.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].map(m=>m[0]);
  const hosts=[...new Set(urls.map(u=>{try{return new URL(u).hostname}catch{return ''}}).filter(Boolean))];
  console.log('  hosts: '+hosts.join(','));
  const scripts=[...html.matchAll(/<script[^>]+src="([^"]+\.js[^\"]*)"/g)].map(x=>new URL(x[1],base).href);
  console.log('  scripts: '+scripts.length);
  if(path==='/seasons/1/1') {
   for(const url of scripts.slice(0,35)) {
    const rr=await fetch(url,{signal:AbortSignal.timeout(10000)});const js=await rr.text();
    const hits=[...js.matchAll(/.{0,80}(?:\.m3u8|\.mp4|videoUrl|video_url|streamUrl|\.mpd|api\/[^"' ]*video).{0,100}/gi)].slice(0,4);
    if(hits.length) {console.log('  script coincidencias: '+new URL(url).pathname);for(const h of hits)console.log('    '+h[0].replace(/https?:\/\/[^\s"'<>\\]+/g,'[URL]').slice(0,180));}
   }
  }
 } catch(e){console.log('  error: '+e.name)}
}
for (const path of ['/01x001.mp4','/01x002.mp4']) {
 try {
  const r=await fetch('https://play.shinchaneros.tv'+path,{headers:{Range:'bytes=0-1023',Referer:base+'/'},signal:AbortSignal.timeout(12000)});
  const bytes=new Uint8Array(await r.arrayBuffer());
  console.log(`MP4 ${path}: HTTP ${r.status}, challenge=${r.headers.get('cf-mitigated')==='challenge'}, tipo=${r.headers.get('content-type')}, bytes=${bytes.length}, ftyp=${String.fromCharCode(...bytes.slice(4,8))==='ftyp'}`);
 } catch(e){console.log(`MP4 ${path}: ${e.name}`)}
}
