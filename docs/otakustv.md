# OtakusTV (`otakustv2.com`) — evaluación del 24-11-2026

## Veredicto

**Integrada** como fuente 13 (`otakustv`) con la etiqueta «Subtitulado». Es una
web de anime con audio original y subtítulos en español declarados en la ficha;
las fichas revisadas no ofrecen doblaje al español.

## Evidencia en vivo

Sondas ejecutadas desde GitHub Actions (no desde el navegador) y registradas en
el repositorio:

| Prueba | Resultado |
|---|---|
| `.probe/anime-candidates2.md` | Buscador HTTP 200, ficha `/anime/one-piece` localizada. |
| `.probe/anime-players7.md` | Ficha → `/ver/one-piece-1180` HTTP 200; sin medio directo en el HTML principal. |
| `.probe/anime-players8.md` | `data-dwn` con `bysesukior.com/d/51sqcx0vyhf2` → extractor `byse` → HLS `edge1-madrid-sprintcdn.r66nv9ed.com`. |
| `.probe/anime-players9.md` | El HTML expone `<a data-dwn="[[…]]">` con los visores, sin ejecutar JS. |
| `.probe/otakustv-structure.md` | `Estreno: Oct 20 de 1999`, `Audio: Sub Español`, `1180 episodios`, patrón `/ver/<slug>-<N>`. |
| `.probe/otakustv-live.md` | Cadena real del adaptador con `searchOtakusTv`, manifiesto HLS sondeado. |

La cadena es:

```
/anime/<slug>  →  <h1>Nombre <i>Sub Español</i></h1>
               →  Estreno: <año> · Audio: <idioma>
               →  /ver/<slug>-<N>
               →  <a data-dwn="[[name, url], …]">
               →  bysesukior.com → HLS
```

Los otros visores de la ficha (doodstream, dhcplay, mp4upload) son opacos para
el addon y no se abren.

## Límites

- La numeración de episodios es **absoluta**: One Piece llega al 1180. El
  adaptador solo usa el número pedido para temporada 1, salvo que la ficha
  declare explícitamente otra temporada (`…-season-2`, `-2nd-season`). Así se
  evita publicar un capítulo equivocado para una temporada de TMDB.
- El buscador `?s=` de OtakusTV devuelve la portada, no resultados filtrados:
  se prueba el slug del título y, como respaldo, el directorio `/animes`.
- El audio se toma de la ficha («Sub Español», y en otras fichas «Español
  Latino»): los visores individuales no lo etiquetan.
- Un HLS válido no garantiza que el cliente reproduce el vídeo; el control en
  vivo comprueba el manifiesto, no los segmentos ni la pista de audio.

## Fuentes descartadas en esta fase

`verani.me` (403 en el runner), `ww4.animeonline.ninja` (Dooplay →
`saidochesto.top`: los `.mp4` son páginas 404/HTML de terceros, sin medio
directo), `vww.animeflv.one`, `ww1.henaojara.net` (sin reproductor útil),
`anime-jl.net` (403), `tioanime.com`, `animefenix.cloud` y
`reotaku.vercel.app` (sin fichas o solo manifiesto). Detalles completos en
`.probe/anime-candidates2.md` y `.probe/anime-players5.md`.
