# RamdonLatam

Addon gratuito para Stremio con catálogos de películas y series, metadatos en español latino y fuentes de reproducción directa con audio latino o castellano.

## Fuentes de reproducción

**Fanpelis, SpinFlix y GnulaHD (experimental) están habilitadas por defecto**. `/configure` permite desmarcarlas una por una. Solo se incluyen medios directos con audio latino o castellano identificado; una ficha, un iframe o una descarga no son un stream.

| Clave | Web consultada | Identificación y medios compatibles |
|---|---|---|
| `fanpelis` | `fanpelis.to` | API de títulos y episodios; si no se verifica el HLS de la primera publicación de un episodio, puede probar otra con la misma temporada y número. |
| `spinflix` | `lamoviebot.tvymas.workers.dev` | Busca variantes del título y confirma la ficha por ID o por título completo y año compatible. Si falta el episodio en una ficha candidata, comprueba la siguiente sin cambiar de capítulo. |
| `gnulahd` | `ww3.gnulahd.nu` | Experimental: verifica la ficha o el episodio exacto y solo admite HLS directo publicado en el HTML con etiqueta de audio explícita. [Estado y cómo probarlo](docs/gnulahd.md). |

Omite `STREAM_PROVIDERS` o usa `STREAM_PROVIDERS=all` para cargar el registro por defecto. Una lista como `fanpelis,spinflix` limita las fuentes; `STREAM_PROVIDERS=off` apaga todas y `FANPELIS=off` desactiva solo Fanpelis. Para pregenerar la web con `npm run build:web`, usa la misma configuración de fuentes que en el Worker. `STREAM_MAX_RESULTS` limita el número de resultados.

**Instalaciones existentes:** las claves se guardan por nombre. Se descartan las fuentes retiradas sin añadir otras a una selección que aún contenga claves vigentes. Si una lista antigua solo contiene fuentes retiradas, se aplica el valor por defecto, como antes: las fuentes que permite el despliegue para un enlace personal y el registro actual para `STREAM_PROVIDERS`. Una selección personal vacía (`streams: []`) y `STREAM_PROVIDERS=off` siguen apagando todas las fuentes.

Se retiraron FlixLatam, PlayLatinSRC, FuegoCine, AnimeOnlineNinja y Cuevana 3 porque no dieron una ruta de reproducción fiable en los controles. Se conservan los informes históricos de [FlixLatam y Cuevana 3](docs/flixlatam-cuevana.md), [FuegoCine](docs/fuegocine.md) y [PlayLatinSRC](docs/playlatinsrc-2026-11-17.md). Las variables `PLAYLATIN` y `PLAYLATIN_URL` ya no tienen efecto.

Habilitada no significa **disponible**: una fuente puede responder con error, no tener la obra, o entregar solo un reproductor HTML o enlaces no compatibles. Fanpelis y SpinFlix filtran los visores por idioma y origen antes de probarlos y mantienen un límite de tiempo y peticiones por búsqueda. Si la API o un visor rechaza el acceso, no se intenta resolver el desafío ni se ejecuta JavaScript externo. Los enlaces con vencimiento conocido se retiran con margen. Cuando dos resultados tienen la misma URL, prevalece el mejor comprobado; si solo hay enlaces sin verificar, se guardan por poco tiempo para volver a comprobarlos pronto.

**Sin proxy de reproducción:** `/stream` devuelve la URL original del CDN. El addon puede comprobar el manifiesto al buscar un enlace, pero no retransmite playlists, variantes, claves, audio ni segmentos. Al retirar `/hls`, la reproducción ya no genera invocaciones sucesivas del Worker para esos recursos. `/stream` sigue siendo una consulta dinámica. Si el CDN rechaza el acceso directo o no ofrece CORS para Stremio Web, el enlace puede no reproducirse; no se recurre a un proxy alternativo. Las variables antiguas `SPINFLIX_PROXY_URL` y `HLS_PROXY_HOSTS` ya no tienen efecto; `SPINFLIX_URL` sigue indicando la API de búsqueda.

## Configuración local

Requiere Node.js 18 o posterior.

```sh
npm install
cp .env.example .env
npm start
```

Configura `TMDB_API_KEY` o `TMDB_ACCESS_TOKEN` para catálogos y metadatos. `WATCH_REGION` define el país usado para disponibilidad de plataformas; por defecto es `NI`. El idioma editorial permanece fijo en `es-MX`.

Para desarrollo con Cloudflare Workers:

```sh
npm run dev:worker
npm run deploy
```

`npm run deploy` compila la web, pregenera catálogos configurados y despliega el Worker.

## Rutas

- `/manifest.json` y `/<config>/manifest.json`: manifests de Stremio.
- `/catalog/:type/:id.json`: catálogos.
- `/meta/:type/:id.json`: metadatos.
- `/stream/:type/:id.json`: resultados de reproducción directa con audio latino o castellano.
- `/configure`: selección de región, plataformas, estudios y fuentes directas.
- `/healthz`: estado del servicio y fuentes habilitadas; no comprueba que haya vídeo.

### Si Stremio no muestra streams

- Comprueba `/stream/movie/tt0816692.json` (Interestelar) para distinguir una respuesta vacía de un problema de reproducción. Si usas una URL personal, prueba la ruta con el mismo prefijo de configuración. Si desmarcaste todas las fuentes o las que elegiste siguen registradas pero el despliegue no las permite, abre `/configure` y actualiza la instalación con al menos una fuente habilitada.
- Para una serie, el ID de un episodio tiene el formato `id:temporada:episodio`, por ejemplo `/stream/series/tt0903747:1:1.json`. El ID de la serie sin episodio no es un ID reproducible.
- `/internal/streams-test.json?type=movie&id=tt0133093` muestra el diagnóstico de las fuentes de la configuración por defecto. `totalStreams` cuenta candidatos, no reproducciones: `verifiedManifests` y `mediaChecks` distinguen los manifiestos comprobados de los rechazos HTTP del CDN y los medios sin comprobar.
- Para distinguir un fallo del API de un 403 de reproducción, consulta la [sonda del Worker publicado](docs/worker-streams.md). El catálogo y el manifest pueden seguir funcionando aunque el CDN no entregue el vídeo.

## Desarrollo y pruebas

```sh
npm test
npm run build:web
npm run prerender
```

`npm test` usa respuestas simuladas. Para probar el código contra las webs reales, ejecuta **Tests** (`.github/workflows/providers.yml`) con *Run workflow* en GitHub Actions. También corre al hacer push a una rama `arena/` que modifique los adaptadores o sondas. No requiere claves de TMDB ni despliega el Worker.

```sh
node scripts/providers-live.js                    # controles generales
node scripts/gnulahd-live.js adapter               # solo GnulaHD experimental
node scripts/providers-live.js peliculas          # Matrix
node scripts/providers-live.js series             # Breaking Bad T1E1
node scripts/providers-live.js extra              # Mufasa: El rey león en Fanpelis
node scripts/worker-streams-live.js --playback     # API publicada, HLS y primeros segmentos desde el CDN
```

La sonda general de Fanpelis y SpinFlix separa los enlaces extraídos de los aceptados y, en los CDN conocidos, comprueba el manifiesto HLS y el acceso HTTP a un segmento desde el runner. La [sonda de enlaces directos](docs/worker-streams.md#cómo-probarlo) toma la URL que el Worker devuelve a Stremio y consulta solo el CDN para el medio, con una lectura acotada de los primeros segmentos. Los informes no guardan URLs firmadas ni comprueban reproducción completa en el cliente. RamdonLatam solo presenta metadatos y enlaces externos.
