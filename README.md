# RamdonLatam

Addon gratuito para Stremio con catálogos de películas y series, metadatos en español latino y fuentes de reproducción directa con audio latino o castellano.

<p align="center">
  <img src="assets/brand/logo-1024.png" alt="RamdonLatam" width="120" height="120" />
</p>

## Marca y web

La marca es una baraja de tres fichas abanicadas con un botón de reproducción en la de delante: los títulos se barajan, se eligen y se ven. Azul noche (`#0a1e30`) de fondo y el naranja de siempre (`#f5821f`) en las fichas y en el acento de la interfaz.

- **Maestro vectorial:** `assets/brand/logo.svg` es el único archivo que se edita a mano.
- **Derivados:** `node scripts/brand-assets.mjs` genera `assets/logo.png` (512²), `assets/brand/logo-1024.png`, `assets/icon-192.png`, `assets/icon-512.png`, `assets/favicon.svg`, `assets/og-cover.png` (1200×630), las copias de `public/assets/` y el base64 de `lib/logoData.js` (el logo que el Worker sirve desde memoria).
- **Web:** la portada y `/configure` comparten el sistema de diseño de `lib/theme.js` (piel «RamdonLatam»: azul noche, foco y acción principal en naranja de marca, cristal azulado y baraja CSS en el hero) y funcionan sin fuentes, CSS ni scripts de terceros. Los iconos y el `site.webmanifest` los sirve el edge desde `public/`.

## Fuentes de reproducción

**Catorce fuentes están habilitadas por defecto**: Fanpelis, SpinFlix, Cuevana 3, Allpelículas, LaMovie, HackStore, AllCalidad, AnimeFLV, AnimeAV1, OtakusTV, SeriesBL, FuegoCine, PelisJuanita y VideoAPI. `/configure` permite desmarcarlas una por una. Solo se incluyen medios directos con audio latino, castellano o subtitulado identificado; una ficha, un iframe o una descarga no son un stream.

| Clave | Web consultada | Identificación y medios compatibles |
|---|---|---|
| `fanpelis` | `fanpelis.to` | API de títulos y episodios; publica el primer HLS de la primera publicación exacta del episodio. |
| `spinflix` | `lamoviebot.tvymas.workers.dev` | Busca variantes del título y confirma la ficha por ID o por título completo y año compatible. Si falta el episodio en una ficha candidata, comprueba la siguiente sin cambiar de capítulo. |
| `cuevanas3` | `cuevanas3.pro` | SPA React sobre una API JSON propia (`/wp-api/v1/search`, `/player`): la ficha ya trae idioma y calidad por visor. Resuelve Vimeos y los visores extraíbles. |
| `allpeliculas` | `allpeliculas.la` | Mismo CMS que Cuevana 3 (`/wp-api/v1/search`, `/single/episodes/list`, `/player`): la API declara el idioma («Latino») y la calidad, y el visor es Vimeos. [Detalles](docs/allpeliculas-lamovie.md). |
| `lamovie` | `lamovie.org` | Mismo CMS y mismo visor que Allpelículas, con otro catálogo; el espejo `lamovie.cc` no responde y no se registra. [Detalles](docs/allpeliculas-lamovie.md). |
| `hackstore` | `hackstore.mx` | Otra instancia del CMS `/wp-api/v1`: la API declara idioma, calidad y temporada/episodio del embed y entrega Vimeos, que el addon resuelve sin abrir el manifiesto. El dominio antiguo (`hackstore2.com`) no responde. |
| `allcalidad` | `allcalidad.re` | Variante `/api/rest` de la misma familia: buscador por tipo de obra, episodios en un array y reproductor con `post_id`; el visor vuelve a ser Vimeos. [Detalles](docs/proveedores-2026-11-24.md). |
| `animeflv` | `animeflv.or.at` | Anime subtitulado al español: episodios desde el JSON de la ficha y embeds en base64. Publica HLS del player propio y Byse con la etiqueta «Subtitulado». El sitio cataloga sobre todo lo que está en emisión y nombra cada temporada como una obra aparte (`… Season 2`), así que fuera de su catálogo el resultado es `no-match`. |
| `animeav1` | `animeav1.com` | Anime **con doblaje latino y subtitulado**: el buscador `/catalogo?search=` filtra de verdad, la ficha abre una página por temporada y el episodio declara el audio por grupo (`embeds: {SUB, DUB}`). El visor propio (`player.zilla-networks.com`) publica un HLS por idioma en `/m3u8/<token>`. [Detalles](docs/animeav1.md). |
| `otakustv` | `otakustv2.com` | Anime subtitulado: la ficha publica año, audio y episodios con numeración absoluta; el episodio expone sus visores en `data-dwn` y Byse entrega un HLS directo. Solo se acepta la temporada 1 salvo declaración explícita. [Detalles](docs/otakustv.md). |
| `seriesbl` | `seriesbl.net` | Series BL subtituladas: ficha con año y episodios `SxE`, visores DooPlay por `admin-ajax.php` y un relé que publica el Byse con HLS directo. [Detalles](docs/doramas-2026-11-24.md). |
| `fuegocine` | `fuegocine.com` | Busca en `/search_elastic?s=`, confirma título y tipo, abre `/movies/watch/…` (o temporada y episodio en series) y solo lee el visor de UnLimPlay, que declara el audio por grupo (`latino`, `castellano`, `subtitulado`) y publica un HLS firmado por idioma. Videro, abyssplayer y embedorigin se cuentan como opacos sin abrirlos. [Detalles](docs/fuegocine.md). |
| `pelisjuanita` | `pelisjuanita.org` | SPA con API propia: busca en `/api/rest/v1/search`, confirma tipo y año, y en series pide temporada y episodio a la API antes de abrir `videoapp.mov`. El visor de Vimeos declara la versión (`sub`/`lat`) y entrega un HLS firmado con sus subtítulos. [Detalles](docs/pelisjuanita.md). |
| `videoapi` | `videoapi.la` | Embeds directos por ID de TMDB (`/e/movie/<id>` y `/e/tv/<id>/<S>/<E>`) con el mismo visor Vimeos y subtítulos opcionales. |

