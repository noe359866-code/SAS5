# Candidatos de StreamFlix y complemento web de Node

Se consultó el [directorio público de proveedores de StreamFlix](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers) para elegir fuentes en español. La [sonda desde Node](https://github.com/noe359866-code/SAS5/actions/runs/44369191506/job/135031037294) del 18 de noviembre de 2026 separó la ficha del visor y del archivo de vídeo. Ningún control demostró reproducción directa aceptable en Stremio.

| Fuente | Qué se comprobó | Decisión |
|---|---|---|
| PelisflixHD (`.love`) | Matrix y Mufasa muestran opciones de Latino y Castellano. En los visores de Nupload muestreados no apareció HLS/MP4 público. El addon Node resolvió la ficha exacta de **Matrix (1999)** por IMDb. | Enlace web para películas. |
| SeriesFlix (`.boats`) | Breaking Bad T1E2 muestra opciones de Latino y Castellano. Sin medio público en el visor muestreado. El addon Node resolvió el episodio exacto por IMDb, siguiendo la temporada y la fila del capítulo. | Enlace web para episodios. |
| CineCalidad (`.am`) | HLS visible en Vimeos para Matrix y Mufasa; el CDN devolvió **403** al consultar ambos manifiestos sin cabeceras de reproducción. | No incorporado; usa el mismo tipo de visor que fuentes que ya existen. |
| Latanime | Naruto capítulo 1 en Latino y Castellano: fichas con visores, sin medio directo en los muestreados. Numera capítulos de forma plana, sin correspondencia de temporadas verificada. | No incorporado. |
| LaCartoons | Ben 10 T1E1: ficha sin URL en el selector de iframe sondeado. | No incorporado. |
| TioPlus, CineHax/MovieMaster | TioPlus: 521 en la búsqueda. [MovieMaster](https://api.moviemaster.lat/docs): integración mediante iframe; su documentación indica que las URLs del medio van ligadas a la conexión del reproductor. | No incorporados. |

## Activar y probar

Define `STREAMFLIX_NODE_PROVIDERS=pelisflixhd,seriesflix` en `.env` para `npm start` o en el entorno de tu servidor Node. Instala **el manifest adicional** `https://<tu-host-node>/streamflix/manifest.json` en Stremio; conserva tu instalación principal. No hace falta cambiar `STREAM_PROVIDERS`. La opción es independiente y está apagada por defecto. Con un solo proveedor seleccionado, su manifest solo anuncia películas o series, según corresponda.

```sh
# Tras arrancar npm start con la opción habilitada:
curl http://localhost:7000/streamflix/manifest.json
curl http://localhost:7000/streamflix/stream/movie/tt0133093.json
curl http://localhost:7000/streamflix/stream/series/tt0903747:1:2.json
```

`externalUrl` es una página pública para abrir en el navegador, no un HLS/MP4. El idioma es el anunciado por la ficha, no una pista de audio comprobada. Una falta de coincidencia, un rechazo del proveedor o cambios en su HTML pueden dar `streams: []`. El addon reutiliza los metadatos existentes de TMDB, TVMaze y Cinemeta para identificar el título y el año; TMDB ayuda con los títulos traducidos. Solo consulta páginas de los orígenes declarados, con un presupuesto de cinco peticiones y cinco segundos por fuente para la búsqueda y comprobación de fichas. No sigue redirecciones, no abre visores y no sirve bytes de vídeo.

## Aislamiento y validación

- Solo `api/index.js` monta las rutas; `worker.mjs`, `wrangler.toml`, `lib/` y `public/` no cambian. La opción no añade invocaciones, subpeticiones ni bytes al Worker de Cloudflare. Se compararon ambos bundles de Wrangler 4.159.0 con `cmp`; son idénticos.
- `npm test` incluye pruebas de coincidencias, audio anunciado, apagado y de que el Worker devuelve 404 para el manifest y el stream adicionales, sin `fetch`.
- `node scripts/streamflix-live.js` comprueba los dos enlaces a través de Express. `node scripts/streamflix-candidates.js` vuelve a sondear las muestras de candidatos por separado. Ambas pruebas requieren acceso a las webs externas; el workflow `Candidatos de StreamFlix (Node)` las ejecuta sin desplegar ni consultar el Worker publicado. No prueban reproducción completa en el cliente.
