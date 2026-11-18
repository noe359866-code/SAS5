# GnulaHD: evaluación como fuente de SAS5

**Estado: candidato, no habilitado.** Se inspeccionó `ww3.gnulahd.nu` el 18 de noviembre de 2026. Las fichas y los capítulos se identificaron; no se verificó un medio directo con audio identificado en español. No se modificó el registro de fuentes ni `/configure`.

| Control | Identidad corroborada | Opciones que muestra la web |
|---|---|---|
| Matrix (1999) | Película | Latino y Subtitulado |
| El Origen (2010) | Película | Latino, Castellano y Subtitulado |
| La Odisea (2026) | Película | Latino y Subtitulado |
| Breaking Bad T1E2 | Enlace del capítulo desde la serie y regreso a la misma serie | Latino y Subtitulado |
| VisionQuest T1E2 | Enlace del capítulo desde la serie y regreso a la misma serie | Latino, Castellano y Subtitulado |

En los cinco controles, [la sonda de Actions](https://github.com/noe359866-code/SAS5/actions/runs/44236625784) encontró **0 elementos de vídeo, 0 iframes de reproducción y 0 URLs literales de medios** en el análisis estático, tras separar descargas y tráilers. El menú que se ve al navegar no confirma por sí solo la URL ni el audio de una pista. Hay referencias a carga de servidores y a AJAX en el código de la página; no se probó la respuesta del reproductor dinámico. Los enlaces MP4 que aparecen bajo **Descargas** no cuentan como streams.

`robots.txt` limita el acceso automatizado al buscador y reserva otras rutas para determinados clientes. La sonda solo consulta fichas públicas conocidas y enlaces de episodios que publican esas fichas. No consulta la búsqueda, rutas AJAX, cuentas ni descargas; no sigue visores de terceros ni ejecuta JavaScript. Tampoco se probó acceso al CDN, reproducción o audio en Stremio.

Para repetir la inspección, usa **GnulaHD en vivo** (`.github/workflows/gnulahd.yml`) o ejecuta `node scripts/gnulahd-live.js` con Node 22 y las dependencias instaladas. El check verde significa que terminó el diagnóstico, no que haya streams compatibles. El workflow no despliega.
