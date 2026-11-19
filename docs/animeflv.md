# AnimeFLV (`animeflv.or.at`)

Anime subtitulado al español. El adaptador vive en `lib/sites/animeflv.js`, sus
pruebas en `test/animeflv.test.js` y sus recortes reales en
`test/fixtures/sites/animeflv-*.html`.

## Estructura del sitio (medida el 19-11-2026)

| Paso | Ruta | Qué publica |
|---|---|---|
| Ficha | `/anime/<slug>/` | `h1.anime-title` con el nombre y `og:title` «Ver <título> Online Sub Español - AnimeFLV». No hay año. |
| Episodios | JSON embebido (`.animeflv-episodes-data`) | `[{post_id, permalink, number, range}]`, sin ejecutar JS. |
| Episodio | `/2026/11/15/<slug>-episodio-<N>/` | `button.iframe_code[data-src]` con el embed en **base64** y el visor en `.tooltip-text`. |
| Visores | `player.zilla-networks.com/m3u8/<token>`, Byse, UPNShare, Voe, MP4Upload | El player propio sirve un master `#EXTM3U` sin extensión en la ruta. Los opacos no se abren. |

El buscador de WordPress (`/search/<término>/`) sí filtra y sirve de respaldo
cuando el slug no es el que se dedujo del título.

## Dos fallos corregidos el 19-11-2026

1. **El registro descartaba el enlace.** El master del player propio es
   `https://player.zilla-networks.com/m3u8/<token>` y `isDirectMedia` solo
   aceptaba la extensión al final de la ruta, así que el diagnóstico salía como
   `raw 1, accepted 0`: el adaptador acertaba y la fuente no publicaba nada.
   Ahora se acepta un token bajo `/m3u8/` o `/hls/` y también un parámetro cuyo
   valor es solo la extensión (el caso de UnLimPlay en FuegoCine).
   Comprobado en la [sonda 44586425089](https://github.com/noe359866-code/SAS5/actions/runs/44586425089):
   `HTTP 200 application/x-mpegURL`, primera línea `#EXTM3U`.

2. **La temporada no se encontraba.** TMDB devuelve el título base y la
   temporada por separado («Ao Ashi», T2), mientras que el sitio nombra cada
   temporada como una obra aparte («Ao Ashi Season 2», «Black Clover 2nd
   Season»). Se intentan ahora las formas `… Season N`, `… Nth Season`,
   `… Part N` y `… Temporada N`, y la identidad de la ficha las acepta. Si el
   título de TMDB ya trae la temporada, no se duplica.

## Límites conocidos

- **Catálogo corto.** El sitio publica sobre todo lo que está en emisión. Un
  anime que no está en su catálogo —*Jujutsu Kaisen* el 19-11-2026— responde
  `no-match`; no es un fallo del adaptador ni algo que se pueda resolver con más
  peticiones.
- **Identidad solo por título.** Sin año en la ficha, se exige coincidencia
  plena del título normalizado: si TMDB traduce el nombre al español y el sitio
  usa el romaji, no hay coincidencia salvo que el título original de TMDB
  coincida.
- **Subtitulado, no doblaje.** Todos los visores van marcados `app_type="Sub"`;
  el addon publica «Subtitulado» y nunca lo anuncia como latino.
- El addon no abre el manifiesto ni comprueba segmentos: un CDN que responda
  403 a un cliente concreto se descubre al reproducir.
