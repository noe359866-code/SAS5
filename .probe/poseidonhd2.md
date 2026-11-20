| Paso | HTTP | Tipo | Bytes | Nota |
|---|---|---|---:|---|
| search «odisea» | 200 | text/html | 54284 | movies=11 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=62 slug=movies/62/2001-odisea-del-espacio |
| search «policias de chicago» | 200 | text/html | 83686 | movies=24 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=590401 slug=movies/590401/de-de-pyaar-de |
| search «visionquest» | 200 | text/html | 31727 | movies=1 topMoviesDay=5 topMoviesWeek=5 · primero: TMDbId=213375 slug=series/213375/visionquest |
| pelicula slug=la-odisea | 200 | text/html | 99344 | sirve la ficha con cualquier slug |
| pelicula slug=slug-inventado | 200 | text/html | 98932 | sirve la ficha con cualquier slug |
| pelicula NEXT_DATA | 200 | text/html | 99344 | thisMovie=sí · videos latino=5 spanish=0 english=5 |
| player voesx | 200 | text/html | 10810 | manual=200 · iframes=0 · medios=0 |
| player doodstream | 200 | text/html | 10823 | manual=200 · iframes=0 · medios=0 |
| player streamwish | 200 | text/html | 10822 | manual=200 · iframes=0 · medios=0 |
| episodio NEXT_DATA | 200 | text/html | 142188 | episode=sí · videos latino=5 spanish=0 english=0 |
| player episodio voesx | 200 | text/html | 10810 | iframes=0 medios=0 |
| muestreo de repuestos | 200 | text/html | 201370 | 59 fichas en portada, 10 recorridas · visores: voesx(17), doodstream(16), streamwish(17), vidhide(15), vidara(14), filemoon(3), streamtape(2), netu(2) · medios directos: 0 |
| extracción voesx | 200 | text/html | 10810 | https://voe.sx/e/yr2v8ihq6z1k · opaque (JS / Cloudflare) |
| extracción doodstream | 200 | text/html | 10823 | https://doodstream.com/e/nf8aox6n57p9 · doodstream sin extractor · embed 403 text/html 5796B · sin pass_md5 en el embed |
| extracción streamwish | 200 | text/html | 10822 | https://streamwish.to/e/9dyj0wa53j0z · opaque (JS / Cloudflare) |
| extracción vidhide | 200 | text/html | 10823 | https://vidhidepro.com/v/obfbsw4y6arx · opaque (JS / Cloudflare) |
| extracción vidara | 200 | text/html | 10815 | https://vidara.to/e/Qm7S4r0XJwOnQ · desconocido |
| extracción filemoon | 200 | text/html | 10821 | https://bysejikuar.com/e/zc2gluck0i0s · byse → sin-referer=fetch-error player.poseidonhd2.co=fetch-error www.poseidonhd2.co=fetch-error |
| extracción streamtape | 200 | text/html | 10825 | https://streamtape.com/e/8RJg1w83GWSMB2 · streamtape → sin-referer=fetch-error player.poseidonhd2.co=fetch-error www.poseidonhd2.co=fetch-error |
| extracción netu | 200 | text/html | 10810 | https://waaw.to/f/Hoh91aaAgCfo · desconocido |

Sonda de poseidonhd2: solo HTML y JSON del sitio; sin segmentos de vídeo.
