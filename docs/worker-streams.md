# Diagnóstico de streams y CDN directo

## Ruta actual: sin retransmisión

`/stream` devuelve las URLs originales de los medios. El Worker puede consultar un manifiesto para elegir el mejor candidato, pero **no entrega medios al reproductor**: el servicio de streaming de Stremio, si está disponible, solicita al CDN los manifiestos, variantes, pistas, claves y segmentos. La antigua ruta `/hls` responde 404 y no consulta al proveedor. Se cambió la clave de la caché de `/stream` para no servir JSON con URLs del transporte anterior.

Esto elimina las invocaciones al Worker que antes generaba cada petición de reproducción a `/hls`. La búsqueda de streams sigue siendo dinámica y puede hacer consultas a los proveedores al faltar la caché. El cambio no reinicia una cuota agotada ni garantiza que el uso total quede por debajo del límite del plan gratuito.

El addon solicita el proxy del servicio de streaming de Stremio con `behaviorHints.proxyHeaders` para todos los streams, tanto HLS como MP4. Cuando el adaptador conoce el visor, añade su `Origin` y `Referer`; de otro modo envía un objeto de cabeceras vacío. [Stremio puede transformar ese hint en una URL de su servidor de streaming](https://github.com/Stremio/stremio-core/blob/development/src/types/resource/stream.rs), pero depende del cliente y de que el servidor esté disponible; sin él puede seguir directo. Se mantiene `notWebReady`. Las cabeceras asociadas al visor son una hipótesis de reproducción y necesitan pruebas reales: un 403, la falta de CORS o incompatibilidades de HLS pueden persistir. El addon no retransmite vídeo.

## Cómo probarlo

- **API:** `/stream/movie/tt0133093.json` y `/stream/series/tt0903747:1:1.json` comprueban el listado. Si tu instalación tiene un prefijo de configuración, prueba la misma ruta con ese prefijo; la selección guardada puede usar otras fuentes. Un HTTP 200 con CORS en `/stream` solo confirma la respuesta de la API.
- **Manifiesto:** `/internal/streams-test.json?type=movie&id=tt0133093` prueba la selección global. `totalStreams` cuenta candidatos. El addon ya no sondea el medio (`mediaProbed: false`), así que el diagnóstico no distingue manifiestos válidos de caídos: para eso está la sonda de este documento, que consulta el CDN desde el runner. El diagnóstico no publica URLs firmadas.
- **Primeros bytes:** `node scripts/worker-streams-live.js --playback` consulta `/stream` en el Worker publicado y, para *Mufasa: El rey león* y *Breaking Bad* T1E2, sondea hasta un HLS de Vimeos por fuente. Solicita directamente al CDN el manifiesto, la primera variante, el primer segmento de vídeo y, si se anuncia por separado, el primer segmento de una pista `es`. Informa HTTP y CORS por separado y comprueba la cabecera del segmento, sin guardar el medio ni usar cabeceras especiales de reproducción. Los candidatos con proxy se cuentan y se omiten: esta sonda no prueba el proxy de Stremio y ahora puede no sondear ningún medio.
- **Reproducción real:** un manifiesto válido o unos primeros bytes no verifican todas las variantes, claves, audio integrado ni la reproducción completa. Esa prueba requiere abrir el título en el cliente de Stremio y en la red del usuario.

Con Node 22:

```sh
node scripts/worker-streams-live.js                     # manifest, /stream y HLS del CDN
node scripts/worker-streams-live.js --playback           # muestra de segmentos desde los enlaces publicados
node scripts/worker-streams-live.js --playback http://127.0.0.1:8799 --expect-direct
```

El último comando requiere `wrangler dev` en el puerto 8799. `--expect-direct` es una opción histórica que falla con la configuración actual porque devuelve hints de proxy; `--require-media` exige al menos una muestra de medio válida por título. Sin este último flag, un 403 del CDN no se interpreta como fallo de `/stream`. El workflow **Streams del Worker y CDN directo** usa `workerd` local en ramas `arena/`; consulta producción solo en `main` o al ejecutarlo manualmente y no despliega cambios.

## Primera comprobación de la rama sin proxy

La [sonda en `workerd` local de GitHub Actions](https://github.com/noe359866-code/SAS5/actions/runs/44309509520/job/134819669426) probó `3a60617`. Ambos controles devolvieron HTTP 200, CORS y dos enlaces directos en `/stream`. Los resultados del CDN fueron:

| Control | Fanpelis | SpinFlix |
|---|---|---|
| *Mufasa: El rey león* | Manifiesto HTTP 403. | Manifiesto y primera variante HTTP 200; primer segmento HTTP 206 MPEG-TS, con CORS. No se comprobó audio por separado. |
| *Breaking Bad* T1E2 | Manifiesto HTTP 403. | Manifiesto HTTP 403. |

En la [sonda independiente de adaptadores](https://github.com/noe359866-code/SAS5/actions/runs/44309509522/job/134819869156), los cinco candidatos recibieron 403 al pedir el HLS directo. Son pruebas desde el runner: no verifican el despliegue de la rama ni la reproducción en Stremio.

## Resultados históricos (no prueban la ruta directa actual)

**18 de noviembre de 2026 · `ramdonlatam.noe359866.workers.dev`**

Antes de retirar fuentes y el proxy, el `manifest.json` de `a11f06f` anunció `catalog`, `meta` y `stream`, y `/healthz` informó `cloudflare-workers` y ocho fuentes activas. La [sonda de producción](https://github.com/noe359866-code/SAS5/actions/runs/44239650322) pidió los manifiestos a través de `/hls`:

| Control | Respuesta `/stream` | Candidatos | Manifiestos vía Worker |
|---|---|---:|---|
| Matrix (`tmdb:movie:603`) | 200, CORS para Stremio Web | 2 | 0/2. CDN 403; el proxy devolvió 502. |
| Breaking Bad T1E1 (`tmdb:tv:1396:1:1`) | 200, CORS para Stremio Web | 2 | 0/2. CDN 403; el proxy devolvió 502. |
| El Origen (`tt1375666`) | 200, CORS para Stremio Web | 0 | Sin candidato que probar. |

También hubo candidatos para Matrix y Breaking Bad por IMDb. No fue un fallo general de IDs TMDB ni de CORS en `/stream`. Las cuatro URLs procedían de Fanpelis y SpinFlix, ambos con Vimeos. PlayLatinSRC obtuvo `embed-http-403` en el Worker pero entregó manifiestos válidos para Matrix en la [sonda de GitHub](https://github.com/noe359866-code/SAS5/actions/runs/44238574050). Cambiar de red o de hosting por sí solo no garantizó acceso.

La [reparación anterior, PR #33](https://github.com/noe359866-code/SAS5/pull/33), conectó `/hls` al transporte de SpinFlix y reescribía los manifiestos para que las pistas y los segmentos pasaran por el Worker. La [comparación de transportes](https://github.com/noe359866-code/SAS5/actions/runs/44297383808), la [prueba en workerd](https://github.com/noe359866-code/SAS5/actions/runs/44298419206) y la [prueba publicada](https://github.com/noe359866-code/SAS5/actions/runs/44299014931/job/134783491000) obtuvieron los primeros segmentos de vídeo de *Mufasa* y *Breaking Bad* T1E2, además de una muestra de la pista `es` separada del episodio, **con proxy**, no reproducción completa.

Tras mejorar los scrapers, la [primera sonda de la rama](https://github.com/noe359866-code/SAS5/actions/runs/44306005061/job/134807633342) encontró candidatos pero no validó ninguno vía Worker; [otra ejecución](https://github.com/noe359866-code/SAS5/actions/runs/44306561539/job/134809530865) sí leyó los primeros segmentos por el proxy de ambas fuentes para los dos controles. En cambio, [la sonda directa de esa revisión](https://github.com/noe359866-code/SAS5/actions/runs/44306561449/job/134809731209) recibió 403 del CDN. Son mediciones del runner, no pruebas de reproducción en una instalación doméstica.
