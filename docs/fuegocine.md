# FuegoCine: diagnóstico histórico

El adaptador, sus pruebas y el workflow **FuegoCine en vivo** se retiraron. Consulta el [README](../README.md#fuentes-de-reproducción) para las fuentes y las sondas vigentes.

El adaptador buscaba el título en el sitemap, con portada y listado como respaldo. Para las series usaba el enlace de la ficha si coincidía exactamente con la temporada y el episodio solicitados; si no, consultaba la temporada. No sustituía el capítulo solicitado por el que aparecía primero en la ficha. La sonda no publicaba enlaces firmados ni seguía redirecciones a otros orígenes.

## Resultados observados

- [Sonda 44232109738](https://github.com/noe359866-code/SAS5/actions/runs/44232109738): la redirección al mismo visor de UnLimPlay permitió leer un literal HLS para *Ciudad de Dios*, pero el CDN devolvió HTTP 403. El enlace auxiliar de UnLimPlay no se usa como fuente del título. Videro devolvió un desafío al runner.
- [Sonda 44232301577](https://github.com/noe359866-code/SAS5/actions/runs/44232301577): se localizaron seis visores de películas y dos visores de episodios; ninguno se convirtió en un medio directo compatible. Los dos episodios enlazaron a Stream Origin sin vídeo directo visible en la respuesta. UnLimPlay agotó el plazo en esta ejecución.

Las respuestas observadas son del runner de GitHub; no comprueban reproducción ni idioma en Stremio. El adaptador no publicó un iframe ni un enlace no verificado de esas sondas como vídeo.
