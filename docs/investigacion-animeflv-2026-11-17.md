# Investigación: animeflv.or.at (17-11-2026)

Este dominio es un sitio WordPress distinto de animeflv.net. Se ha añadido como proveedor experimental limitado a primera temporada; sigue pendiente validar reproducción completa y la correspondencia de temporadas posteriores.

## Hallazgos

- La búsqueda `/?s=one+piece` devuelve fichas en `/anime/…/`. La ficha observada contiene datos JSON de episodios con `permalink` y `number`; One Piece presenta números absolutos y cobertura parcial (en la prueba, 1167–1180). No se puede equiparar sin más el episodio de una temporada de Stremio a ese número.
- En un episodio de Sora wa Akai Kawa no Hotori se observó una opción HLS con URL codificada en base64 en `data-src` y `app_type="Sub"`, además de reproductores embed. «Sub» indica subtítulos, no que el audio sea español.
- El runner de GitHub recibió HTTP 200 y `application/x-mpegURL` para esa opción; contiene `#EXTM3U` y una suma de segmentos de aproximadamente 1370 segundos. Los segmentos observados usan extensión `.html`. Esto no demuestra que contengan el episodio correcto, que no haya anuncios, ni que funcionen en Stremio o desde el Worker.
- La ruta HLS observada no tiene extensión: no pasa el filtro conservador actual. Otros reproductores son embeds y no deben entregarse como vídeo directo.

## Pendiente antes de activar

1. Demostrar una correspondencia inequívoca de título, temporada y episodio, incluyendo series con numeración absoluta y remakes; omitir resultados ambiguos.
2. Validar de forma restringida la ruta HLS y comprobar tipos, acceso y reproducción de playlist y segmentos en el cliente y Worker desplegados. No ampliar genéricamente el filtro ni la whitelist del proxy a rutas HTML arbitrarias.
3. Distinguir idioma de audio y subtítulos, respetar selección de idioma desconocido y mantener instalaciones previas.
4. Añadir pruebas con fixtures y registrar solo la extracción directa comprobada, sin fallback a embeds. Mantener límites de subrequests y documentar que una playlist no garantiza contenido ni ausencia de publicidad.

La sonda reproducible está en `scripts/animeflv-probe.mjs` y se ejecuta en `.github/workflows/providers.yml`; resultados observados en la ejecución de GitHub Actions 44187800831.
