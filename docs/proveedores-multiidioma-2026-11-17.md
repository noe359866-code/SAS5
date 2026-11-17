# Evaluación multiidioma para Worker — 17 noviembre 2026

Fuente: [directorio Streamflix](https://git.gay/streamflix-reborn2/streamflix/src/branch/main/app/src/main/java/com/streamflixreborn/streamflix/providers), y su extractor VixSrc. Criterios: pocas subpeticiones, sin WebView, captcha ni prueba de trabajo.

## Implementado: VixSrc (extractor usado por StreamingCommunity)

Se pide por ID TMDB película o episodio. Dos GET: API y embed; no se ejecuta JavaScript remoto. Se extrae la URL HLS y se envía Referer al reproductor. El Worker no retransmite los segmentos. Ante 410 se reintenta una sola vez (máximo cuatro GET). `VIXSRC=off` desactiva el buscador. Es necesario que el título resuelto tenga TMDB ID. Los tokens tienen caducidad; la caché del pool se limita a esa caducidad, sin stale. La disponibilidad y audio dependen de cada título y cliente.

Comprobaciones externas con fetch de páginas: API de Matrix y Breaking Bad devolvió `src`; el reproductor de Matrix mostró pistas italiana e inglesa. La sonda `npm run vixsrc:check` probó API, extracción y master HLS para ambas obras desde GitHub Actions: [run 44163855449](https://github.com/noe359866-code/SAS5/actions/runs/44163855449), paso VixSrc exitoso. Esto **no demuestra reproducción en Stremio ni acceso desde el Worker desplegado**. Las pruebas unitarias usan HTML sintético basado en el extractor upstream.

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

### Corrección tras revisar el código upstream

FrenchStream busca con `POST /engine/ajax/search.php` (formulario `query` y `page`), no con el POST DLE genérico especulado anteriormente. Su cliente envía `fsschal=1`; después hay que seleccionar una coincidencia inequívoca y resolver los hosts de vídeo. Los episodios usan `GET /engine/ajax/sx.php?id=…`. Estas rutas están confirmadas en código upstream, pero no se ha validado el flujo POST y la reproducción real desde el Worker, por lo que FrenchStream aún no está integrado. Filmo se declara alemán (`language = "de"`) en la versión consultada de upstream y su búsqueda suggest es GET, no italiano ni POST.

### Nuevas sondas reales (GitHub Actions)

- [Run 44172532707](https://github.com/noe359866-code/SAS5/actions/runs/44172532707): el POST de búsqueda de FrenchStream respondió 200 con Matrix (1999), Matrix Resurrections y otras coincidencias. Otro [run](https://github.com/noe359866-code/SAS5/actions/runs/44172796761) agotó 12 segundos: la disponibilidad no es consistente. Falta conectar la búsqueda al ID de ficha y validar extracción y reproducción.
- MStream/Moflix: el buscador web mostró Matrix; `api/v1/watch/1625240` respondió 401 al lector de páginas y **403 desde GitHub Actions incluso con Referer**. No extrapolar esto a todos los entornos, pero no hay vía ligera validada.
- JKAnime: la página de One Piece 1 mostró varios hosts en el lector de páginas, pero respondió **403 desde GitHub Actions**. Sin acceso directo al HTML no se puede verificar un extractor apto para Worker.
- En FrenchStream, el JSON de una película incluyó Vidzy y otros embeds. El lector de Vidzy informó error al solicitar HLS; otro embed devolvió 404. Un redirect de Kokoflix abrió un reproductor, pero esto no demuestra un stream directo reproducible.

El diagnóstico reproducible está en `scripts/multiidioma-probe.mjs`; el paso de CI es informativo, no confirma reproducción. Ninguno de estos tres se ha añadido como proveedor.

### DeVideoSRC experimental

Se añadió `devideosrc` para probar el flujo por IMDb: GET del shell y POST al resolver, sin PoW ni WebView. Solo devuelve fuentes que el servicio declare `hls` o `mp4`; se descartan los embeds HTML. Por tanto puede no devolver ningún resultado aunque el servicio tenga servidores. No se ha comprobado su reproducción real en Worker: el contrato de resolve se infiere por similitud con PlayLatinSRC y la API indica que necesita token. La sonda de CI informa si devuelve fuentes directas, no prueba que reproduzcan. `DEVIDEOSRC=off` lo desactiva; seleccionar en `/configure` y probar en el despliegue real.

Un tercer intento de búsqueda de FrenchStream devolvió HTTP 200 con página de verificación, no resultados. No se resuelve el desafío.
