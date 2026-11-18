# RamdonLatam

Addon gratuito para Stremio con catálogos de películas y series, metadatos en español latino y fuentes de reproducción directa con audio latino o castellano.

## Fuentes de reproducción

**Las ocho fuentes registradas se consultan por defecto**, incluida GnulaHD en modo experimental. `/configure` permite desmarcarlas una por una; las instalaciones que ya guardaron una selección explícita la conservan. Solo se incluyen medios directos con audio latino o castellano identificado; una ficha o un iframe no son un stream.

| Clave | Web consultada | Identificación y reproductores compatibles |
|---|---|---|
| `fanpelis` | `fanpelis.to` | API de títulos y episodios; HLS de Vimeos. |
| `flixlatam` | `flixlatam.com` | Búsqueda por tipo/año y enlace, panel o fragmento público del episodio exacto; medios directos, Vimeos y Uqload compatibles. |
| `playlatin` | `playlatinsrc.co` | IMDb y episodio exacto; medios directos del resolver o HLS público de Dropload con manifiesto válido. |
| `spinflix` | `lamoviebot.tvymas.workers.dev` | API de SpinFlix/LaMovie, detalle por ID o título y año, HLS de Vimeos. |
| `fuegocine` | `fuegocine.com` | Sitemap, portada y listado; ficha y visor de película o ruta del episodio exacto. No devuelve iframes sin medio compatible. |
| `animeonlineninja` | `ww4.animeonline.ninja` | Fichas de anime y enlace con numeración explícita. |
| `cuevana3` | `cuevanas3.pro` | API pública de títulos y episodios; solo devuelve HLS de Vimeos si el manifiesto es válido. |
| `gnulahd` | `ww3.gnulahd.nu` | Experimental: verifica la ficha o el episodio exacto y solo admite HLS directo publicado en el HTML con etiqueta de audio explícita. [Estado y cómo probarlo](docs/gnulahd.md). |

Quita `STREAM_PROVIDERS` de tu despliegue, o fija `STREAM_PROVIDERS=all`, para usar las ocho. Una lista como `fanpelis,spinflix` limita las fuentes; `off` apaga todas. `FANPELIS=off` y `PLAYLATIN=off` siguen admitidos. Para una web pregenerada con `npm run build:web`, usa las mismas variables que en el Worker. `STREAM_MAX_RESULTS` limita el número de resultados.

Habilitada no significa **disponible**: una fuente puede responder con error, no tener la obra, o entregar solo un reproductor HTML o enlaces no compatibles. No se resuelven challenges ni se ejecuta JavaScript de terceros. Los HLS de Vimeos se comprueban con un plazo breve; si el CDN no permite comprobarlos desde el servidor, no se anuncia una resolución no verificada. Los enlaces con vencimiento conocido se retiran con margen y la caché HTTP de streams no sirve respuestas caducadas.

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
- `/stream/:type/:id.json`: resultados de reproducción directa en español latino.
- `/configure`: selección de región, plataformas, estudios y fuentes directas.
- `/healthz`: estado de servicio y proveedores.

### Si Stremio no muestra streams

- Comprueba `/stream/movie/tt0816692.json` (Interestelar) para distinguir una respuesta vacía de un problema de reproducción. Si usas una URL personal, prueba la ruta con el mismo prefijo de configuración. Una selección vacía o con fuentes ya deshabilitadas no se sustituye automáticamente; abre `/configure` y vuelve a instalar con al menos una fuente activa.
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
node scripts/providers-live.js series             # Breaking Bad y Naruto
node scripts/providers-live.js extra              # Mufasa, El rey león y FuegoCine
```

El informe general separa los enlaces extraídos de los aceptados y, en los CDN conocidos, comprueba el manifiesto HLS y el acceso HTTP a un segmento.

Para probar **FlixLatam y Cuevana 3 por separado**, usa el workflow `flixlatam-cuevana.yml`. Los resultados y los límites conocidos están en [la nota de verificación](docs/flixlatam-cuevana.md).

Para comprobar **solo PlayLatinSRC y FuegoCine**, usa el workflow `playlatin-fuegocine.yml` o ejecuta `node scripts/provider-pair-live.js`. Este workflow ejecuta regresiones y una sonda informativa por proveedor; un check verde no significa que las webs tengan contenido reproducible en todos los controles. En PlayLatinSRC se prueba el HLS y una solicitud Range a un segmento del CDN conocido. En FuegoCine se distingue una ficha localizada mediante el sitemap de un visor con medio directo.

Los informes no guardan URLs firmadas ni comprueban el audio o la reproducción en Stremio. El runner de GitHub puede recibir otra respuesta que un Worker desplegado o un reproductor doméstico. RamdonLatam no aloja archivos de video; solo presenta metadatos y enlaces externos.
