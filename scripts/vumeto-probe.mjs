// Diagnóstico estructural: no imprimir tokens, consultas ni enlaces de vídeo.
const base='https://vumeto.live';
try {
 const r=await fetch(base+'/',{signal:AbortSignal.timeout(15000)}); const html=await r.text();
 console.log(`Portada: HTTP ${r.status}; bytes=${html.length}; challenge=${r.headers.get('cf-mitigated')==='challenge'}`);
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m=>new URL(m[1],base)).filter(u=>u.origin===base && /\.js$/.test(u.pathname)).slice(0,12);
 console.log('Scripts locales: '+scripts.length);
 for(const u of scripts) {
  const s=await fetch(u,{signal:AbortSignal.timeout(15000)}), js=await s.text();console.log(`Bundle ${u.pathname}: HTTP ${s.status}; bytes=${js.length}`);
  const urls=[...js.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map(m=>{try{return new URL(m[0]).hostname}catch{return ''}});
  const domains=[...new Set(urls.filter(Boolean))].filter(x=>!/(?:google|facebook|twitter|w3|github|tmdb|react|schema)/i.test(x));console.log('  Dominios: '+domains.slice(0,40).join(','));
  if (u.pathname !== '/app.js') continue;
  for(const key of ['iframe','m3u8','/api/','vidsrc','embed','streamUrl']) {
    const n=[...js.matchAll(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'))].length;
    console.log(`  ${key}: ${n} coincidencias`);
  }
  for(const match of [...js.matchAll(/.{0,75}(?:vidsrc|iframe|m3u8|streamUrl|playerUrl|\/api\/sources).{0,100}/gi)].slice(0,16)) {
   console.log('  contexto: '+match[0].replace(/https?:[^\s"'`<>]+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[dato]').replace(/\s+/g,' ').slice(0,180));
  }
 }
} catch(e){console.log('Error: '+e.name)}
for(const path of ['/embed/movie/603','/embed/tv/1396/1/1']) {
 try {
  const base='https://vumeto.xyz';const r=await fetch(base+path,{signal:AbortSignal.timeout(15000)});const html=await r.text();console.log(`${path}: HTTP ${r.status}; bytes=${html.length}; challenge=${r.headers.get('cf-mitigated')==='challenge'}`);
  const scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>new URL(m[1],base)).filter(u=>u.origin===base && !/hls\.min/.test(u.pathname)).slice(0,10);
  console.log('  scripts: '+scripts.map(u=>u.pathname).join(','));
  const blobs=[html];for(const u of scripts){try{const sr=await fetch(u,{signal:AbortSignal.timeout(10000)});blobs.push(await sr.text());}catch{}}
  const page=html;
  const input=/(?:const|let)\s+input\s*=.{0,350}/.exec(page);console.log('  input declarado: '+(input?.[0]||'no').replace(/[A-Za-z0-9_-]{32,}/g,'[dato]'));
  const session=/<meta\s+name=["']vumeto-session["']\s+content=["']([^"']+)["']/.exec(page)?.[1];
  if(path==='/embed/movie/603' && session) {
   for(const api of ['/_player/health','/_player/map?type=movie&id=603','/_player/resolve?type=movie&id=603&provider=moviebox-0930']) try {const rr=await fetch(base+api,{headers:{'X-Vumeto-Session':session,Referer:base+path},signal:AbortSignal.timeout(35000)});let data=await rr.json();console.log('API con sesión '+api.split('?')[0]+': HTTP '+rr.status+'; claves='+Object.keys(data).join(',')+'; fuentes='+(Array.isArray(data.sources)?data.sources.length:'n/a')+'; error='+String(data.error||'').slice(0,100));if(Array.isArray(data.providers)) console.log('  disponibles: '+JSON.stringify(data.providers.map(p=>({id:p.id,configured:p.configured}))));if(Array.isArray(data.sources)) console.log('  tipos: '+JSON.stringify(data.sources.map(x=>({keys:Object.keys(x),type:x.type,quality:x.quality,language:x.language, directType:typeof x.directUrl,urlType:typeof x.url,host:(()=>{try{return new URL(x.directUrl||x.url,base).hostname}catch{return ''}})(),pathPrefix:(()=>{try{return new URL(x.directUrl||x.url,base).pathname.split('/').slice(0,3).join('/')}catch{return ''}})()}))));} catch(e){console.log('API con sesión: '+e.name)}
  }
  for(const line of page.split('\n')) if(/const input\s*=|let input\s*=|headers\s*=|\/_player\/resolve|providerNames/.test(line)) console.log('  config: '+line.trim().replace(/https?:[^\s"'`<>]+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[dato]').slice(0,300));
  for(const line of page.split('\n')) if(/\b(?:get|fetch)\s*\(|\/api\/|providers|sourceEndpoint/i.test(line) && !/sourceGeneration|currentSource|autoplay|querySelector/.test(line)) console.log('  petición: '+line.trim().replace(/https?:[^\s"'`<>]+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[dato]').slice(0,220));
  for(const js of blobs) {
   const urls=[...js.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map(x=>{try{return new URL(x[0]).hostname}catch{return ''}});console.log('  hosts: '+[...new Set(urls.filter(Boolean))].slice(0,30).join(','));
   for(const m of [...js.matchAll(/.{0,70}(?:fetch\(|\/api\/[^"'`\s<>]{1,80}|m3u8|sourceUrl|vidsrc|currentSource|server[s]?:).{0,100}/gi)].slice(0,12)) console.log('  estructura: '+m[0].replace(/https?:[^\s"'`<>]+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[dato]').replace(/\s+/g,' ').slice(0,170));
  }
 } catch(e){console.log('  error '+e.name)}
}

for(const path of ['/_player/health','/_player/map?type=movie&id=603','/_player/resolve?type=movie&id=603&provider=moviebox-0930']) {
 try {const r=await fetch('https://vumeto.xyz'+path,{headers:{Referer:'https://vumeto.xyz/embed/movie/603'},signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{};console.log(`API ${path.replace(/id=603/,'id=[id]')}: HTTP ${r.status}; tipo=${r.headers.get('content-type')}; keys=${Object.keys(data||{}).join(',')}`);if(Array.isArray(data?.providers))console.log('  proveedores: '+JSON.stringify(data.providers.map(p=>({id:p.id,configured:p.configured}))));if(data?.sources)console.log('  fuentes: '+data.sources.length+'; tipos='+JSON.stringify(data.sources.map(x=>({keys:Object.keys(x),type:x.type,quality:x.quality,language:x.language, directType:typeof x.directUrl,urlType:typeof x.url,host:(()=>{try{return new URL(x.directUrl||x.url,base).hostname}catch{return ''}})(),pathPrefix:(()=>{try{return new URL(x.directUrl||x.url,base).pathname.split('/').slice(0,3).join('/')}catch{return ''}})()}))));if(data?.error)console.log('  error: '+String(data.error).slice(0,100));}catch(e){console.log('API: '+e.name)}
}
