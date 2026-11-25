# Sonda 5: hls.php de streamtp, canal por canal

Fecha: 2026-11-25T13:14:42.581Z

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

Cookies de global2: shtk=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/; domain=wp.streamtp.site; secure; HttpOnly; SameSite=None ; shtk=fdee3843611c408b78796ede; expires=Wed, 25 Nov 2026 14:14:42 GMT; Max-Age=3600; path=/; domain=.streamtp.site; secure; HttpOnly; SameSite=None · cf-mitigated: no

hls.php con cookie → HTTP 200 · cf: no · 

| dsports | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 25 |
| la1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 23 |
| fox | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 24 |
| itv1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(8 B) | verificado | 24 |

variante de dsports2: streamtp.site/live/dsports2/seg000586.ts?(39 B)
sin cookie/referer → HTTP 403 <html>
<head><title>403 Forbidden</title></head>
<body>
<
manifiesto de dsports2 (primeras líneas):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:586
#EXT-X-KEY:METHOD=AES-128,URI="https://streamtp.site/key.php?ch=dsports2",IV=0x000000000000000000000
#EXTINF:6.000000,
/live/dsports2/seg000586.ts?st=3lQ8aJuLSZqSRCA2uy984A&e=1795618800
#EXTINF:6.000000,
```
| dsports2 | 200 | application/vnd.apple.mpegurl | VÁLIDO | streamtp.site/hls.php?(12 B) | verificado | 23 |
| dsportsplus | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 24 |
| canal5mx | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 23 |
| cbssports | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(13 B) | verificado | 22 |
| foxdeportes | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 22 |
| foxplus | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(11 B) | verificado | 22 |
| foxsports1usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 22 |
| foxsports2usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 22 |
| daznlaliga | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(14 B) | verificado | 22 |
