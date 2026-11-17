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
  for(const key of ['iframe','m3u8','/api/','vidsrc','embed','streamUrl']) {
    const n=[...js.matchAll(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'))].length;
    console.log(`  ${key}: ${n} coincidencias`);
  }
  for(const match of [...js.matchAll(/.{0,75}(?:vidsrc|iframe|m3u8|streamUrl|playerUrl|\/api\/sources).{0,100}/gi)].slice(0,16)) {
   console.log('  contexto: '+match[0].replace(/https?:[^\s"'`<>]+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[dato]').replace(/\s+/g,' ').slice(0,180));
  }
 }
} catch(e){console.log('Error: '+e.name)}
