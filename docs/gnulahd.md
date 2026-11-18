# GnulaHD: evaluación para RamdonLatam / Stremio

**Estado al 18 de noviembre de 2026: fuente experimental habilitada por defecto.** Aparece marcada como **GnulaHD (experimental)** en `/configure`. Una instalación con selección explícita de fuentes la conserva: si no incluye GnulaHD, hay que marcarla y actualizar la instalación. `STREAM_PROVIDERS` sigue permitiendo limitar o apagar fuentes.

El adaptador intenta fichas públicas por título y año y verifica su tipo. En series solo visita el capítulo que enlaza la ficha y comprueba la numeración y el regreso a la serie. No usa búsquedas ni APIs bloqueadas, visores o descargas. Solo ofrece un HLS enlazado en un `<video>` o `<source>` con etiqueta de audio **Latino** o **Castellano** y manifiesto válido. En esta prueba se limita al mismo origen, sin credenciales, firmas ni redirecciones seguidas. Una fuente activa **no** garantiza un resultado: [la sonda en vivo del adaptador](https://github.com/noe359866-code/SAS5/actions/runs/44238574143) localizó las seis fichas o episodios exactos, pero devolvió `no-public-media` en todos (0 streams aceptados). No se verificó reproducción externa.

Si una ficha coincide pero no ofrece un medio compatible, el adaptador puede probar las demás variantes del título y el año con un máximo total de 10 peticiones y 2,5 segundos. Si comprueba la primera variante de un manifiesto maestro, la resolución mostrada corresponde a esa variante, no al máximo anunciado por el maestro. No se descargan segmentos.

## Identidad e idioma observados en la auditoría

| Control | Identidad corroborada | Opciones del menú observado en la web |
|---|---|---|
| Matrix (1999) | Película por título y año | Latino, Subtitulado |
| El Origen (2010) | Película por título y año | Latino, Castellano, Subtitulado |
| La Odisea (2026) | Película por título y año | Latino, Subtitulado |
| Marrow (2026) | Película por título y año | **Solo Subtitulado**, pese a que el título SEO dice «Español Latino» |
| Breaking Bad T2E3 | «Picado por una abeja muerta». Enlace desde la serie, encabezado 2×03 y regreso a la misma serie | Latino, Subtitulado |
| VisionQuest T1E2 | «Teseo». Enlace desde la serie, encabezado 1×02 y regreso a la misma serie | Latino, Castellano, Subtitulado |

La [primera sonda](https://github.com/noe359866-code/SAS5/actions/runs/44236625784) también identificó *Breaking Bad* T1E2. La muestra ampliada cambió a T2E3 para comprobar una temporada distinta y añadió *Marrow* como control de idioma. En episodios, la sonda sigue el enlace exacto publicado por la serie; no construye un enlace de capítulo si no lo encuentra. Las opciones de la tabla se leen en la vista de la página, no en el audio de una pista. «Subtitulado» no cuenta como doblaje y el SEO no prevalece sobre el menú.

## Qué trae la ficha y qué queda sin observar

- **HTML inicial:** la [sonda ampliada](https://github.com/noe359866-code/SAS5/actions/runs/44237596971) encontró «Haz clic para reproducir» en los seis controles y «Cargando servidores» también en los dos episodios. Encontró **0 elementos `<video>`, 0 fuentes de vídeo y 0 iframes de reproducción** en las seis fichas inspeccionadas. Los selectores de controles de audio no identificaron sus opciones en el HTML de la sonda; eso no contradice el menú visible en la vista de la web.
- **JavaScript incluido en la ficha:** se analizó, sin ejecutarlo, el código inline seleccionado por su relación con el reproductor (12 scripts por película y 11 por episodio). En cada caso, un script incluye la creación de un elemento `video` y contiene `Hls`, `loadSource()` y `play()`. Esto muestra que el cliente contempla vídeo nativo y HLS; no demuestra que un servidor concreto entregue un manifiesto válido. Ese mismo script contiene un `POST` cuyo destino no se pudo resolver estáticamente. Las referencias declaradas a AJAX y REST de WordPress **no permiten identificar ese `POST` como la petición de reproducción**. No se observó tráfico de red al pulsar el botón.
- **Metadatos y descargas:** JSON-LD identifica películas o episodios, pero no se detectaron `VideoObject`, `contentUrl` ni `embedUrl` de vídeo, ni metadatos sociales de vídeo. No se detectaron URLs literales de medios en el JS inline analizado. Los tráilers, visores y enlaces bajo «Descargas», aunque terminen en `.mp4`, no son evidencia de un stream del reproductor.

La sonda se limita a las fichas públicas conocidas y sus enlaces publicados de episodios. No ejecuta JavaScript, descarga scripts externos, recorre el buscador o los listados, ni llama a AJAX, REST o rutas de visor que `robots.txt` excluye para clientes de IA. No consulta descargas ni sigue iframes externos. No registra cuerpos de peticiones, URLs de reproducción completas ni valores de sesión. Por tanto, **no evaluó una respuesta del reproductor, el CDN, el audio real ni Stremio**. El resultado no afirma que GnulaHD no reproduzca en su propia web.

## Qué falta verificar para considerarla estable

Primero, observar una reproducción normal y autorizada: *El Origen* permite comparar Latino con Castellano en la misma ficha; *Breaking Bad* T2E3 sirve para comprobar un episodio exacto. Hay que oír el diálogo para corroborar el idioma y distinguir un medio de un iframe. Para compartir el resultado basta indicar título, idioma oído, tipo de respuesta y estado HTTP, sin cookies, tokens, URLs firmadas ni un HAR completo.

Solo si hay una vía permitida y un medio directo, verificar un manifiesto HLS y un segmento o una respuesta MP4 con soporte de rangos, y comprobar inicio, avance y audio en Stremio. Que el medio funcione solo dentro de la página, o que su URL devuelva HTTP 200 sin un cuerpo de vídeo válido, no cumple el criterio de integración.

## Repetir la sonda

- En la instancia del addon, comprueba `sources.gnulahd` en `/healthz` y `providers.gnulahd` en `/internal/streams-test.json?type=movie&id=tt1375666` (*El Origen*). `no-public-media` significa que encontró la ficha o episodio exacto, pero no un HLS directo con las condiciones anteriores.
- Con Node 22 y las dependencias instaladas, ejecuta `node scripts/gnulahd-live.js adapter` o **GnulaHD en vivo** (`.github/workflows/gnulahd.yml`) para probar el adaptador registrado en los seis controles. Sin `adapter`, el script solo repite la inspección estática.
- `node --test test/gnulahd*.test.js` usa HTML y HLS simulados para verificar el flujo y las exclusiones. Un check verde no prueba reproducción ni audio real. El workflow no despliega.