Omite `STREAM_PROVIDERS` o usa `STREAM_PROVIDERS=all` para cargar el registro por defecto. Una lista como `fanpelis,spinflix` limita las fuentes; `STREAM_PROVIDERS=off` apaga todas y `FANPELIS=off` desactiva solo Fanpelis. Para pregenerar la web con `npm run build:web`, usa la misma configuración de fuentes que en el Worker. `STREAM_MAX_RESULTS` limita el número de resultados.

**Instalaciones existentes:** las claves se guardan por nombre. Se descartan las fuentes retiradas sin añadir otras a una selección que aún contenga claves vigentes. Las claves `gnulahd`, `videoapp`, `pelisplus`, `gnulaone`, `ultra`, `tubeonline` y `mirandogratis` se retiraron el 19-11-2026: una configuración antigua que las incluya las descarta sin tocar las vigentes. Si una lista antigua solo contiene fuentes retiradas, se aplica el valor por defecto, como antes: las fuentes que permite el despliegue para un enlace personal y el registro actual para `STREAM_PROVIDERS`. Una selección personal vacía (`streams: []`) y `STREAM_PROVIDERS=off` siguen apagando todas las fuentes.

El 24-11-2026 se sumaron HackStore (`hackstore.mx`) y AllCalidad (`allcalidad.re`) tras medir su cadena completa con el propio código del addon: dos instancias más del CMS JSON con visor Vimeos, con catálogos distintos. El informe de candidatas, incluidas las descartadas, está en [proveedores-2026-11-24.md](docs/proveedores-2026-11-24.md).

Se retiraron FlixLatam, PlayLatinSRC, AnimeOnlineNinja y Cuevana 3 porque no dieron una ruta de reproducción fiable en los controles. El 19-11-2026 se retiraron también GnulaHD, VideoApp, PelisPlus, GnulaOne, Ultra, TubeOnLine y MirandoGratis: en las validaciones en vivo no publicaban un medio utilizable de forma consistente (ver [fuentes retiradas](docs/fuentes-retiradas.md)). FuegoCine volvió el 19-11-2026 con otro camino: el fallo de entonces era el sitemap, y la ruta que sí publica el medio es la página `/movies/watch/…` con el visor de UnLimPlay. Se conservan los informes históricos de [FlixLatam y Cuevana 3](docs/flixlatam-cuevana.md), [FuegoCine](docs/fuegocine.md) y [PlayLatinSRC](docs/playlatinsrc-2026-11-17.md). Las variables `PLAYLATIN` y `PLAYLATIN_URL` ya no tienen efecto.

Habilitada no significa **disponible**: una fuente puede responder con error, no tener la obra, o entregar solo un reproductor HTML o enlaces no compatibles. Fanpelis y SpinFlix filtran los visores por idioma y origen antes de usarlos y mantienen un límite de tiempo y peticiones por búsqueda. Si la API o un visor rechaza el acceso, no se intenta resolver el desafío ni se ejecuta JavaScript externo. Los enlaces con vencimiento conocido se retiran con margen. Cuando dos fuentes entregan la misma URL, se publica una sola vez.

