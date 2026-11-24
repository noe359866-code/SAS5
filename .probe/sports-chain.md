# Sonda 5: hls.php de streamtp, canal por canal

Fecha: 2026-11-24T17:39:30.933Z

canales activos: dsports, la1, fox, itv1, dsports2, dsportsplus, canal5mx, cbssports, foxdeportes, foxplus, foxsports1usa, foxsports2usa, daznlaliga

| Canal | hls.php | Tipo | Contenido | m3u8 | HLS | ms |
|---|---|---|---|---|---|---|

Config decodificado de dsports (redactado):
```
(function(){
var hst=location.hostname;
if(hst!=='streamtp.site'&&hst!=='www.streamtp.site'){
docume
```

Cookies de global2: shtk=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/; domain=wp.streamtp.site; secure; HttpOnly; SameSite=None ; shtk=5500c534c33388faf63553b2; expires=Tue, 24 Nov 2026 18:39:32 GMT; Max-Age=3600; path=/; domain=.streamtp.site; secure; HttpOnly; SameSite=None · cf-mitigated: no

hls.php con cookie → HTTP 200 · cf: no · 

| dsports | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 436 |
| la1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 420 |
| fox | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 434 |
| itv1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(8 B) | verificado | 267 |
| dsports2 | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 234 |

variante de dsportsplus: streamtp.site/live/dsportsplus/seg001980.ts?(39 B)
sin cookie/referer → HTTP 403 <html>
<head><title>403 Forbidden</title></head>
<body>
<
manifiesto de dsportsplus (primeras líneas):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:15
#EXT-X-MEDIA-SEQUENCE:1980
#EXT-X-KEY:METHOD=AES-128,URI="https://streamtp.site/key.php?ch=dsportsplus",IV=0x000000000000000000
#EXTINF:5.999667,
/live/dsportsplus/seg001980.ts?st=b7CB2O-hArkad5LdVjWycA&e=1795546800
#EXTINF:5.992000,
```
| dsportsplus | 200 | application/vnd.apple.mpegurl | VÁLIDO | streamtp.site/hls.php?(15 B) | verificado | 262 |
| canal5mx | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 440 |
| cbssports | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(13 B) | verificado | 428 |
| foxdeportes | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 394 |
| foxplus | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(11 B) | verificado | 443 |
| foxsports1usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 428 |
| foxsports2usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 331 |
| daznlaliga | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(14 B) | verificado | 409 |
