# Pruebas de enlaces directos de StreamFlix (Node)

Se consultó el [directorio público de proveedores](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers) para identificar fuentes en español sin usar la cuota del Worker. Una ficha HTML, un iframe o una descarga no cuentan como reproducción directa. El complemento de enlaces web probado en la primera ronda se retiró: ni Express ni Cloudflare publican `/streamflix/manifest.json`.

## Primera comprobación

La [ronda inicial](https://github.com/noe359866-code/SAS5/actions/runs/44369844974/job/135033325228) del 18-11-2026 verificó las fichas de Matrix (1999) en PelisflixHD y de Breaking Bad T1E2 en SeriesFlix. No verificó vídeo directo en esos visores. CineCalidad expuso HLS en Matrix y Mufasa, pero el CDN devolvió 403 en ambos. Los controles de Latanime y LaCartoons tampoco certificaron un medio; TioPlus respondió 521 y MovieMaster documentó que su servicio requiere un iframe con enlaces ligados a la conexión del visitante.

## Segunda comprobación

`node scripts/streamflix-candidates.js` sondea otros títulos y episodios desde Node. Busca URLs públicas en las etiquetas de vídeo y en la configuración estática de la ficha y del visor. Como máximo abre dos visores permitidos y sigue una redirección pública entre visores conocidos. No sigue redirecciones del CDN, ejecuta scripts, añade cabeceras de reproducción ni pide credenciales. Comprueba una muestra de hasta 384 bytes: en HLS lee el manifiesto, la variante y el segmento; si hay audio separado, también la pista española. No guarda URLs del medio ni contenido, ni mide reproducción completa o CORS del cliente.

La [segunda ejecución, en GitHub Actions](https://github.com/noe359866-code/SAS5/actions/runs/44371918700/job/135040692011), dio **0 de 11 controles** con un HLS/MP4 directo y audio identificado. No se incorporó ninguno de los siete proveedores.

| Fuente | Control de la segunda ronda | Resultado |
|---|---|---|
| CineCalidad | El Origen (2010), Bandidas (2006) | Vimeos publicó el HLS, pero el CDN respondió 403 en ambos manifiestos. El visor alternativo de Bandidas no ofreció un medio directo visible. |
| PelisflixHD | Interestelar, Jurassic World | Visores Nupload y, en Jurassic World, VOE. No apareció HLS/MP4 literal en los visores latinos y castellanos sondeados. |
| SeriesFlix | Breaking Bad T2E1, Better Call Saul T1E1 | Nupload/VOE no ofrecieron medio directo en las opciones latinas ni castellanas muestreadas. |
| Latanime | Death Note, capítulo 1 (Latino y Castellano) | Visores disponibles; la muestra no encontró HLS/MP4 comprobable. Hubo una redirección a un origen no validado, que no se abrió. |
| LaCartoons | Avatar: La leyenda de Aang T1E1 | Ficha del episodio disponible, sin URL de vídeo o visor visible para la sonda. |
| TioPlus | El Origen (búsqueda) | HTTP 521. |
| CineHax / MovieMaster | El Origen (visor) | HTML con estado público, sin URL directa visible. La [integración documentada](https://api.moviemaster.lat/docs) usa un iframe. |

`node scripts/streamflix-candidates.js --require-direct` falla si ningún control tiene una muestra con audio identificado. El workflow [Candidatos de StreamFlix (Node)](../.github/workflows/streamflix-candidates.yml) también ejecuta pruebas con respuestas simuladas, sin tocar producción. Express, `worker.mjs`, `wrangler.toml`, el registro de fuentes y los assets quedaron como en la base de esta rama. El bundle de Wrangler 4.159.0 conservó el mismo SHA-256 que la base; la sonda no añade peticiones al Worker.
