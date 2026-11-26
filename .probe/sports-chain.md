# Sonda 5: hls.php de streamtp, canal por canal

Fecha: 2026-11-26T00:58:05.136Z

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

Cookies de global2: shtk=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/; domain=wp.streamtp.site; secure; HttpOnly; SameSite=None ; shtk=9d82598d5abeb772be9e55cc; expires=Thu, 26 Nov 2026 01:58:06 GMT; Max-Age=3600; path=/; domain=.streamtp.site; secure; HttpOnly; SameSite=None · cf-mitigated: no

hls.php con cookie → HTTP 200 · cf: no · 

| dsports | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 443 |
| la1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 393 |
| fox | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 437 |
| itv1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(8 B) | verificado | 416 |

variante de dsports2: streamtp.site/live/dsports2/seg001590.ts?(39 B)
sin cookie/referer → HTTP 403 <html>
<head><title>403 Forbidden</title></head>
<body>
<
manifiesto de dsports2 (primeras líneas):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:1590
#EXT-X-KEY:METHOD=AES-128,URI="https://streamtp.site/key.php?ch=dsports2",IV=0x000000000000000000000
#EXTINF:6.000000,
/live/dsports2/seg001590.ts?st=dEkifcg4DUP45vpJJ6Q_Vw&e=1795658400
#EXTINF:6.000000,
```
| dsports2 | 200 | application/vnd.apple.mpegurl | VÁLIDO | streamtp.site/hls.php?(12 B) | verificado | 442 |
| dsportsplus | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 401 |

variante de canal5mx: streamtp.site/live/canal5mx/seg000007.ts?(39 B)
sin cookie/referer → HTTP 403 <html>
<head><title>403 Forbidden</title></head>
<body>
<
manifiesto de canal5mx (primeras líneas):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-KEY:METHOD=AES-128,URI="https://streamtp.site/key.php?ch=canal5mx",IV=0x000000000000000000000
#EXTINF:6.048333,
/live/canal5mx/seg000007.ts?st=9u_Kc4jUUXdYh6BVV2A_Xw&e=1795658400
#EXTINF:6.000000,
```
| canal5mx | 200 | application/vnd.apple.mpegurl | VÁLIDO | streamtp.site/hls.php?(12 B) | verificado | 448 |
| cbssports | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(13 B) | verificado | 435 |
| foxdeportes | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 447 |
| foxplus | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(11 B) | verificado | 404 |
| foxsports1usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 435 |
| foxsports2usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 438 |
| daznlaliga | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(14 B) | verificado | 430 |