**Nombre del stream:** Stremio muestra el nombre de la obra («Interestelar», «Breaking Bad») en la fila de fuentes; la descripción queda para lo que se elige —capítulo, servidor y audio— y, debajo, los distintivos de calidad (`1080p · WEB-DL · LAT`). La calidad ya no es el nombre de la entrada.

**Sin comprobar el medio:** el addon ya no descarga manifiestos HLS ni MP4 ni sondea segmentos. Solo valida la forma de la URL (host conocido, extensión, sin credenciales y con firma viva) antes de publicarla, así que una búsqueda gasta menos peticiones y no toca el CDN del proveedor. La contrapartida es que un enlace caído se descubre al abrirlo, no al pedir la lista; los scripts de `scripts/` siguen pudiendo sondear el CDN desde el runner si hace falta revisar algo.

**Proxy de reproducción:** todos los streams HLS y MP4 solicitan el proxy del servicio de streaming de Stremio mediante `behaviorHints.proxyHeaders`. Cuando se conoce el visor, se envían su `Origin` y `Referer`; sin origen conocido se solicita el proxy sin cabeceras adicionales. Requiere un cliente y servidor de streaming compatibles y no garantiza evitar 403. El addon no retransmite vídeo ni expone un proxy público.

**Republicación:** tras desplegar, comprueba que `/manifest.json` devuelve `net.ramdonlatam.catalogos` como `id` y envía esa URL HTTPS a stremioaddons.net. Para mantener también el addon anterior, usa una URL de despliegue distinta.

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
- `/configure`: selección de región, plataformas y fuentes directas.
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
node scripts/brand-assets.mjs   # solo si cambia assets/brand/logo.svg
```

`npm test` usa respuestas simuladas. Para probar el código contra las webs reales, ejecuta **Tests** (`.github/workflows/providers.yml`) con *Run workflow* en GitHub Actions. También corre al hacer push a una rama `arena/` que modifique los adaptadores o sondas. No requiere claves de TMDB ni despliega el Worker.

```sh
node scripts/providers-live.js                    # controles generales
node scripts/providers-live.js peliculas          # Matrix
node scripts/providers-live.js series             # Breaking Bad T1E1
node scripts/providers-live.js extra              # Mufasa: El rey león en Fanpelis
node scripts/worker-streams-live.js --playback     # API publicada, HLS y primeros segmentos desde el CDN
```

La sonda general de Fanpelis y SpinFlix separa los enlaces extraídos de los aceptados y, en los CDN conocidos, comprueba desde el runner el manifiesto HLS y el acceso HTTP a un segmento (el addon en producción ya no hace esa comprobación). La [sonda de enlaces directos](docs/worker-streams.md#cómo-probarlo) toma la URL que el Worker devuelve a Stremio y consulta solo el CDN para el medio, con una lectura acotada de los primeros segmentos. Los informes no guardan URLs firmadas ni comprueban reproducción completa en el cliente. RamdonLatam solo presenta metadatos y enlaces externos.


### Catálogos y carga progresiva en Stremio

El manifest declara 79 filas: 78 catálogos TMDB con `skip` y la programación
«En TV hoy» de TVMaze (lista diaria, sin páginas). Se retiraron las filas por
estudio para mantener el manifest por debajo de los 8 KB del SDK. Películas,
series, anime, plataformas, géneros, miniseries, cines y próximos estrenos
solicitan páginas de hasta 20 títulos conforme el cliente pide más resultados.
El máximo accesible por colección es 500 páginas / 10.000 posiciones (límite
TMDB), no una garantía de que todas tengan esa cantidad de títulos.

Las plataformas seleccionan una única región: la primera de la cadena configurada
que tenga una página completa, o la de mayor cobertura si ninguna llega a 20.
Esa selección se guarda en caché y se usa también en páginas posteriores; no se
concatenan listas de países que causarían repeticiones y saltos. La lista de una
región de respaldo no garantiza disponibilidad en el país del usuario.

Los enlaces de configuración antiguos siguen decodificándose, pero su selección
de estudios ya no crea filas. Después de desplegar, actualiza o reinstala el addon
en Stremio con la misma configuración para renovar el manifest. Regenera los
estáticos (`npm run deploy` con PUBLIC_ORIGIN configurado) para no servir manifests
o páginas pregeneradas del comportamiento anterior.
