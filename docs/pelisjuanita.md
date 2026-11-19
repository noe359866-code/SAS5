# PelisJuanita

Fuente registrada el 19-11-2026. Adaptador en `lib/sites/pelisjuanita.js`,
pruebas en `test/pelisjuanita.test.js` y sondas en
`scripts/pelisjuanita-probe{,2,3}.mjs` (más la entrada `pelisjuanita` de
`scripts/sites-probe.mjs`).

## Cómo está montado el sitio

Es una SPA («vidapi», tema `popr`) que se pinta en el navegador, pero **el HTML
de la portada trae `window.siteConfig` con los endpoints públicos**, así que no
hace falta ejecutar JavaScript:

| Paso | Qué se pide | Qué se usa |
|---|---|---|
| Búsqueda | `GET /api/rest/v1/search?q=<título>` | `items[]` con `kind` (`movie`, `serie`, `anime`), `slug`, `title`, `year`, `tmdb_id`, `catalog_item_id` |
| Ficha | `GET /api/rest/v1/content/<movie\|serie>/<slug>` | solo metadatos: no publica servidores |
| Temporadas | `GET /api/rest/v1/episode-seasons?item_id=<catalog_item_id>` | `seasons[]` |
| Episodios | `GET /api/rest/v1/episodes?item_id=<…>&season=<N>` | `episodes[]` con `playable` y `player_url` |
| Reproductor | `https://videoapp.mov/e/movie/<tmdb_id>` o el `player_url` del episodio | un `<iframe id="frame">` de `vimeos.net/embed-…` |
| Visor | el embed de Vimeos | `master.m3u8` firmado, subtítulos y `subDub` |

Decisiones del adaptador:

- **Identidad**: el título debe coincidir y el tipo también (`serie` y `anime`
  son series). Si el año de la ficha no cuadra con el pedido, no se elige: dos
  obras pueden llamarse igual.
- **Episodios**: no se sustituye la temporada ni el capítulo pedidos. Si el
  sitio no lista esa temporada, el resultado es `no-season`; si el capítulo no
  está o viene con `playable: false`, `no-episode`.
- **Audio**: lo declara el visor en `subDub` — `sub` → *Subtitulado*,
  `lat`/`dub` → *Latino*, `cas` → *Castellano*. Si no lo declara, el resultado
  es `audio-unverified` y no se publica nada: los subtítulos no prueban el
  audio.
- **Medio**: se valida la forma del `master.m3u8` (host de Vimeos, sin
  credenciales, firma viva) y **no se descarga el manifiesto**. Los `.vtt` del
  visor se adjuntan como subtítulos, con `es`/`en` según su etiqueta.
- **`Referer`**: `videoapp.mov` solo monta el `<iframe>` si la petición viene de
  `pelisjuanita.org`. Sin esa cabecera la página llega sin reproductor y todo se
  degradaba a `no-players`; está fijado con una prueba.

Presupuesto por búsqueda: 3 peticiones en películas (búsqueda, reproductor y
visor) y 5 en series (más temporadas y episodios). El API corta en 24 resultados
por página, así que si el título no aparece y la respuesta trae `has_next`, se
pide la segunda página: como mucho suma una petición por título probado.

## Medición en vivo

[Run 44542093852](https://github.com/noe359866-code/SAS5/actions/runs/44542093852)
(`Adaptadores de sitios en vivo`, 19-11-2026):

| Control | Resultado |
|---|---|
| *Spider-Man: Un nuevo día*, *Alien: Romulus*, *Deadpool & Wolverine* | 1 hit HLS cada uno, audio Subtitulado |
| *Breaking Bad* T1E1, *Naruto* T1E1, *VisionQuest* T1E1 | 1 hit HLS cada uno por la cadena de serie, audio Subtitulado |
| *El reino prohibido*, *La Odisea* | 1 hit HLS cada uno, audio Subtitulado |
| *Inception*, *Intensamente 2*, *Ao Ashi*, *Black Clover* | `no-match`: el buscador del sitio no devuelve esas fichas con el título que manda el addon (el catálogo es de títulos en español) |

Todas las muestras del sitio salieron marcadas `subDub: "sub"`, es decir,
versión subtitulada: es el audio que se publica. Si el sitio sirviera una
versión doblada, el mismo campo la anunciaría como *Latino* sin cambiar el
adaptador.
