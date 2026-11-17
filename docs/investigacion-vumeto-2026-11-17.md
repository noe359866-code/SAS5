# Vumeto: proveedor experimental (17-11-2026)

Vumeto se añadió como proveedor directo para películas y series usando IDs TMDB y, para series, temporada y episodio. Consulta el reproductor público de `vumeto.xyz`, obtiene la sesión efímera que ese reproductor entrega en su HTML y solicita al backend la fuente MovieBox. La sesión no se registra en logs ni se comparte con el cliente. Hasta cuatro solicitudes por búsqueda, con comprobación parcial de las fuentes en paralelo; `VUMETO=off` lo desactiva.

La integración comprueba el ID y el episodio devueltos por el servicio, acepta solo MP4 con audio identificado explícitamente como inglés, restringe la URL al CDN observado y comprueba con lectura acotada el encabezado MP4. No entrega el HTML del reproductor. La etiqueta es orientativa: una fuente multilingüe puede contener otros audios, sin garantizar selección de pista en el cliente. Las URLs y la disponibilidad pueden cambiar.

## Prueba real

En GitHub Actions (ejecución 44199659119), la película The Matrix arrojó dos fuentes y Breaking Bad S01E01 una; los MP4 examinados respondieron HTTP 206 y empezaban con un encabezado `ftyp`. Duraciones de resolución de la sonda: 480 y 331 ms respectivamente. Esto prueba solo los primeros bytes desde GitHub, no el contenido completo, la ausencia de anuncios, la reproducción en Stremio ni el comportamiento desde el Worker desplegado. No confundir el resultado TMDB del catálogo con confirmación del archivo de vídeo.

El sitio también tiene una opción FebBox que requiere una cuenta personal y una extensión de navegador; **no se ha integrado**, ni se necesitan credenciales de usuario. Tampoco se han integrado otros servidores o anime mediante su reproductor web. `scripts/vumeto-probe.mjs` registra métricas sin URLs de medios completas.
