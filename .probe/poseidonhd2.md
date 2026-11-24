| Paso | HTTP | Tipo | Bytes | Nota |
|---|---|---|---:|---|
| search «odisea» | 200 | text/html | 54352 | movies=11 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=62 slug=movies/62/2001-odisea-del-espacio |
| search «policias de chicago» | 200 | text/html | 84212 | movies=24 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=590401 slug=movies/590401/de-de-pyaar-de |
| search «visionquest» | 200 | text/html | 31795 | movies=1 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=213375 slug=series/213375/visionquest |
| pelicula slug=la-odisea | 200 | text/html | 98379 | sirve la ficha con cualquier slug |
| pelicula slug=slug-inventado | 200 | text/html | 99093 | sirve la ficha con cualquier slug |
| pelicula NEXT_DATA | 200 | text/html | 98379 | thisMovie=sí · videos latino=5 spanish=0 english=5 |
| player voesx | 200 | text/html | 10810 | manual=200 · iframes=0 · medios=0 |
| player doodstream | 200 | text/html | 10823 | manual=200 · iframes=0 · medios=0 |
| player streamwish | 200 | text/html | 10822 | manual=200 · iframes=0 · medios=0 |
| episodio NEXT_DATA | 200 | text/html | 142499 | episode=sí · videos latino=5 spanish=0 english=0 |
| player episodio voesx | 200 | text/html | 10810 | iframes=0 medios=0 |
| muestreo de repuestos | 200 | text/html | 189292 | 63 fichas en portada, 10 recorridas · visores: voesx(14), doodstream(13), streamwish(14), vidhide(13), vidara(4), filemoon(1), netu(1) · medios directos: 0 |
| extracción voesx | 200 | text/html | 10810 | https://voe.sx/e/nlxuec3rrl5q · opaque (JS / Cloudflare) |
| extracción doodstream | 200 | text/html | 10823 | https://doodstream.com/e/juzchh1zb8zq · doodstream sin extractor · embed 403 text/html 5796B · sin pass_md5 en el embed |
| extracción streamwish | 200 | text/html | 10822 | https://streamwish.to/e/o4x0nt10xa3f · opaque (JS / Cloudflare) |
| extracción vidhide | 200 | text/html | 10823 | https://vidhidepro.com/v/tt77b8r2n226 · opaque (JS / Cloudflare) |
| extracción vidara | 200 | text/html | 10815 | https://vidara.to/e/p6ILXSKC4vox7 · desconocido |
| extracción filemoon | 200 | text/html | 10821 | https://bysejikuar.com/e/n2gbkv6zxxvp · byse → sin-referer=fetch-error player.poseidonhd2.co=fetch-error www.poseidonhd2.co=fetch-error |
| extracción netu | 200 | text/html | 10810 | https://waaw.to/f/tWcS9VWfeDcG · desconocido |

Sonda de poseidonhd2: solo HTML y JSON del sitio; sin segmentos de vídeo.
