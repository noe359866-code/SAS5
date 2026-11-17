# AnimeAV1: integración experimental (17-11-2026)

Se agregó AnimeAV1 como proveedor directo experimental, limitado a series de primera temporada con título exacto y episodio presente en su ficha. Esa correspondencia de primera temporada es una hipótesis conservadora, no una garantía de que los catálogos usen siempre la misma numeración; otras temporadas y películas quedan fuera. AnimeAV1 puede agrupar capítulos con numeración absoluta y crear fichas separadas para secuelas.

El adaptador solo inspecciona la lista `embeds.SUB`, extrae un MP4 de MP4Upload y verifica los primeros bytes con una solicitud acotada antes de mostrarlo. No devuelve páginas embed ni links de descarga. El audio queda como desconocido: subtítulos en español no prueban audio en español. Se limita a cinco solicitudes y `ANIMEAV1=off` lo desactiva.

## Pruebas reales

- En GitHub Actions la búsqueda, la ficha y la página del episodio de Sora wa Akai Kawa no Hotori respondieron HTTP 200; el player rotulado HLS era una página HTML, no una playlist directamente reproducible.
- El embed MP4Upload expuso una URL MP4 y una prueba parcial devolvió HTTP 206 (ejecución 44191938421), sin validación completa del contenido o reproducción.
- En ejecuciones posteriores la conexión al host del MP4 agotó el plazo (`UND_ERR_CONNECT_TIMEOUT`) con tres perfiles de cabeceras. En la ejecución 44192779626 el adaptador devolvió cero resultados al no poder validar el MP4. El resultado desde el Worker desplegado o el cliente puede ser distinto.

No hay validación de reproducción completa en Stremio ni garantía de contenido o disponibilidad. La sonda `scripts/animeav1-probe.mjs` registra métricas sin enlaces de vídeo completos. El contrato de catálogo y reproductores también se contrastó con el proyecto independiente [kino_animeav1](https://github.com/ccuadrosn-ai/kino_animeav1).
