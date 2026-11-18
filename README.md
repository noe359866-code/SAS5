# RamdonLatam

Addon gratuito para Stremio con catálogos de películas y series, metadatos en español latino y fuentes de reproducción directa con audio latino o castellano.

## Fuentes de reproducción

**Fanpelis, SpinFlix, GnulaHD, VideoApp y PelisPlus están habilitadas por defecto** (las tres últimas son experimentales). `/configure` permite desmarcarlas una por una. Solo se incluyen medios directos con audio latino o castellano identificado; una ficha, un iframe o una descarga no son un stream.

| Clave | Web consultada | Identificación y medios compatibles |
|---|---|---|
| `fanpelis` | `fanpelis.to` | API de títulos y episodios; publica el primer HLS de la primera publicación exacta del episodio. |
| `spinflix` | `lamoviebot.tvymas.workers.dev` | Busca variantes del título y confirma la ficha por ID o por título completo y año compatible. Si falta el episodio en una ficha candidata, comprueba la siguiente sin cambiar de capítulo. |
| `gnulahd` | `ww3.gnulahd.nu` | Experimental: verifica la ficha o el episodio exacto y solo admite HLS directo publicado en el HTML con etiqueta de audio explícita. [Estado y cómo probarlo](docs/gnulahd.md). |
| `videoapp` | `videoapp.zip` | Experimental: obtiene el iframe Vimeos por ID TMDB y busca HLS. Solo publica el resultado si el iframe identifica audio latino o castellano; la muestra de Interestelar no lo indica, por lo que se informa `audio-unverified` y no se anuncia como reproducible. |
| `pelisplus` | `pelisplushd.la` | Experimental, solo películas: busca la ficha y confirma título y año; intenta extraer HLS o MP4 de visores Streamwish/Filelions, VidHide y Dropload conocidos con audio identificado. Los enlaces se entregan tal cual, sin comprobar el CDN. [Detalles](docs/pelisplus.md). |

Omite `STREAM_PROVIDERS` o usa `STREAM_PROVIDERS=all` para cargar el registro por defecto. Una lista como `fanpelis,spinflix` limita las fuentes; `STREAM_PROVIDERS=off` apaga todas y `FANPELIS=off` desactiva solo Fanpelis. Para pregenerar la web con `npm run build:web`, usa la misma configuración de fuentes que en el Worker. `STREAM_MAX_RESULTS` limita el número de resultados.

**Instalaciones existentes:** las claves se guardan por nombre. Se descartan las fuentes retiradas sin añadir otras a una selección que aún contenga claves vigentes. La clave `pelisplus` vuelve a estar registrada; una configuración antigua que la incluya puede reactivarla. Si una lista antigua solo contiene fuentes retiradas, se aplica el valor por defecto, como antes: las fuentes que permite el despliegue para un enlace personal y el registro actual para `STREAM_PROVIDERS`. Una selección personal vacía (`streams: []`) y `STREAM_PROVIDERS=off` siguen apagando todas las fuentes.

Se retiraron FlixLatam, PlayLatinSRC, FuegoCine, AnimeOnlineNinja y Cuevana 3 porque no dieron una ruta de reproducción fiable en los controles. Se conservan los informes históricos de [FlixLatam y Cuevana 3](docs/flixlatam-cuevana.md), [FuegoCine](docs/fuegocine.md) y [PlayLatinSRC](docs/playlatinsrc-2026-11-17.md). Las variables `PLAYLATIN` y `PLAYLATIN_URL` ya no tienen efecto.

Habilitada no significa **disponible**: una fuente puede responder con error, no tener la obra, o entregar solo un reproductor HTML o enlaces no compatibles. Fanpelis y SpinFlix filtran los visores por idioma y origen antes de usarlos y mantienen un límite de tiempo y peticiones por búsqueda. Si la API o un visor rechaza el acceso, no se intenta resolver el desafío ni se ejecuta JavaScript externo. Los enlaces con vencimiento conocido se retiran con margen. Cuando dos fuentes entregan la misma URL, se publica una sola vez.

