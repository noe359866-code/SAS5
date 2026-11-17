# Evaluación multiidioma para Worker — 17 noviembre 2026

Fuente: [directorio Streamflix](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers), y su extractor VixSrc. Criterios: pocas subpeticiones, sin WebView, captcha ni prueba de trabajo.

## Implementado: VixSrc (extractor usado por StreamingCommunity)

Se pide por ID TMDB película o episodio. Dos GET: API y embed; no se ejecuta JavaScript remoto. Se extrae la URL HLS y se envía Referer al reproductor. El Worker no retransmite los segmentos. Ante 410 se reintenta una sola vez (máximo cuatro GET). `VIXSRC=off` desactiva el buscador. Es necesario que el título resuelto tenga TMDB ID. Los tokens tienen caducidad; la caché del pool se limita a esa caducidad, sin stale. La disponibilidad y audio dependen de cada título y cliente.

Comprobaciones externas con fetch de páginas: API de Matrix y Breaking Bad devolvió `src`; el reproductor de Matrix mostró pistas italiana e inglesa. Esto **no demuestra reproducción en Stremio ni que el Worker pueda acceder a la playlist**. La sonda `npm run vixsrc:check` prueba API, extracción y master HLS desde el runner de GitHub; las pruebas unitarias usan HTML sintético basado en el extractor upstream.

## Evaluación y límites

| Idioma | Resultado |
|---|---|
| Español | Fanpelis, VideoAPI y PlayLatin ya integrados. PoseidonHD2 expone ficha por TMDB, pero búsqueda y reproducción directa aún no verificadas. |
| Italiano/inglés | VixSrc integrado experimentalmente; no se promete un idioma en todos los títulos. |
| Francés | FrenchStream devuelve JSON de players por ID; búsqueda POST y extracción final de hosts pendientes de validar. |
| Polaco | Zaluknij devuelve búsqueda y ficha por HTML; Streamflix usa WebView para clearance. No se ha demostrado acceso sin ese requisito en Worker ni extracción final. |
| Alemán | KinoGer busca por GET pero el player está fuera del HTML. DeVideoSRC requiere resolución con token; no se ha verificado el contrato completo. |
| Portugués | Índice BR ya integrado para torrents. No se ha validado un proveedor directo adicional. |
| Anime | Nyaa ya integrado; JKAnime requiere verificar episodios, CSRF y resolución. |
| Ruso/turco y otros | Sin candidato directo suficientemente probado para Worker; Vavoo usa resolución pesada. |

No se integran enlaces de iframe como si fueran vídeo directo ni se atribuye audio sin evidencia. La cobertura de todos los idiomas solicitados **sigue incompleta**. La prueba externa se hizo con el lector de páginas; las conexiones directas desde este sandbox a estos dominios no funcionan. No se han probado los streams finales de los candidatos descartados.
