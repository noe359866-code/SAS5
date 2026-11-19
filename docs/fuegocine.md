# FuegoCine

La fuente está **registrada otra vez** desde el 19-11-2026; el diagnóstico de su
primer intento se conserva más abajo como historia. El adaptador vive en
`lib/sites/fuegocine.js`, sus pruebas en `test/fuegocine.test.js` y la sonda en
`scripts/fuegocine-probe.mjs` más la entrada `fuegocine` de
`scripts/sites-probe.mjs`.

## Readmisión (19-11-2026)

El motivo del retiro era el camino, no el sitio: se buscaba el título en el
sitemap y la ficha solo publica el tráiler. La ruta que sí entrega el medio:

1. `GET /search_elastic?s=<título>` — el `?s=` del sitio no filtra nada. El HTML
   separa `<h3>Películas</h3>` y `<h3>Series</h3>`; cada tarjeta es
   `.single-video > a[href]` con el título en `.video-item-content`.
2. `pick` exige el mismo tipo y una puntuación de título suficiente; los slugs
   no se deducen porque llevan acentos (`spider-man-un-nuevo-día/140`).
3. Películas: `details` → `watch` (mismo slug e ID). Series:
   `/shows/details/<slug>/<id>` → `/shows/<slug>/seasons/temporada-<N>/<id>` →
   `/shows/<slug>/<SSxEE-titulo>/<id>`. Nunca se sustituye el capítulo pedido.
4. La página de reproducción publica tres `<iframe>`: `videro.my` (desafío de
   Cloudflare), `abyssplayer`/`embedorigin` (el medio se arma con JS) y
   `unlimplay.com`, el único que lo publica en el HTML. Los demás no se abren y
   se cuentan en `notes.opaque`.
5. El visor trae `const EMBEDS = {"latino": {…}, "castellano": {…},
   "subtitulado": {…}}`. El idioma lo declara el propio visor, no hay que
   adivinarlo. De cada grupo se toma el HLS de `cps.php?t=…&e=…&s=…&x=.m3u8`
   (se prioriza `direct`) y se publica con su caducidad: `e` en segundos.

Límites conocidos: en los episodios el grupo «español» solo ofrece
`mf.php?man=…`, un manifiesto que el addon no descarga, así que ese audio se
descarta; y los episodios escriben `<iframe src=…>` **sin cerrar**, por lo que
los visores se leen con una expresión regular y no con el DOM (el primer
`iframe` se tragaría a los demás como texto crudo).

### Medición en vivo

[Run 44536115877](https://github.com/noe359866-code/SAS5/actions/runs/44536115877)
(`Adaptadores de sitios en vivo`, 19-11-2026), sobre los controles del runner:

| Control | Resultado |
|---|---|
| *Spider-Man: Un nuevo día* (2026) | 3 hits HLS: Latino, Castellano y Subtitulado |
| *La Odisea* (2026) | 2 hits HLS: Latino y Subtitulado |
| *VisionQuest* S1E1 | 2 hits HLS por la cadena de serie: Latino y Subtitulado |
| *Inception*, *Breaking Bad*, *Naruto*, *Intensamente 2*, … | `no-match`: el catálogo del sitio es de estrenos y el buscador no devuelve esas fichas |

En el resto de controles ninguna fuente nueva coincide salvo Cuevanas 3, que
tiene fondo de catálogo; el nicho de FuegoCine son los estrenos.

## Por qué no salía ningún stream (19-11-2026)

El adaptador funcionaba y el registro lo tiraba. El diagnóstico del Worker
mostraba `fuegocine: raw 3, accepted 0` para *Spider-Man: Un nuevo día*: el
visor entrega `https://unlimplay.com/cps.php?t=…&e=…&s=…&x=.m3u8`, donde la
extensión va en el parámetro `x`, y `isDirectMedia` solo aceptaba `.m3u8` al
final de la **ruta**. Las tres pistas (Latino, Castellano y Subtitulado) se
descartaban en silencio y la fuente no publicaba nada.

Corregido el filtro (un parámetro cuyo valor es solo la extensión, y el token
bajo `/m3u8/…` del player de AnimeFLV), la sonda en vivo confirma que el enlace
es un manifiesto de verdad: `HTTP 200 application/vnd.apple.mpegurl` con
`#EXTM3U` en la primera línea, con el `User-Agent` del addon y también con
`Referer: https://unlimplay.com/` y con `Accept: application/vnd.apple.mpegurl`
([run 44586425089](https://github.com/noe359866-code/SAS5/actions/runs/44586425089)).
Un `GET` con `Accept: text/html` —lo que hace un navegador— sí devuelve el
reproductor en lugar del manifiesto, así que la comprobación de la sonda usa las
cabeceras de un reproductor, no las de una página.

Lo que el addon sigue sin hacer: abrir el manifiesto ni comprobar segmentos. Si
el CDN devuelve 403 a un cliente concreto, se descubre al reproducir, y el
visor no es constante: en la misma pasada, los enlaces de *La Odisea*
respondieron **502** con cualquier cabecera mientras los de *VisionQuest* y
*Spider-Man* devolvían el manifiesto. Es un fallo del CDN de UnLimPlay, no del
adaptador; los enlaces caducan por `e` y se retiran antes de tiempo.

## Diagnóstico del primer intento (histórico)

El adaptador buscaba el título en el sitemap, con portada y listado como respaldo. Para las series usaba el enlace de la ficha si coincidía exactamente con la temporada y el episodio solicitados; si no, consultaba la temporada. No sustituía el capítulo solicitado por el que aparecía primero en la ficha. La sonda no publicaba enlaces firmados ni seguía redirecciones a otros orígenes.

## Resultados observados

- [Sonda 44232109738](https://github.com/noe359866-code/SAS5/actions/runs/44232109738): la redirección al mismo visor de UnLimPlay permitió leer un literal HLS para *Ciudad de Dios*, pero el CDN devolvió HTTP 403. El enlace auxiliar de UnLimPlay no se usa como fuente del título. Videro devolvió un desafío al runner.
- [Sonda 44232301577](https://github.com/noe359866-code/SAS5/actions/runs/44232301577): se localizaron seis visores de películas y dos visores de episodios; ninguno se convirtió en un medio directo compatible. Los dos episodios enlazaron a Stream Origin sin vídeo directo visible en la respuesta. UnLimPlay agotó el plazo en esta ejecución.

Las respuestas observadas son del runner de GitHub; no comprueban reproducción ni idioma en Stremio. El adaptador no publicó un iframe ni un enlace no verificado de esas sondas como vídeo.
