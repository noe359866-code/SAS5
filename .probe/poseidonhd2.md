| Paso | HTTP | Tipo | Bytes | Nota |
|---|---|---|---:|---|
| search «odisea» | 200 | text/html | 54286 | movies=11 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=62 slug=movies/62/2001-odisea-del-espacio |
| search «policias de chicago» | 200 | text/html | 84146 | movies=24 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=590401 slug=movies/590401/de-de-pyaar-de |
| search «visionquest» | 200 | text/html | 31729 | movies=1 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=213375 slug=series/213375/visionquest |
| pelicula slug=la-odisea | 200 | text/html | 99391 | sirve la ficha con cualquier slug |
| pelicula slug=slug-inventado | 200 | text/html | 99351 | sirve la ficha con cualquier slug |
| pelicula NEXT_DATA | 200 | text/html | 99391 | thisMovie=sí · videos latino=5 spanish=0 english=5 |
| player voesx | 200 | text/html | 10810 | manual=200 · iframes=0 · medios=0 |
| player doodstream | 200 | text/html | 10823 | manual=200 · iframes=0 · medios=0 |
| player streamwish | 200 | text/html | 10822 | manual=200 · iframes=0 · medios=0 |
| episodio NEXT_DATA | 200 | text/html | 142266 | episode=sí · videos latino=5 spanish=0 english=0 |
| player episodio voesx | 200 | text/html | 10810 | iframes=0 medios=0 |
| muestreo de repuestos | 200 | text/html | 204205 | 59 fichas en portada, 10 recorridas · visores: voesx(18), doodstream(18), streamwish(16), vidhide(18), vidara(18), filemoon(1), streamtape(2), netu(2) · medios directos: 0 |
| extracción voesx | 200 | text/html | 10810 | https://voe.sx/e/ppagrvphy9e3 · opaque (JS / Cloudflare) |
| extracción doodstream | 200 | text/html | 10823 | https://doodstream.com/e/wj59x83itg2y · doodstream sin extractor · embed 403 text/html 5817B · sin pass_md5 en el embed |
| extracción streamwish | 200 | text/html | 10822 | https://streamwish.to/e/ekjfmb12x7ba · opaque (JS / Cloudflare) |
| extracción vidhide | 200 | text/html | 10823 | https://vidhidepro.com/v/6jqovg9dftf8 · opaque (JS / Cloudflare) |
| extracción vidara | 200 | text/html | 10815 | https://vidara.to/e/eNzldPd871EAF · desconocido |
| extracción filemoon | 200 | text/html | 10821 | https://bysejikuar.com/e/lwja6f00nxki · byse → ok=false fuentes=0 (fetch-error) |
| extracción streamtape | 200 | text/html | 10826 | https://streamtape.com/e/o91d8bk77jcJgoQ · streamtape → ok=false fuentes=0 (fetch-error) |
| extracción netu | 200 | text/html | 10810 | https://waaw.to/f/I7DmEDHh3LL9 · desconocido |

Sonda de poseidonhd2: solo HTML y JSON del sitio; sin segmentos de vídeo.
