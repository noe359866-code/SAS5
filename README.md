# 🎬 Catálogos+ — Addon de Stremio

Addon gratuito para Stremio con catálogos de **películas y series**. Los servicios debrid son opcionales y usan la cuenta propia del usuario (TorBox, EasyDebrid, Premiumize o Real-Debrid):

- 🔥 **Tendencias** de la semana (TMDB)
- ⭐ **Top Valoradas** (TMDB, mínimo de votos configurable)
- 🍿 **Populares** (TMDB)
- 🎬 **Web** con sistema de diseño propio (`lib/theme.js`): tema oscuro con acento degradado violeta→cian, iconos SVG en línea (`lib/icons.js`, sin emojis ni fuentes de iconos), tipografía del sistema y **0 peticiones externas** salvo las imágenes de TMDB. La portada tiene un muro de pósters, cifras reales del addon, tendencias con buscador, funciones, instalación en 3 pasos, preguntas frecuentes y botón de copiar la URL. Respeta `prefers-reduced-motion`
- 🎛️ **Página de configuración `/configure`**: índice lateral con el resumen de cada sección, **idioma (18) y región (44) con buscador**, rejilla de plataformas y estudios con logos (CDN público de TMDB, visibles incluso sin clave), catálogos base, proveedores de streams, **filtros de streams** y una barra inferior fija con el contador de catálogos, la URL y el botón de instalar → genera tu **manifest personal** `/<config>/manifest.json`
- 🧲 **Filtros de streams por usuario**: cada persona decide qué copias no quiere ver —**CAM/TS, screeners, 3D, 4K**, REMUX, Dolby Vision, HEVC, AV1…—, el orden (seeders, calidad o tamaño) y un tamaño máximo. Ver [Filtros de streams](#-filtros-de-streams)
- ⚡ **Servicios debrid opcionales**: TorBox, EasyDebrid, Premiumize y Real-Debrid añaden enlaces directos según la disponibilidad del proveedor; las credenciales se cifran en el servidor y los magnets públicos siguen como alternativa. Real-Debrid usa OAuth y solo la biblioteca personal completada; no consulta disponibilidad global ni añade torrents.
- 🚀 **Respuestas más rápidas**: proveedores en paralelo con timeout configurable, búsquedas repetidas coalescidas, caché stale-while-revalidate y caché compartida de Cloudflare para catálogos y fichas.
- 💬 **Soporte**: enlace al Discord en la barra, en una tarjeta y en el pie de las dos páginas (`SUPPORT_URL`)
- 📺 **Por plataforma (30)**: Netflix, Prime Video, Disney+, Max (HBO), Apple TV+, Paramount+, Crunchyroll, Hulu, AMC+, MUBI, Tubi, Pluto TV, Peacock, Starz, MGM+, YouTube Premium, **Plex, Amazon Freevee, The Roku Channel, discovery+, ViX, Claro video, DIRECTV GO, Movistar TV, Filmin Latino, Globoplay, Filmin, Atresplayer, SkyShowtime y Movistar Plus+** — películas y series (TMDB Discover con JustWatch providers, con **fallback automático MX→US** si tu región no tiene resultados)
- 🎥 **Por estudio (21)** · películas **y series**: Marvel Studios, Pixar, Walt Disney Pictures, Disney Animation, Lucasfilm, Warner Bros., New Line Cinema, Universal, Illumination, DreamWorks Animation, Paramount Pictures, Sony Pictures, 20th Century Studios, MGM, Lionsgate, A24, Blumhouse, Studio Ghibli, Toei Animation, MAPPA y Kyoto Animation (TMDB Discover con `with_companies`, en `/discover/movie` y `/discover/tv`)
- 📡 **Series · En TV hoy** (TVMaze, **gratis y sin clave**)

Metadatos enriquecidos en la ficha:

- 🎞️ Ficha principal, póster, fondo, géneros, reparto y dirección → **TMDB**
- 📡 Argumento, géneros y canales → **TVMaze** (funciona siempre, sin clave)
- 🗂️ Fichas de series/películas por IMDb id (respaldo multi-fuente, con español) → **TheTVDB v4**
- ⭐ Valoraciones **IMDb · Rotten Tomatoes · Metacritic** → **OMDB**
- 📺 **Dónde ver en streaming** ("Disponible en NI: Netflix · Prime Video") → **Watchmode**
- 📡 Argumento, géneros y canales → **TVMaze** (funciona siempre)

## 📁 Estructura

```text
├── worker.mjs            # Cloudflare Worker (entrypoint principal)
├── wrangler.toml         # Config del Worker (vars no secretas)
├── addon.js              # Manifest + handlers SDK (Node/Vercel)
├── api/index.js          # Express: servidor local / Vercel
├── server.js             # Arranque local Node (npm start)
├── lib/
│   ├── config.js         # Config compartida Node/Workers (reload por request)
│   ├── core.js           # Núcleo agnóstico: manifest + handlers
│   ├── cache.js          # Caché LRU, TTL, stale-while-revalidate y coalescencia
│   ├── debridCredentials.js # Credenciales multi-proveedor cifradas y referencias opacas
│   ├── debridProviders.js # Registro y validación de adaptadores debrid
│   ├── debridStreams.js  # Dispatcher de enlaces directos (degrada a magnets)
│   ├── realDebridOAuth.js # OAuth server-side y renovación de tokens
│   ├── realDebrid.js     # Resolución solo de torrents descargados en biblioteca personal
│   ├── torbox.js         # Cache check + add_only_if_cached + file link
│   ├── easyDebrid.js     # Lookup de caché + generación del enlace
│   ├── premiumize.js     # cache/check + directdl solo ante hit
│   ├── http.js           # fetch JSON con timeout
│   ├── tmdb.js           # Cliente TMDB (+ resolución IMDb ids)
│   ├── tvmaze.js         # Cliente TVMaze (web schedule, lookup por IMDb)
│   ├── tvdb.js           # Cliente TheTVDB v4 (login JWT; fichas por IMDb id)
│   ├── omdb.js           # Cliente OMDB (ratings)
│   ├── watchmode.js      # Cliente Watchmode (plataformas)
│   ├── streams.js        # Proveedores de contenido: Knaben, Torlock (Torznab), BlackHoleBay, Nyaa, YTS
│   ├── streamFilters.js  # Filtros de streams: clasificador por nombre + preferencias del usuario
│   ├── catalogs.js       # Definición de catálogos (+ filtrado por config)
│   ├── userConfig.js     # Codec/validación de config de usuario (base64url)
│   ├── branding.js       # Logos de plataformas/estudios vía TMDB
│   ├── homePage.js       # Portada (/)
│   ├── configurePage.js  # Página /configure (idioma, región, plataformas, estudios, streams y filtros)
│   ├── theme.js          # Sistema de diseño compartido (tokens + componentes CSS)
│   ├── layout.js         # Piezas comunes: barra, tarjeta de soporte y pie
│   ├── icons.js          # Iconos SVG en línea (Lucide + marca de Discord)
│   ├── rails.js          # Filas de logos y pósters + animación de entrada
│   ├── staticLogos.js    # Logos de plataformas/estudios de respaldo (URLs de TMDB)
│   ├── posterData.js     # Pósters de muestra para cuando no hay clave de TMDB
│   ├── meta.js           # Constructor de metadatos multi-fuente
│   └── logoData.js       # Logo PNG embebido (base64) para el Worker
├── assets/logo.png       # Logo del addon
├── test/                 # Tests offline (servidor, Worker, proveedores, filtros y web)
├── vercel.json           # Alternativa: despliegue serverless en Vercel
├── .env.example          # Plantilla de variables (Node)
├── .dev.vars.example     # Plantilla de secrets (wrangler dev)
└── README.md
```

## ⚙️ 1. Instalar y configurar

```bash
npm install
cp .env.example .env
```

Edita `.env`:

| Variable | Obligatoria | Descripción |
| :--- | :---: | :--- |
| `TMDB_API_KEY` | **Sí** (o `TMDB_ACCESS_TOKEN`) | Clave v3 de [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) |
| `TMDB_ACCESS_TOKEN` | Alternativa | Token v4 "API Read Access Token" (`eyJ...`) |
| `OMDB_API_KEY` | Recomendada | Ratings IMDb/RT/Metacritic — [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) |
| `WATCHMODE_API_KEY` | Opcional | Dónde ver en streaming — [api.watchmode.com](https://api.watchmode.com/) |
| `TVDB_API_KEY` | Opcional | Fichas TheTVDB por IMDb id — [thetvdb.com/api-information](https://thetvdb.com/api-information) |
| `TVDB_PIN` | Opcional | PIN de suscriptor si tu plan de TVDB lo requiere |
| `WATCH_REGION` | Opcional | Región JustWatch por defecto: `NI` (defecto), `MX`, `ES`, `US`, `AR`... El usuario puede cambiarla en /configure (44 países) |
| `TMDB_LANGUAGE` | Opcional | Idioma por defecto de fichas/catálogos: `es` (defecto), `es-MX`, `en`, `pt-BR`... El usuario puede cambiarlo en /configure (18 idiomas) |
| `SUPPORT_URL` | Opcional | Enlace de soporte que muestra la web. Por defecto, la invitación permanente al [Discord de Catálogos+](https://discord.gg/J6byqsRUfu); si cambia, actualiza esta variable |
| `ADDON_NAME` / `ADDON_BASE_URL` | Opcional | Nombre y URL pública (logo en el manifest) |
| `TMDB_MIN_VOTE_COUNT` | Opcional | Mínimo de votos para "Top Valoradas" (defecto `500`) |
| `CACHE_TTL_SECONDS` | Opcional | TTL de catálogos y metadatos (defecto `21600` = 6h) |
| `STREAM_PROVIDER_TIMEOUT_MS` | Opcional | Timeout por indexador (defecto `6000`; rango 1–9 s) |
| `STREAM_FALLBACK_TIMEOUT_MS` | Opcional | Presupuesto de la búsqueda por título alternativo (defecto `2500` ms) |
| `STREAM_STALE_SECONDS` | Opcional | Ventana para servir resultados conocidos mientras se renueva la caché (defecto 6h) |
| `DEBRID_ENCRYPTION_KEY` | Para cualquier proveedor debrid | Secreto aleatorio de al menos 32 caracteres para cifrar credenciales. No lo subas a Git |
| `REALDEBRID_CLIENT_ID` / `REALDEBRID_CLIENT_SECRET` | Solo con Real-Debrid | Credenciales OAuth de la aplicación; el secret solo vive en el servidor |
| `REALDEBRID_REDIRECT_URI` | Solo con Real-Debrid | URL pública exacta del callback `/internal/debrid/real-debrid/callback` |
| `DEBRID_MAX_CHECKS` / `DEBRID_MAX_RESULTS` | Opcional | Máximo de hashes consultados (8) y enlaces directos generados (3) por petición |
| `DEBRID_TIMEOUT_MS` | Opcional | Tiempo máximo de espera antes de devolver los magnets públicos (4500 ms) |
| `PORT` | Opcional | Puerto local (defecto `7000`) |

> **TVMaze no requiere clave.** Sin TMDB el addon arranca igualmente, pero los catálogos de películas/series TMDB aparecerán vacíos; el catálogo "Series · En TV hoy" siempre funciona.

## ▶️ 2. Ejecutar

```bash
npm start          # servidor Node local → http://localhost:7000
npm run dev:worker # Worker local (workerd) → http://localhost:8787
npm test           # tests offline (servidor y Worker)
```

- Landing: `http://localhost:7000/` (botón "Instalar en Stremio")
- Manifest: `http://localhost:7000/manifest.json`
- Health: `http://localhost:7000/healthz`
- Ejemplo catálogo: `http://localhost:7000/catalog/movie/cine_netflix.json`

Instalación en la app: **Add-ons → pegar la URL del manifest → Instalar**.

## ☁️ 3. Desplegar en Cloudflare Workers (recomendado)

El Worker sirve todo el addon (manifest, catálogos, metadatos, landing y logo embebido) sin dependencias externas. Plan **free** suficiente.

### 3.1 Instalar y autenticar wrangler

```bash
npx wrangler login
```

### 3.2 Configurar tus claves como **secrets**

Las claves **nunca van en `wrangler.toml` ni en Git** — se suben como secrets:

```bash
npx wrangler secret put TMDB_API_KEY        # obligatoria (o TMDB_ACCESS_TOKEN)
npx wrangler secret put OMDB_API_KEY        # opcional: ratings
npx wrangler secret put WATCHMODE_API_KEY   # opcional: dónde ver en streaming
```

#### Servicios debrid (opcional)

Cada persona conecta una cuenta propia desde `/configure`. TorBox, EasyDebrid y Premiumize validan una clave del proveedor; Real-Debrid se autoriza con OAuth (no pegues su token API privado). Las claves/tokens nunca se guardan en el navegador ni en la URL. Para que las credenciales cifradas sobrevivan a los isolates del Worker, crea una KV y una clave de cifrado:

```bash
npx wrangler kv namespace create DEBRID_KV
openssl rand -base64 32                  # copia el resultado, no lo publiques
npx wrangler secret put DEBRID_ENCRYPTION_KEY
```

Copia el `id` que devuelve Wrangler al bloque `[[kv_namespaces]]` de `wrangler.toml` (binding `DEBRID_KV`) y despliega. Para Real-Debrid, registra una aplicación OAuth y configura en el dashboard/CLI `REALDEBRID_CLIENT_ID`, `REALDEBRID_CLIENT_SECRET` y `REALDEBRID_REDIRECT_URI`; este último debe coincidir exactamente con `https://<tu-dominio>/internal/debrid/real-debrid/callback` y con el callback registrado en la aplicación.

En local, copia `.dev.vars.example` a `.dev.vars`, rellena los secretos OAuth si vas a probar RD y crea/configura también una KV de desarrollo. `/healthz` muestra `debrid.providers`, `realDebrid.oauthConfigured` y `realDebrid.credentialStorageReady`. Sin la KV y la clave de cifrado, los streams públicos siguen funcionando, pero no se pueden conectar cuentas debrid.

Las claves API de los usuarios se introducen en `/configure`; no son secretos globales del despliegue. También puedes configurar secretos OAuth y las claves de TMDB/OMDB/Watchmode en **Cloudflare → Workers & Pages → catalogos-plus → Settings → Variables and Secrets**. El servidor Node local usa almacenamiento en memoria efímero; el despliegue Vercel no tiene un backend KV configurado en este repositorio, por lo que la conexión debrid queda deshabilitada allí.

Las variables **no secretas** van en `wrangler.toml` (`WATCH_REGION = "NI"`, `ADDON_NAME`, `TMDB_MIN_VOTE_COUNT`, `CACHE_TTL_SECONDS`) y puedes editarlas con seguridad.

> **TVMaze no requiere clave** — el catálogo "Series · En TV hoy" funciona sin configurar nada.

### 3.3 Desarrollo local del Worker

```bash
cp .dev.vars.example .dev.vars   # pon tus claves para desarrollo local
npm run dev:worker               # http://localhost:8787
```

### 3.4 Desplegar

```bash
npm run deploy                   # = npx wrangler deploy
```

Obtendrás una URL tipo `https://catalogos-plus.tu-subdominio.workers.dev`:

- **Manifest (para instalar en Stremio):** `https://catalogos-plus.tu-subdominio.workers.dev/manifest.json`
- **Landing con botón de 1 clic:** `https://catalogos-plus.tu-subdominio.workers.dev/`
- **Healthcheck:** `https://catalogos-plus.tu-subdominio.workers.dev/healthz`

### 3.5 Instalar en Stremio

1. Abre `https://tu-dominio/configure` y elige **idioma · región · plataformas · estudios · proveedores y filtros de streams**.
2. Pulsa **Instalar en Stremio** — se instala tu manifest personal (`https://tu-dominio/<config>/manifest.json`).
3. O sin configurar: el botón de instalación rápida en la portada (todo activado, sin filtros).

> **Si ya lo tenías instalado:** para Stremio cada URL es un addon distinto. Al instalar una configuración nueva, **desinstala la anterior** (Addons → Catálogos+ → Desinstalar); si no, verás los catálogos repetidos y los streams de la instalación antigua seguirán saliendo sin filtrar.

La **portada** muestra tendencias en vivo (con `TMDB_API_KEY`) o posters estáticos de respaldo, igual la página de configuración.

> **Consejo de región:** la cobertura JustWatch en Nicaragua es limitada; si ves pocos catálogos de plataformas, prueba **MX** o **US** en /configure — tendrán mucho más contenido.

## ▲ Alternativa: Vercel (serverless Node)

El servidor Express (`api/index.js`) también despliega en Vercel tal cual:

1. Sube el repo a GitHub → **vercel.com → Add New → Project** → importa el repo.
2. Añade `TMDB_API_KEY` (y opcionales) en **Environment Variables**.
3. Deploy → manifest en `https://tu-proyecto.vercel.app/manifest.json`.

## 🧰 4. Añadir/quitar plataformas o estudios

Edita `lib/catalogs.js`:

- `PLATFORMS`: añade `{ key, name, providers }` — el `providers` es el **JustWatch provider id** de TMDB (puedes combinar varios con `|`, p. ej. `'1899|384|1825'` para Max). [Lista completa de proveedores TMDB](https://www.themoviedb.org/talk/5-themoviedb-api-v3?page=1) o `/watch/providers/movie` en su API.
- `STUDIOS`: añade `{ key, name, company }` con el **company id** de TMDB (búscalo en `/search/company`).

Cada entrada genera automáticamente **dos** catálogos en el manifest (`cine_<key>` y `tv_<key>`), salvo los estudios,
que generan `cine_estudio_<key>` + `tv_estudio_<key>`.

Logos: añade el logo en `lib/staticLogos.js` (`STATIC_PROVIDER_LOGOS` por `key`, `STATIC_STUDIO_LOGOS` por
**company id**) para que se vea en `/configure` incluso sin `TMDB_API_KEY`; si no hay logo estático se usa el
monograma y, con clave configurada, `branding.js` lo resuelve en vivo desde TMDB.

> ⚠️ **Límite de 8 KB del manifest.** La addonCollection API de Stremio rechaza manifests de más de 8 KB, así que
> el catálogo completo (con todo seleccionado en `/configure`) **no puede crecer indefinidamente**. Ahora mismo son
> ~121 catálogos / ~7,9 KB: si añades plataformas o estudios, quita otros o acorta nombres, y verifica con
> `npm test` (el test de tamaño falla si te pasas).
## 🔌 Endpoints

| Ruta | Descripción |
| :--- | :--- |
| `GET /configure` | Página de configuración (idioma, región, plataformas, estudios, proveedores, filtros y servicios debrid opcionales) |
| `GET /<config>/configure` | La misma página con tu configuración instalada ya cargada (botón «Configurar» de Stremio) |
| `GET /<config>/manifest.json` | Manifest personal según la config elegida |
| `GET /internal/branding.json` | Logos de plataformas/estudios (vía TMDB) para /configure |
| `POST /internal/debrid/connect` / `DELETE /internal/debrid/connect` | Valida y conecta TorBox/EasyDebrid/Premiumize, o desconecta una credencial; Real-Debrid rechaza tokens pegados y exige OAuth |
| `GET /internal/debrid/real-debrid/authorize` / `/callback` | OAuth de Real-Debrid con state/cookie y guardado server-side cifrado |
| `GET /internal/cache.json` | Estadísticas agregadas de caché (sin claves ni datos por usuario) |
| `GET /manifest.json` | Manifest por defecto (todo activado) |
| `GET /catalog/:type/:id.json` | Catálogos (`movie`/`series`) |
| `GET /<config>/catalog/:type/:id.json` | Catálogos con tu config |
| `GET /meta/:type/:id.json` | Ficha enriquecida (`tt…`, `tmdb:movie:123`, `tvmaze:123`, `tvdb:series:123`) |
| `GET /stream/:type/:id.json` | Streams torrent de Knaben + Torlock + BlackHoleBay + Nyaa + YTS (`tt…`, `tt…:T:E` en series) |
| `GET /<config>/stream/:type/:id.json` | Streams con proveedores/filtros y, si hay cuenta conectada, los enlaces directos que el adaptador confirme; respuesta `no-store` |
| `GET /internal/streams-test.json?id=tt…` | Diagnóstico de streams: título resuelto, query, respuesta por proveedor y cuántos resultados caen en cada categoría de filtro (`categories`) |
| `GET /healthz` | Estado del addon y de las fuentes configuradas |
| `GET /assets/logo.png` | Logo del addon |
| `GET /` | Landing con instalador de 1 clic |

## 📝 Notas

- **Caché**: catálogos 6h por defecto; ids externos 7 días; OMDB 24h; Watchmode 12h. La caché en memoria usa LRU, coalesce cargas repetidas y sirve streams conocidos hasta 6h más mientras los renueva. En Cloudflare, `/catalog`, `/meta` y streams públicos pasan por Cache API; cualquier stream personalizado con credencial debrid es `no-store` para no compartir enlaces personales.
- **Degradación elegante**: si falta una clave, esa fuente se omite sin romper el resto.
- **TheTVDB (v4)**: se autentica con `POST /login` → JWT cacheado ~24 días. Alimenta las fichas de series/películas por IMDb id (respaldo cuando TMDB/TVMaze no responden) con nombre/argumento en español si existe la traducción. IDs explícitos soportados: `tvdb:series:123`, `tvdb:movie:123`, `tvdb:123`. TVDB no ofrece un chart público de tendencias, por eso no genera catálogos; si quieres un catálogo por género/cadena de TVDB, dímelo y lo montamos con `/v4/filter`.
- **Idioma y región**: el idioma (18 opciones) se pasa a TMDB y cambia títulos, sinopsis y pósters; los nombres de los catálogos y la web siguen en español. La región (44 países) es el `watch_region` de los catálogos "por plataforma" y el país de «En cines» y «Próximos estrenos». Si una plataforma no tiene resultados en la región elegida se prueba con `WATCH_REGION_FALLBACK` (por defecto `MX,US`). Los valores de partida son `TMDB_LANGUAGE` y `WATCH_REGION`.
- **Soporte**: el enlace sale de `SUPPORT_URL`. Si es de Discord se muestra con su marca; cualquier otra URL http(s) aparece como «Soporte». Por defecto se usa la invitación permanente actual; si cambia, actualiza `SUPPORT_URL`.
- **Proveedores de contenido (streams)**: Knaben, Torlock, BlackHoleBay, Nyaa y YTS no requieren clave. Se consultan en paralelo, se deduplican por infoHash y se cachean 1 h; el timeout es configurable (6 s por indexador por defecto) y una segunda búsqueda por título alternativo solo recibe 2,5 s. El título se resuelve desde IMDb con TMDB (en inglés, que es lo que indexan los torrents), con respaldo TVMaze (series) y **Cinemeta** (sin clave). Control con `STREAM_PROVIDERS`/`STREAM_MAX_RESULTS` y por usuario en `/configure`.
- **Servicios debrid**: se conecta una sola cuenta por configuración. TorBox comprueba la caché antes de crear el torrent con `add_only_if_cached=true` y manda `seed=false`; un hit puede quedar listado en la cuenta. EasyDebrid solo llama a `link/generate` tras un lookup positivo. Premiumize solo llama a `transfer/directdl` tras `cache/check` positivo; esa comprobación es best-effort y el proveedor puede aplicar fair-use. Real-Debrid usa OAuth, renueva tokens en servidor y solo busca hashes entre torrents con estado `downloaded` de la biblioteca personal: no consulta la caché global, no añade ni selecciona torrents. Cada petición revisa como máximo 8 hashes y genera hasta 3 enlaces. Los magnets públicos siempre permanecen como respaldo. La URL/manifest personal contiene un ID opaco que da acceso a esa conexión: no compartas esa URL. En Cloudflare se requiere KV + `DEBRID_ENCRYPTION_KEY`; RD también necesita client ID/secret y callback OAuth. Node local guarda en memoria efímera; Vercel no tiene almacenamiento persistente configurado y no permite conectar cuentas en producción. Las pruebas mock no sustituyen una verificación en vivo con cuentas de proveedor.
- **Nyaa y YTS** son fuentes especializadas: solo se consultan cuando aplican.
  - **YTS** (solo películas) se busca por IMDb id, así que el resultado es exacto. API: [yts.gg/api](https://yts.gg/api).
  - **Nyaa** (anime y producciones asiáticas: idioma original japonés, coreano, chino o tailandés, o título de origen desconocido) se consulta a través de una API comunitaria no oficial de nyaa.si ([nyaaapi.onrender.com](https://nyaaapi.onrender.com/docs)). Se busca con el título en inglés, el original y los romanizados (romaji) de TMDB — sin clave de TMDB no hay romaji y se pierden los lanzamientos que solo llevan ese nombre. El filtro entiende la numeración de fansub (`Título - 05`, `Título S2 - 05`, `Título 2nd Season - 05`) y los lotes por temporada.
  - Nyaa **no** cubre: numeración absoluta (`One Piece - 1100`), temporadas que se publican con subtítulo propio en vez de número, ni especiales (temporada 0). La API devuelve como mucho los 75 resultados con más seeders por búsqueda.
  - En un lote de temporada el addon no sabe qué archivo corresponde a cada episodio (no manda `fileIdx`). El reproductor de Stremio (`stremio-video`) pide entonces al servidor de streaming que lo deduzca a partir de la temporada y el episodio; un cliente que no lo haga abrirá el archivo más grande del torrent. Lo mismo vale para los packs de temporada de los demás proveedores.
  - Si alguna de las dos APIs cambia de dominio: `NYAA_API_URL` y `YTS_API_URL`.
  - **Al actualizar**: si tu despliegue define `STREAM_PROVIDERS`, añade `nyaa,yts`. Las URL personales ya instaladas llevan su lista de proveedores: vuelve a `/configure`, marca Nyaa y YTS y reinstala.
- **¿No aparecen streams?** 1) Comprueba primero que tu manifest personal responde 200: abre `https://tu-dominio/<tu-config>/manifest.json`. Si devuelve `404 invalid_config`, la URL de config está mal formada (el segmento base64url se valida hasta `MAX_CONFIG_SEGMENT` = 4096 caracteres; una config completa ronda los 600, un tope menor la rompía). Vuelve a `/configure` y reinstala. 2) Redepliega esta versión y **reinstala el addon en Stremio** — el manifest anterior no declaraba el recurso `stream` y Stremio nunca pide streams a un addon sin él. 3) Abre `/internal/streams-test.json?id=tt1160419` en tu despliegue (para un episodio: `?type=series&id=tt22248376:1:5`): indica la etapa que falla (título no resuelto, proveedor caído/bloqueado — Torlock bloquea algunas IPs de datacenter y ofrece whitelisting — o 0 resultados relevantes).

## 🧲 Filtros de streams

Cada usuario los elige en `/configure` y viajan en su URL personal (`hide`, `sort` y `maxSize`). Sin filtros la respuesta es exactamente la de siempre, y las URL instaladas antes de esta versión siguen funcionando igual.

| Grupo | Categorías |
| :--- | :--- |
| Tipo de copia | WEB-DL · WEBRip, BluRay, REMUX, HDTV · DVD · otras, Screener, CAM · TS |
| Resolución | 4K · 2160p, 1080p, 720p, SD, sin indicar |
| Imagen y códec | 3D, HDR, Dolby Vision, HEVC · x265, AV1 |

- **Cómo se clasifica**: por el **nombre del torrent** (`lib/streamFilters.js`). Cada resultado recibe un tipo de copia y una resolución, más las etiquetas de imagen que apliquen, y se oculta si **cualquiera** de sus etiquetas está desmarcada. Una copia mal etiquetada por quien la subió puede colarse o quedar oculta por error.
- **El título no cuenta**: «Saw 3D», «Cam» o «Charlotte's Web» no se etiquetan a sí mismas; una marca solo vale si aparece en el nombre más veces que en el título de la obra. `TS`/`TC`/`CAM` sueltos solo cuentan si el nombre no declara otra fuente (BluRay, WEB, HDTV…).
- **Orden**: más seeders (por defecto), mejor calidad (de 4K a SD, con CAM y screeners al final) o menor tamaño.
- **Tamaño máximo**: se compara con el tamaño del torrent entero, así que un pack de temporada pesa mucho más que un episodio suelto. Los resultados sin tamaño conocido se conservan.
- **«Recomendado»** oculta CAM · TS, screeners y 3D.
- **Caché**: la búsqueda se guarda sin filtrar (hasta 100 resultados por título) y los filtros se aplican en cada petición, de modo que dos usuarios con filtros distintos comparten la misma búsqueda. `STREAM_MAX_RESULTS` se aplica **después** de filtrar.
- **Si todo queda oculto** el addon responde una lista vacía: vuelve a marcar alguna categoría. Un estreno reciente puede existir solo en CAM.
- **Diagnóstico**: `/internal/streams-test.json?id=tt…` incluye `categories` con el número de resultados de cada categoría para ese título.

## 📄 Licencia

MIT

### Límites y errores de proveedores

- OMDB puede responder `Request limit reached!` cuando se agota la cuota. El addon pausa nuevas consultas durante 15 minutos por instancia; esto no amplía la cuota. Revisa el plan o espera su renovación.
- TMDB puede responder HTTP 429: se reduce el paralelismo al resolver IDs y se aplazan consultas por instancia según `Retry-After` (máximo 5 minutos; 30 segundos si no se indica). Las respuestas ya cacheadas siguen disponibles.
- Un 404 de lookup en TVMaze puede indicar que la serie no existe en su base de datos. Las búsquedas negativas se cachean durante una hora.
- Los timeouts de Knaben/Torlock/Nyaa/YTS indican que un proveedor tardó más que `STREAM_PROVIDER_TIMEOUT_MS` (6 s por defecto); los demás se consultan en paralelo y responden igualmente. Una respuesta incompleta no sustituye la caché buena. Si queda una entrada vieja, se sirve al instante mientras se renueva en segundo plano.
- Los mensajes de error de la aplicación no incluyen parámetros ni cuerpos de respuesta. OMDB y TMDB (con clave v3) aún requieren claves en la URL: configura la plataforma de observabilidad para no guardar parámetros de esas solicitudes. Si una clave apareció en registros, rótala y elimina o restringe el acceso a los registros históricos.
- Cachés y pausas son locales a cada instancia; no coordinan cuotas entre instancias serverless.
