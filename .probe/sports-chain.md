# Sonda 5: hls.php de streamtp, canal por canal

Fecha: 2026-11-24T15:46:33.256Z

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

Cookies de global2: shtk=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/; domain=wp.streamtp.site; secure; HttpOnly; SameSite=None ; shtk=392df839dec673f7277a26ea; expires=Tue, 24 Nov 2026 16:46:34 GMT; Max-Age=3600; path=/; domain=.streamtp.site; secure; HttpOnly; SameSite=None · cf-mitigated: no

hls.php con cookie → HTTP 200 · cf: no · 

| dsports | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 277 |
| la1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 480 |
| fox | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(7 B) | verificado | 222 |
| itv1 | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(8 B) | verificado | 135 |
| dsports2 | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 121 |

variante de dsportsplus: streamtp.site/live/dsportsplus/seg000905.ts?(39 B)
sin cookie/referer → HTTP 403 <html>
<head><title>403 Forbidden</title></head>
<body>
<
manifiesto de dsportsplus (primeras líneas):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:905
#EXT-X-KEY:METHOD=AES-128,URI="https://streamtp.site/key.php?ch=dsportsplus",IV=0x000000000000000000
#EXTINF:6.000000,
/live/dsportsplus/seg000905.ts?st=vKV0nTb50mgAKey1yGgowg&e=1795539600
#EXTINF:6.000000,
```
| dsportsplus | 200 | application/vnd.apple.mpegurl | VÁLIDO | streamtp.site/hls.php?(15 B) | verificado | 72 |
| canal5mx | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 69 |
| cbssports | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(13 B) | verificado | 68 |
| foxdeportes | 200 | application/vnd.apple.mpegurl | HTTP 200 | — | — | 67 |
| foxplus | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(11 B) | verificado | 68 |
| foxsports1usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 67 |
| foxsports2usa | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(17 B) | verificado | 68 |
| daznlaliga | 404 | application/vnd.apple.mpegurl | HTTP 404 no-HLS | streamtp.site/hls.php?(14 B) | verificado | 68 |