**Nombre del stream:** Stremio muestra el nombre de la obra («Interestelar», «Breaking Bad») en la fila de fuentes; la descripción queda para lo que se elige —capítulo, servidor y audio— y, debajo, los distintivos de calidad (`1080p · WEB-DL · LAT`). La calidad ya no es el nombre de la entrada.

**Sin comprobar el medio:** el addon ya no descarga manifiestos HLS ni MP4 ni sondea segmentos. Solo valida la forma de la URL (host conocido, extensión, sin credenciales y con firma viva) antes de publicarla, así que una búsqueda gasta menos peticiones y no toca el CDN del proveedor. La contrapartida es que un enlace caído se descubre al abrirlo, no al pedir la lista; los scripts de `scripts/` siguen pudiendo sondear el CDN desde el runner si hace falta revisar algo.

**Sin proxy de reproducción:** `/stream` devuelve la URL original del CDN. El addon puede comprobar el manifiesto al buscar un enlace, pero no retransmite playlists, variantes, claves, audio ni segmentos. Al retirar `/hls`, la reproducción ya no genera invocaciones sucesivas del Worker para esos recursos. `/stream` sigue siendo una consulta dinámica. Si el CDN rechaza el acceso directo o no ofrece CORS para Stremio Web, el enlace puede no reproducirse; no se recurre a un proxy alternativo. Las variables antiguas `SPINFLIX_PROXY_URL` y `HLS_PROXY_HOSTS` ya no tienen efecto; `SPINFLIX_URL` sigue indicando la API de búsqueda.

## Fichas y catálogos

Las fichas de `/meta` se construyen con TMDB (y OMDB si hay clave) y muestran lo que TMDB ya devuelve, sin peticiones extra por título:

- **Ficha técnica** en la descripción: idioma original y país de producción, más presupuesto y recaudación en películas. La duración va en el campo `runtime`, que Stremio ya pinta junto al año.
- **Autoría correcta**: en películas, dirección; en series, creadores (`created_by`). Antes una serie salía sin autoría porque TMDB no marca `job: Director` en sus créditos agregados.
- **Título original** cuando la ficha lo traduce, y **próximo episodio** en las series en emisión.
- **Fecha completa de estreno** en `released`, para que Stremio pueda ordenar por fecha.
- La sinopsis se recorta a 700 caracteres (por palabra y sin romper emojis) y pasa por el [saneado de publicidad](lib/sanitize.js).

En los catálogos:

- Las filas de **plataforma** acumulan la región del usuario y las de reserva (`WATCH_REGION`, `WATCH_REGION_FALLBACK`) para llenar la página: la cobertura JustWatch de países como Nicaragua es casi nula y una fila con dos títulos parece rota.
- Una página **vacía** se recuerda 5 minutos; antes cada visita repetía las consultas a TMDB sin cambiar el resultado.
- La **paginación** (`skip`) sigue contando posiciones de TMDB a partir de la segunda página.

`npm test` cubre estas piezas con respuestas simuladas; `lib/metaText.js` (idioma, país, duración, dinero) no toca red.

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
- `/internal/streams-test.json?type=movie&id=tt0133093` muestra el diagnóstico de las fuentes de la configuración por defecto. `totalStreams` cuenta candidatos, no reproducciones: el addon no sondea el medio (`mediaProbed: false`), así que un enlace publicado puede no reproducirse en el cliente.
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

La sonda general de Fanpelis y SpinFlix separa los enlaces extraídos de los aceptados y, en los CDN conocidos, comprueba desde el runner el manifiesto HLS y el acceso HTTP a un segmento (el addon en producción ya no hace esa comprobación). La [sonda de enlaces directos](docs/worker-streams.md#cómo-probarlo) toma la URL que el Worker devuelve a Stremio y consulta solo el CDN para el medio, con una lectura acotada de los primeros segmentos. Los informes no guardan URLs firmadas ni comprueban reproducción completa en el cliente. RamdonLatam solo presenta metadatos y enlaces externos.
