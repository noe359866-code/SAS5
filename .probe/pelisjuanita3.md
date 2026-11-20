# Sonda 3 de pelisjuanita.org (idioma en el visor)

| paso | url | estado | tipo | cf | bytes | notas |
|---|---|---|---|---|---|---|
| api item película | `pelisjuanita.org/api/rest/v1/item?id=…` | 200 | application/json | - | 2048 | claves cache,items · sin campo de idioma |
| api item serie | `pelisjuanita.org/api/rest/v1/item?id=…` | 200 | application/json | - | 1728 | claves cache,items · sin campo de idioma |
| player movie | `videoapp.mov/e/movie/969681` | 200 | text/html | - | 19470 | 1 iframes [vimeos.net/embed-2nulhg4mnuz7.html?cf=…] |
| embed vimeos movie | `vimeos.net/embed-2nulhg4mnuz7.html?cf=…` | 200 | text/html | - | 37768 | señales: "label": "lang": · 3 medios [p2.vimeos.zip/hls2/02/00013/2nulhg4mnuz7_,n,h,.urlset/master.m3u8?t=…&s=…&e=…&v=…&srv=…&i=…&sp=…&fr=…&r=… s1.vimeos.net/vtt/02/00013/2nulhg4mnuz7_spa.vtt s1.vimeos.net/vtt/02/00013/2nulhg4mnuz7_eng.vtt] · empaquetado: no |
| player tv | `videoapp.mov/e/tv/1396/1/1` | 200 | text/html | - | 19451 | 1 iframes [vimeos.net/embed-ccjygcfxujhd.html?cf=…] |
| embed vimeos tv | `vimeos.net/embed-ccjygcfxujhd.html?cf=…` | 200 | text/html | - | 37215 | señales: "label": "lang": · 2 medios [s9.vimeos.net/hls2/02/00005/ccjygcfxujhd_,n,h,.urlset/master.m3u8?t=…&s=…&e=…&v=…&i=…&sp=…&fr=…&r=… s9.vimeos.net/vtt/02/00005/ccjygcfxujhd_spa.vtt] · empaquetado: no |

Sonda de diagnóstico: las firmas se recortan antes de guardar; no se descarga el manifiesto.
