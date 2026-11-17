// Solo métricas y nombres de host; no imprimir URLs firmadas ni datos de usuarios.
import { createDecipheriv } from 'node:crypto';
const base='https://animeav1.com'; const ua='Mozilla/5.0 (compatible; CatalogosPlus/1.5)';
let episode='';
for(const path of ['/catalogo?search=Sora%20wa%20Akai%20Kawa%20no%20Hotori&page=1','/media/sora-wa-akai-kawa-no-hotori','/media/sora-wa-akai-kawa-no-hotori/20','/media/one-piece/1']) {
 try {const r=await fetch(base+path,{headers:{'User-Agent':ua},signal:AbortSignal.timeout(12000)}); const body=await r.text();
 console.log(`${path}: HTTP ${r.status}; bytes=${body.length}; challenge=${r.headers.get('cf-mitigated')==='challenge'}`);
 if(path.startsWith('/catalogo')) {const i=body.indexOf('/media/sora-wa-akai-kawa-no-hotori');console.log('  artículo encontrado='+ (i>=0));}
 if(path.endsWith('hotori')) console.log('  episodios indexados='+[...body.matchAll(/\{id:\d+,number:(\d+)\}/g)].length);
 if(path.endsWith('/20')) {episode=body; const idx=body.indexOf('embeds:{');let text=body.slice(idx,idx+1600);console.log('  estructura: '+text.replace(/https?:[^"'\s<>]+/g,'[URL]').replace(/\s+/g,' ').slice(0,850));}
 }catch(e){console.log(path+': '+e.name)}
}
const embed=/embeds:\{[\s\S]{0,1500}?server:"HLS",url:"([^"]+)"/i.exec(episode)?.[1];
if(embed) {
 try {const u=new URL(embed);console.log(`HLS inicial: host=${u.hostname}; ext=${u.pathname.endsWith('.m3u8')}; ruta=${u.pathname.split('/').slice(0,2).join('/')}`);
 if(u.hostname==='player.zilla-networks.com') {
  const rr=await fetch(u,{headers:{'User-Agent':ua,Referer:base+'/'},signal:AbortSignal.timeout(12000)});const body=await rr.text();
  console.log(`  player Zilla: HTTP ${rr.status}; tipo=${rr.headers.get('content-type')}; bytes=${body.length}; m3u=${body.startsWith('#EXTM3U')}`);
  for(const x of [...body.matchAll(/.{0,100}(?:m3u8|source|playlist|hls|segment).{0,130}/gi)].slice(0,8)) console.log('  player texto: '+x[0].replace(/https?:[^"'\s<>]+/g,'[URL]').replace(/\s+/g,' ').slice(0,200));
 }
 if(u.hostname==='animeav1.uns.bio' && /^[A-Za-z0-9]{1,40}$/.test(u.hash.slice(1))) {
  const response=await fetch('https://animeav1.uns.bio/api/v1/video?id='+encodeURIComponent(u.hash.slice(1))+'&w=1680&h=1050&r=animeav1.com',{headers:{'User-Agent':ua,Referer:'https://animeav1.uns.bio/'},signal:AbortSignal.timeout(12000)});const hex=(await response.text()).trim();console.log('  API UPN: HTTP '+response.status+'; hex='+/^[a-f0-9]+$/i.test(hex));
  if(response.ok && /^[a-f0-9]+$/i.test(hex)){const decipher=createDecipheriv('aes-128-cbc',Buffer.from('kiemtienmua911ca'),Buffer.from('1234567890oiuytr'));const obj=JSON.parse(Buffer.concat([decipher.update(Buffer.from(hex,'hex')),decipher.final()]).toString()); const stream=obj.cfNative||obj.source; const p=new URL(stream);console.log(`  fuente UPN: host=${p.hostname}; extensión=${p.pathname.split('.').pop()}`);
  const rr=await fetch(stream,{headers:{'User-Agent':ua,Referer:'https://animeav1.uns.bio/'},signal:AbortSignal.timeout(12000)});const text=await rr.text();console.log(`  playlist: HTTP ${rr.status}; tipo=${rr.headers.get('content-type')}; m3u=${text.startsWith('#EXTM3U')}`);
  const uri=/#EXT-X-MAP:[^\n]*URI="([^"]+)"/.exec(text)?.[1] || text.split('\n').find(x=>x && !x.startsWith('#'));if(uri){const seg=new URL(uri,stream);const sr=await fetch(seg,{headers:{'User-Agent':ua,Referer:'https://animeav1.uns.bio/',Range:'bytes=0-1023'},signal:AbortSignal.timeout(12000)});const reader=sr.body?.getReader();const x=reader?await reader.read():{};if(reader)await reader.cancel();console.log(`  segmento: host=${seg.hostname}; HTTP ${sr.status}; tipo=${sr.headers.get('content-type')}; bytes=${x.value?.length||0}`);}}
 }
 }catch(e){console.log('  error HLS: '+e.name)}
}
