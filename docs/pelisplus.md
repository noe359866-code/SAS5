# PelisPlus experimental

> **Retirada el 19-11-2026.** Esta fuente ya no está registrada en el addon:
> en las validaciones en vivo no publicó ningún medio utilizable. Se conserva el
> informe como historia. Motivos y mediciones en
> [fuentes-retiradas.md](fuentes-retiradas.md).


`pelisplus` está activo por defecto, pero una selección personal previa o
`STREAM_PROVIDERS` pueden excluirlo. El adaptador actual solo trata películas:
busca por título, verifica el título completo y el año en la ficha, y acepta
únicamente reproductores Streamwish/Filelions, VidHide y Dropload en una lista de hosts conocida y
con audio español explícito en la opción. No supone que el audio desconocido es
latino. Los episodios se omiten hasta poder identificar el capítulo exacto.

El resolver analiza campos HLS o MP4 y subtítulos VTT explícitos del visor, incluso cuando el script usa el
empaquetador compatible con `lib/vimeos.js`, sin ejecutarlo. Solo consulta los
hosts de visores permitidos y no sigue redirecciones. El dominio CDN extraído no
se consulta desde el Worker: los resultados se publican **sin comprobar el CDN** y
pueden fallar por caducidad, Referer, CORS, IP o protección del CDN. No se ha
probado la reproducción completa ni se ha confirmado en vivo que el HTML
actual tenga los campos que analiza el adaptador. Solo se implementa la extracción estática básica de VidHide y Dropload; si el host exige redirecciones, cabeceras de reproducción especiales o desafíos, puede fallar. No se implementaron los resolvers Streamtape, Netu, VOE ni el resto de los reproductores.

Se consultaron como referencias los [selectores de PelisPlus de PeliApi](https://github.com/FxxMorgan/PeliApi/blob/master/src/services/pelisplus.service.js)
y los [extractores Kotlin de Streamflix](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/extractors).
PeliApi tiene licencia MIT y Streamflix Apache 2.0. El adaptador reimplementa la extracción de campos de VidHide y Dropload consultada en Streamflix; ver [atribución y licencia](../third_party/STREAMFLIX-NOTICE.md). En particular, no se utiliza `eval` ni Puppeteer.
