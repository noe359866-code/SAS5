# Diagnóstico de streams en el Worker publicado

**18 de noviembre de 2026 · `ramdonlatam.noe359866.workers.dev`**

## Medición anterior a la reparación y al retiro de fuentes

En la versión `a11f06f`, el `manifest.json` anunció `catalog`, `meta` y `stream`. `/healthz` informó `cloudflare-workers` y las ocho fuentes activas en aquel momento. Eso no prueba que el CDN entregue vídeo. La [sonda de producción](https://github.com/noe359866-code/SAS5/actions/runs/44239650322) comprobó las rutas que consulta Stremio y pidió los manifiestos candidatos a través del `/hls` del propio Worker:

| Control | Respuesta `/stream` | Candidatos | Manifiestos vía Worker |
|---|---|---:|---|
| Matrix (`tmdb:movie:603`) | 200, CORS para Stremio Web | 2 | 0/2. CDN 403; el proxy devolvió 502. |
| Breaking Bad T1E1 (`tmdb:tv:1396:1:1`) | 200, CORS para Stremio Web | 2 | 0/2. CDN 403; el proxy devolvió 502. |
| El Origen (`tt1375666`) | 200, CORS para Stremio Web | 0 | Sin candidato que probar. |

La API también devolvió los dos candidatos de Matrix y Breaking Bad con sus IDs IMDb. No hubo un fallo general de los IDs TMDB ni un bloqueo CORS en `/stream`. Los cuatro candidatos procedían de Fanpelis y SpinFlix, ambos con Vimeos. PlayLatinSRC informó `embed-http-403` en el Worker; en cambio obtuvo manifiestos válidos para Matrix en la [sonda de adaptadores desde GitHub](https://github.com/noe359866-code/SAS5/actions/runs/44238574050). Vimeos también devolvió 403 para los dos candidatos de Matrix en esa sonda de GitHub. Las pruebas indican **restricciones de acceso que varían por proveedor**, no que Cloudflare Workers deje de generar streams o que cambiar de hosting arregle todos los 403.

El `403` se observó desde el Worker. No se comprobó la descarga de segmentos, el audio ni la reproducción desde una instalación doméstica. Los HLS devueltos llevaban `notWebReady` y `proxyHeaders`, conforme a la [especificación del SDK de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md). Que aparezca un enlace no garantiza que el cliente web pueda abrirlo sin un servidor de reproducción; usar el cliente de escritorio tampoco garantiza acceso al CDN.

## Reparación de la ruta de reproducción

Para Fanpelis y SpinFlix, el Worker intenta la ruta de reproducción que ya ofrece SpinFlix, sin cambiar de fuente ni reemplazar el vídeo. El proxy de SpinFlix devuelve manifiestos con una mezcla de URL proxificadas y directas. `/hls` las normaliza y usa el mismo transporte para la variante, el audio, las claves y los segmentos. Si el manifiesto no es válido o contiene un destino fuera del CDN permitido, no se publica como validado.

- En la [comparación del transporte](https://github.com/noe359866-code/SAS5/actions/runs/44297383808), el proxy de SpinFlix entregó bytes MPEG-TS del primer segmento de **Mufasa: El rey león** (`tt13186482`) y de los primeros segmentos de vídeo y audio español de **Breaking Bad T1E2** (`tt0903747:1:2`). La comparación se ejecutó desde GitHub, no desde Cloudflare.
- En la [prueba de la rama](https://github.com/noe359866-code/SAS5/actions/runs/44298419206), `workerd` siguió la URL que devuelve `/stream` y entregó HTTP 200 con esos bytes para los dos controles. La película trae audio integrado; el episodio publica una pista española separada, que también se pidió. Se comprobó el acceso a los primeros segmentos, no que Stremio reprodujera los títulos completos.
- El [job `published-playback` de la reparación ya desplegada](https://github.com/noe359866-code/SAS5/actions/runs/44299014931/job/134783491000) obtuvo los primeros segmentos de vídeo de ambos controles y de la pista `es` separada de *Breaking Bad*, siguiendo las URLs entregadas por el Worker publicado. No comprobó la reproducción completa en Stremio ni la cobertura de anime.
- Tras cada publicación que activa ese workflow, `published-playback` repite la comprobación. Con Node 22, también se puede ejecutar `node scripts/worker-streams-live.js --playback`. A diferencia de la sonda de listados, falla si cualquiera de los dos controles no entrega medio por la ruta del Worker.

## Pruebas en vivo de las mejoras a Fanpelis y SpinFlix

La [primera sonda de la rama](https://github.com/noe359866-code/SAS5/actions/runs/44306005061/job/134807633342) encontró candidatos para ambos controles, pero no pudo seguir un HLS por el Worker. La [sonda posterior en `workerd`](https://github.com/noe359866-code/SAS5/actions/runs/44306561539/job/134809530865), con los scrapers mejorados, siguió la URL de `/stream`: **Fanpelis y SpinFlix entregaron el primer segmento de vídeo de *Mufasa* y *Breaking Bad* T1E2**, y ambos entregaron un segmento de la pista `es` separada del episodio. En la misma revisión, [la sonda directa al CDN](https://github.com/noe359866-code/SAS5/actions/runs/44306561449/job/134809731209) recibió 403. Son resultados del runner, no un nuevo despliegue ni una prueba de reproducción completa en Stremio.

Cuando una ruta no se valida, el diagnóstico distingue `mediaChecks` (resultado del HLS directo) de `transportChecks` (por ejemplo, `proxy-timeout` o `proxy-http-502`). Solo publica estados y recuentos, no las URLs ni sus firmas.

## Cómo volver a probarlo

- `/stream/movie/tt0133093.json` y `/stream/series/tt0903747:1:1.json` comprueban el listado. Prueba la misma ruta con el prefijo de configuración de tu instalación si tiene uno; la configuración por defecto y la selección guardada pueden usar fuentes distintas.
- `/internal/streams-test.json?type=movie&id=tt0133093` prueba la selección global. `totalStreams` cuenta candidatos; `verifiedManifests` y `mediaChecks` del diagnóstico ampliado separan un HLS comprobado (`manifest-ok`), una respuesta del CDN (`cdn-http-403`, etc.) y un enlace sin comprobación (`unchecked`). Ningún contador publica las URLs.
- **Streams del Worker publicado** (`.github/workflows/worker-streams-live.yml`), o `node scripts/worker-streams-live.js` con Node 22 y acceso a la URL, repite la sonda sin desplegar. Distingue el HTTP/CORS del API del HTTP del CDN. Un check verde dice que la API respondió según el esquema; el informe muestra por separado si el HLS falló.

El orden de los resultados prioriza los manifiestos ya validados. Los candidatos cuyo CDN impidió comprobarlos conservan la salida directa, con «sin verificar» en el nombre. Esto evita confundirlos con una prueba positiva sin cambiar la política de acceso ni sustituirlos por descargas, visores o catálogos.
