# FuegoCine: diagnóstico y pruebas

El adaptador busca el título en el sitemap, con portada y listado como respaldo. Para las series usa el enlace de la ficha si coincide exactamente con la temporada y el episodio solicitados; si no, consulta la temporada. No sustituye el capítulo solicitado por el que aparece primero en la ficha.

## Comprobar solo FuegoCine

```sh
node --test test/fuegocine.test.js
node scripts/fuegocine-live.js
```

En GitHub Actions, el workflow **FuegoCine en vivo** ejecuta las regresiones y una sonda informativa. El resultado verde indica que terminaron las pruebas; no garantiza que haya un stream. La sonda no publica enlaces firmados ni sigue redirecciones a otros orígenes.

## Resultados observados

- [Sonda 44232109738](https://github.com/noe359866-code/SAS5/actions/runs/44232109738): la redirección al mismo visor de UnLimPlay permitió leer un literal HLS para *Ciudad de Dios*, pero el CDN devolvió HTTP 403. El enlace auxiliar de UnLimPlay no se usa como fuente del título. Videro devolvió un desafío al runner.
- [Sonda 44232301577](https://github.com/noe359866-code/SAS5/actions/runs/44232301577): se localizaron seis visores de películas y dos visores de episodios; ninguno se convirtió en un medio directo compatible. Los dos episodios enlazaron a Stream Origin sin vídeo directo visible en la respuesta. UnLimPlay agotó el plazo en esta ejecución.

Las respuestas observadas son del runner de GitHub; no comprueban reproducción ni idioma en Stremio. El adaptador no publica un iframe ni un enlace no verificado de esas sondas como vídeo.
