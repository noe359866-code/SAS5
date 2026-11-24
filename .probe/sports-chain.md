# Sonda 5: hls.php de streamtp, canal por canal

Fecha: 2026-11-24T15:35:33.604Z

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

Cookies de global2: shtk=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/; domain=wp.streamtp.site; secure; HttpOnly; SameSite=None ; shtk=bcdd39a47a31c85204246fe2; expires=Tue, 24 Nov 2026 16:35:33 GMT; Max-Age=3600; path=/; domain=.streamtp.site; secure; HttpOnly; SameSite=None · cf-mitigated: no

hls.php con cookie → HTTP 200 · cf: no · 

| dsports | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 52 |
| la1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 53 |
| fox | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 53 |
| itv1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(8 B) | verificado | 174 |
| dsports2 | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 174 |

variante de dsportsplus: streamtp.site/live/dsportsplus/seg000794.ts?(39 B)
sin cookie/referer → HTTP 403 <html>
<head><title>403 Forbidden</title></head>
<body>
<
manifiesto de dsportsplus (primeras líneas):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:794
#EXT-X-KEY:METHOD=AES-128,URI="https://streamtp.site/key.php?ch=dsportsplus",IV=0x000000000000000000
#EXTINF:6.000000,
/live/dsportsplus/seg000794.ts?st=o8RPH9apb2oDMIRLkROVgg&e=1795539600
#EXTINF:6.000000,
```
| dsportsplus | 200 | application/vnd.apple.mpegurl | VÁLIDO | streamtp.site/hls.php?(15 B) | verificado | 185 |
| canal5mx | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 165 |
| cbssports | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(13 B) | verificado | 92 |
| foxdeportes | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 82 |
| foxplus | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(11 B) | verificado | 98 |
| foxsports1usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 106 |
| foxsports2usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 52 |
| daznlaliga | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(14 B) | verificado | 52 |
