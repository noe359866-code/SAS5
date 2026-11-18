# FlixLatam y Cuevana 3: verificación histórica

Estos adaptadores y sus sondas ya no forman parte del addon. Consulta el [README](../README.md#fuentes-de-reproducción) para las fuentes vigentes.

Se consultó cada fuente por separado, sin usar los resultados de otra. La identificación de la ficha o del episodio es distinta de encontrar un medio directo, comprobar su respuesta HTTP y reproducirlo en Stremio.

## FlixLatam

La ficha de series enlaza capítulos con `#sN-eM`. Cuando existe el contexto del router público y la fila confirma temporada y episodio, el adaptador pide el fragmento correspondiente. Antes de analizarlo, comprueba que la respuesta corresponde al mismo tipo, slug, temporada y episodio. No usa el reproductor general como sustituto ni sigue el fragmento a otro origen.

| Control | Resultado en vivo |
|---|---|
| Matrix (1999) | Ficha encontrada; Embed69 mostró un desafío. El visor Uqload inspeccionado por separado indicaba que el archivo había caducado o sido eliminado. |
| En Ruta de Escape (2026) | Ficha encontrada; ningún medio directo compatible en el control. |
| Breaking Bad T1E2 | Fragmento del episodio exacto devuelto por la API; el HTML publicó un iframe, no un medio directo compatible. |

## Cuevana 3

El HTML inicial sirve una aplicación dinámica sin los enlaces de búsqueda. El adaptador consulta la API pública del sitio y compara título, tipo y año. Para series, valida el capítulo en el listado de la temporada y contrasta el episodio y la serie en su detalle. Solo abre el visor Vimeos de las opciones de reproducción con etiqueta de audio en español; nunca usa las listas de descargas o tráilers. El manifiesto debe ser válido para devolver un stream.

| Control | Resultado en vivo |
|---|---|
| Matrix (1999) | Película y opción etiquetada Latino identificadas; el CDN del HLS devolvió HTTP 403. |
| El Efecto Mariposa (2004) | Película y opción etiquetada Latino identificadas; el CDN del HLS devolvió HTTP 403. |
| Breaking Bad T1E2 | Episodio exacto y opción etiquetada Latino identificados; el CDN del HLS devolvió HTTP 403. |

[Prueba en GitHub Actions](https://github.com/noe359866-code/SAS5/actions/runs/44235806384): **0 streams aceptados en los seis controles**. No se verificó la reproducción ni el audio en Stremio. El runner no es el Worker de producción y este workflow no despliega.

Las regresiones locales usaban respuestas simuladas. La sonda en vivo era informativa: un check verde significaba que pudo emitir un informe, no que hubiera vídeo disponible. Si había HLS de un CDN conocido, también solicitaba un rango de un segmento. No ejecutaba desafíos ni registraba URLs firmadas.
