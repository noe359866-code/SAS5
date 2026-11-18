# Diagnóstico de streams en el Worker publicado

**18 de noviembre de 2026 · `ramdonlatam.noe359866.workers.dev`**

El `manifest.json` anunció `catalog`, `meta` y `stream`. `/healthz` informó `cloudflare-workers` y las ocho fuentes activas en la configuración por defecto. Eso no prueba que el CDN entregue vídeo. La [sonda de producción](https://github.com/noe359866-code/SAS5/actions/runs/44239650322), realizada sobre `a11f06f`, comprobó las rutas que consulta Stremio y pidió los manifiestos candidatos a través del `/hls` del propio Worker:

| Control | Respuesta `/stream` | Candidatos | Manifiestos vía Worker |
|---|---|---:|---|
| Matrix (`tmdb:movie:603`) | 200, CORS para Stremio Web | 2 | 0/2. CDN 403; el proxy devolvió 502. |
| Breaking Bad T1E1 (`tmdb:tv:1396:1:1`) | 200, CORS para Stremio Web | 2 | 0/2. CDN 403; el proxy devolvió 502. |
| El Origen (`tt1375666`) | 200, CORS para Stremio Web | 0 | Sin candidato que probar. |

La API también devolvió los dos candidatos de Matrix y Breaking Bad con sus IDs IMDb. No hubo un fallo general de los IDs TMDB ni un bloqueo CORS en `/stream`. Los cuatro candidatos procedían de Fanpelis y SpinFlix, ambos con Vimeos. PlayLatinSRC informó `embed-http-403` en el Worker; en cambio obtuvo manifiestos válidos para Matrix en la [sonda de adaptadores desde GitHub](https://github.com/noe359866-code/SAS5/actions/runs/44238574050). Vimeos también devolvió 403 para los dos candidatos de Matrix en esa sonda de GitHub. Las pruebas indican **restricciones de acceso que varían por proveedor**, no que Cloudflare Workers deje de generar streams o que cambiar de hosting arregle todos los 403.

El `403` se observó desde el Worker. No se comprobó la descarga de segmentos, el audio ni la reproducción desde una instalación doméstica. Los HLS devueltos llevaban `notWebReady` y `proxyHeaders`, conforme a la [especificación del SDK de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md). Que aparezca un enlace no garantiza que el cliente web pueda abrirlo sin un servidor de reproducción; usar el cliente de escritorio tampoco garantiza acceso al CDN.

## Cómo volver a probarlo

- `/stream/movie/tt0133093.json` y `/stream/series/tt0903747:1:1.json` comprueban el listado. Prueba la misma ruta con el prefijo de configuración de tu instalación si tiene uno; la configuración por defecto y la selección guardada pueden usar fuentes distintas.
- `/internal/streams-test.json?type=movie&id=tt0133093` prueba la selección global. `totalStreams` cuenta candidatos; `verifiedManifests` y `mediaChecks` del diagnóstico ampliado separan un HLS comprobado (`manifest-ok`), una respuesta del CDN (`cdn-http-403`, etc.) y un enlace sin comprobación (`unchecked`). Ningún contador publica las URLs.
- **Streams del Worker publicado** (`.github/workflows/worker-streams-live.yml`), o `node scripts/worker-streams-live.js` con Node 22 y acceso a la URL, repite la sonda sin desplegar. Distingue el HTTP/CORS del API del HTTP del CDN. Un check verde dice que la API respondió según el esquema; el informe muestra por separado si el HLS falló.

El orden de los resultados prioriza los manifiestos ya validados. Los candidatos cuyo CDN impidió comprobarlos conservan la salida directa, con «sin verificar» en el nombre. Esto evita confundirlos con una prueba positiva sin cambiar la política de acceso ni sustituirlos por descargas, visores o catálogos.
