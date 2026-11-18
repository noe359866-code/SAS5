# CineCalidad: comprobación de enlaces directos en Node

De los sitios revisados en el [directorio de StreamFlix](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers), **CineCalidad es el único candidato que queda en la sonda**. No está habilitado en el addon: una ficha web, un iframe o un enlace HLS que no se puede leer directamente no cuentan como reproducción. No existen el complemento web ni las rutas `/streamflix/manifest.json` y `/streamflix/stream/…`.

## Evidencia

- [Primera ronda](https://github.com/noe359866-code/SAS5/actions/runs/44369844974/job/135033325228): *Matrix* y *Mufasa* publicaron HLS de Vimeos, pero el CDN devolvió **403** en ambos manifiestos.
- [Segunda ronda](https://github.com/noe359866-code/SAS5/actions/runs/44371918700/job/135040692011): el CDN también devolvió **403** en *El Origen* y *Bandidas*. El visor alternativo de esta última no expuso un medio directo visible.

## Repetir la prueba

```sh
node scripts/streamflix-candidates.js
node scripts/streamflix-candidates.js --require-direct
```

La sonda lee solo las fichas de *El Origen* y *Bandidas* en CineCalidad y las opciones públicas que apuntan a orígenes conocidos. Comprueba los primeros bytes de MP4 o del segmento HLS, su manifiesto y variante, y la pista española si el audio está separado. No guarda firmas, ejecuta scripts, reenvía vídeo ni añade cookies o cabeceras de reproducción. No comprueba la reproducción completa en el cliente. `--require-direct` falla si no hay una muestra directa con audio identificado.

[**CineCalidad (Node)**](../.github/workflows/streamflix-candidates.yml) ejecuta la sonda y sus pruebas simuladas en GitHub Actions. No consulta ni despliega Cloudflare. El addon de Node y el Worker conservan las fuentes y rutas que tenían antes de la investigación.
