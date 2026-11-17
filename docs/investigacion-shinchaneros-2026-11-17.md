# Investigación ShinChaneros (17-11-2026)

No se ha activado como proveedor: el catálogo y los MP4 probados devuelven un challenge de Cloudflare desde GitHub Actions, y no se ha comprobado la respuesta desde el Worker desplegado.

- El sitio anuncia episodios de Shin Chan en castellano y películas tanto en castellano como en japonés. Su temporada 2 comienza en el episodio 34: la numeración mostrada es absoluta, no necesariamente la que solicita Stremio. Hay que verificar la correspondencia con los metadatos, no sumar offsets a ciegas.
- La aplicación pública [Shin-Chan-TV](https://github.com/jesusjodar/Shin-Chan-TV), independiente de este addon, documenta un extractor de MP4 desde los payloads Next.js y contiene una fixture para T1E1. Es una pista sobre estructura, no una garantía de que los enlaces sigan funcionando o de que todos los títulos sean castellanos.
- En el runner de Actions (ejecución 44189848258), cuatro páginas de episodios y películas respondieron HTTP 403 con `cf-mitigated: challenge`. Dos MP4 de prueba también devolvieron HTTP 403, challenge y contenido HTML, no MP4. Estos resultados no prueban cómo responde el sitio al Worker o a un usuario final.
- `scripts/shinchaneros-probe.mjs` reproduce las comprobaciones y limita la lectura de cada respuesta de vídeo a su primer bloque. No almacena cookies ni intenta superar el challenge.

Una integración necesitaría acceso autorizado al catálogo y a los medios desde el entorno real (por ejemplo, acceso o API acordados con el operador), mapeo de episodios verificado contra metadatos y comprobación de reproducción. Evitar registrar como vídeo una página de challenge o adivinar rutas MP4.
