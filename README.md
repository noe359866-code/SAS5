# 🎬 Catálogos+ — Addon de Stremio

Addon gratuito para Stremio con catálogos de **películas y series**. Los servicios debrid son opcionales y usan la cuenta propia del usuario (TorBox, EasyDebrid, Premiumize o Real-Debrid):

- 🔥 **Tendencias** de la semana (TMDB)
- ⭐ **Top Valoradas** (TMDB, mínimo de votos configurable)
- 🍿 **Populares** (TMDB)
- 🎬 **Web** con sistema de diseño propio (`lib/theme.js`): piel tipo Apple TV —negro profundo, tipografía SF con titulares a dos tonos, barra translúcida con las secciones en una cápsula de pestañas (marca la sección visible y se adapta al ancho de cada idioma), botones de píldora (blanco sobre negro para la acción principal), fichas opacas sin borde y estantes de pósters con foco tipo tvOS (el arte crece con un brillo que sigue al cursor) y flechas para recorrerlos— con iconos SVG en línea (`lib/icons.js`, sin emojis ni fuentes de iconos) y **0 peticiones externas** salvo las imágenes de TMDB. La portada abre con un hero cinematográfico (muro de pósters a toda la anchura, fundido a negro bajo el mensaje) y sigue con cifras reales del addon, tendencias numeradas con buscador, funciones, instalación en 3 pasos, preguntas frecuentes y botón de copiar la URL. Respeta `prefers-reduced-motion`
- 🎛️ **Página de configuración `/configure`**: índice lateral con el resumen de cada sección, **idioma (18) y región (44) con buscador**, rejilla de plataformas y estudios con logos (CDN público de TMDB, visibles incluso sin clave), catálogos base, proveedores de streams, **filtros de streams** y una barra inferior fija con el contador de catálogos, la URL y el botón de instalar → genera tu **manifest personal** `/<config>/manifest.json`
- 🧲 **Filtros de streams por usuario**: cada persona decide qué copias no quiere ver —**CAM/TS, screeners, 3D, 4K**, REMUX, Dolby Vision, HEVC, AV1…—, el orden (seeders, calidad o tamaño) y un tamaño máximo. Ver [Filtros de streams](#-filtros-de-streams)
- ⚡ **Servicios debrid opcionales**: TorBox, EasyDebrid, Premiumize y Real-Debrid añaden enlaces directos según la disponibilidad del proveedor; las credenciales se cifran en el servidor y los magnets públicos siguen como alternativa. Real-Debrid usa OAuth y solo la biblioteca personal completada; no consulta disponibilidad global ni añade torrents.
- 🏷️ **Etiquetas técnicas de stream** (`lib/badges.js`): cada stream lleva una línea con sus datos detectados del nombre (4K · DV · HEVC · Atmos · 7.1 · WEB-DL · MKV · ESP…), configurable por grupos en `/configure` con vista previa de tres estilos (Glass, Split, Icon Dark). En Stremio se leen como texto; en **Nuvio** esas mismas palabras son las que un pack de insignias con imágenes (p. ej. [FR-Badges](https://github.com/farizmohd70/FR-Badges), en *Perfil → Layout → Streams → «Fusion badge URLs»*) convierte en sus dibujos.
- 🚀 **Respuestas más rápidas**: proveedores en paralelo con timeout configurable, búsquedas repetidas coalescidas, caché stale-while-revalidate y caché compartida de Cloudflare para catálogos y fichas.
- 💬 **Soporte**: enlace al Discord en la barra, en una tarjeta y en el pie de las dos páginas (`SUPPORT_URL`)
- ☕ **Donaciones**: botón de Ko-fi en la barra, una tarjeta propia («Invítame un café») y un enlace en el pie de las dos páginas. El donante paga con **PayPal** o tarjeta dentro de Ko-fi (`KOFI_USERNAME`)
- 📺 **Por plataforma (30)**: Netflix, Prime Video, Disney+, Max (HBO), Apple TV+, Paramount+, Crunchyroll, Hulu, AMC+, MUBI, Tubi, Pluto TV, Peacock, Starz, MGM+, YouTube Premium, **Plex, Amazon Freevee, The Roku Channel, discovery+, ViX, Claro video, DIRECTV GO, Movistar TV, Filmin Latino, Globoplay, Filmin, Atresplayer, SkyShowtime y Movistar Plus+** — películas y series (TMDB Discover con JustWatch providers, con **fallback automático MX→US** si tu región no tiene resultados)
- 🎥 **Por estudio (21)** · películas **y series**: Marvel Studios, Pixar, Walt Disney Pictures, Disney Animation, Lucasfilm, Warner Bros., New Line Cinema, Universal, Illumination, DreamWorks Animation, Paramount Pictures, Sony Pictures, 20th Century Studios, MGM, Lionsgate, A24, Blumhouse, Studio Ghibli, Toei Animation, MAPPA y Kyoto Animation (TMDB Discover con `with_companies`, en `/discover/movie` y `/discover/tv`)
- 📡 **Series · En TV hoy** (TVMaze, **gratis y sin clave**)

Metadatos enriquecidos en la ficha:

- 🎞️ Ficha principal, póster, fondo, géneros, reparto y dirección → **TMDB**
- 📡 Argumento, géneros y canales → **TVMaze** (funciona siempre, sin clave)
- ⭐ Valoraciones **IMDb · Rotten Tomatoes · Metacritic** → **OMDB**
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
│   ├── debridShared.js   # Red común de proveedores (UA, plazos, clasificación de errores)
│   ├── debridConnect.js  # Lógica compartida de POST /internal/debrid/connect (Worker + Express)
│   ├── realDebridOAuth.js # OAuth server-side y renovación de tokens
│   ├── realDebrid.js     # Resolución solo de torrents descargados en biblioteca personal
│   ├── torbox.js         # Cache check + add_only_if_cached + file link
│   ├── easyDebrid.js     # Lookup de caché + generación del enlace
│   ├── premiumize.js     # cache/check + directdl solo ante hit
│   ├── http.js           # fetch JSON con timeout
│   ├── tmdb.js           # Cliente TMDB (+ resolución IMDb ids)
│   ├── tvmaze.js         # Cliente TVMaze (web schedule, lookup por IMDb)
│   ├── omdb.js           # Cliente OMDB (ratings)
│   ├── streams.js        # Proveedores de contenido: Knaben, Torlock (Torznab), BlackHoleBay, Nyaa, YTS, EZTV, The RarBg, Índice BR, Torrentio ES/Latino, Español (ES/LAT), SpinFlix, Fanpelis, Embed69, VideoAPI, PlayLatinSRC
│   ├── streamFilters.js  # Filtros de streams: clasificador por nombre + preferencias del usuario
│   ├── catalogs.js       # Definición de catálogos (+ filtrado por config)
│   ├── userConfig.js     # Codec/validación de config de usuario (base64url)
│   ├── branding.js       # Logos de plataformas/estudios vía TMDB
│   ├── homePage.js       # Portada (/)
│   ├── configurePage.js  # Página /configure (idioma, región, plataformas, estudios, streams y filtros)
│   ├── theme.js          # Sistema de diseño compartido (tokens + componentes CSS)
│   ├── layout.js         # Piezas comunes: barra, tarjetas de soporte y donación y pie
│   ├── icons.js          # Iconos SVG en línea (Lucide + marcas de Discord, Ko-fi y PayPal)
│   ├── rails.js          # Filas de logos y pósters + animación de entrada
│   ├── staticLogos.js    # Logos de plataformas/estudios de respaldo (URLs de TMDB)
│   ├── posterData.js     # Pósters de muestra para cuando no hay clave de TMDB
│   ├── meta.js           # Constructor de metadatos multi-fuente
│   └── logoData.js       # Logo PNG embebido (base64) para el Worker
├── assets/logo.png       # Logo del addon (fuente)
├── public/               # Static assets del Worker: gratis e ilimitados
│   ├── _headers          # CORS + Cache-Control de los assets
│   ├── robots.txt        # Bloquea rutas dinámicas para no gastar cuota
│   ├── assets/logo.png   # Logo servido sin ejecutar el Worker
│   └── catalog/          # Catálogos pregenerados (npm run prerender; no se commitea)
├── scripts/
│   ├── prerender-catalogs.mjs # Congela los catálogos por defecto como estáticos
│   └── build-web.mjs          # Congela / y /configure como estáticos (PUBLIC_ORIGIN)
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
| `WATCH_REGION` | Opcional | Región JustWatch por defecto: `NI` (defecto), `MX`, `ES`, `US`, `AR`... El usuario puede cambiarla en /configure (44 países) |
| `TMDB_LANGUAGE` | Opcional | Idioma por defecto de fichas/catálogos: `es` (defecto), `es-MX`, `en`, `pt-BR`... El usuario puede cambiarlo en /configure (18 idiomas) |
| `SUPPORT_URL` | Opcional | Enlace de soporte que muestra la web. Por defecto, la invitación permanente al [Discord de Catálogos+](https://discord.gg/J6byqsRUfu); si cambia, actualiza esta variable |
| `KOFI_USERNAME` | Opcional | Usuario de Ko-fi para el botón de donar (por defecto `hydratorrents`). Acepta el usuario, `ko-fi.com/usuario` o la URL completa. Con `KOFI_USERNAME=off` desaparecen el botón, la tarjeta y el enlace del pie |
| `ADDON_NAME` / `ADDON_BASE_URL` | Opcional | Nombre y URL pública (logo en el manifest) |
| `TMDB_MIN_VOTE_COUNT` | Opcional | Mínimo de votos para "Top Valoradas" (defecto `500`) |
| `CACHE_TTL_SECONDS` | Opcional | TTL de catálogos y metadatos (defecto `21600` = 6h) |
| `STREAM_PROVIDER_TIMEOUT_MS` | Opcional | Timeout por indexador (defecto `6000`; rango 1–9 s) |
| `STREAM_PROVIDER_COOLDOWN_SECONDS` | Opcional | Pausa de un indexador que agota el timeout 3 veces seguidas o responde HTTP 429: durante ese tiempo no se consulta, para no esperarlo en cada petición (defecto `300`; `0` = nunca pausar) |
| `RARBG_API_KEY` | Opcional | Clave gratuita de The RarBg: sube su límite de 30 a 60 peticiones por minuto y de 10.000 a 50.000 al día |
| `STREAM_FALLBACK_TIMEOUT_MS` | Opcional | Presupuesto de la búsqueda por título alternativo (defecto `2500` ms) |
| `STREAM_STALE_SECONDS` | Opcional | Ventana para servir resultados conocidos mientras se renueva la caché (defecto 6h) |
| `DEBRID_ENCRYPTION_KEY` | Para cualquier proveedor debrid | Secreto aleatorio de al menos 32 caracteres para cifrar credenciales. No lo subas a Git |
| `REALDEBRID_CLIENT_ID` / `REALDEBRID_CLIENT_SECRET` | Solo con Real-Debrid | Credenciales OAuth de la aplicación; el secret solo vive en el servidor |
| `REALDEBRID_REDIRECT_URI` | Solo con Real-Debrid | URL pública exacta del callback `/internal/debrid/real-debrid/callback` |
| `DEBRID_MAX_CHECKS` / `DEBRID_MAX_RESULTS` | Opcional | Máximo de hashes consultados (8) y enlaces directos generados (3) por petición |
| `DEBRID_TIMEOUT_MS` | Opcional | Tiempo máximo de espera antes de devolver los magnets públicos (4500 ms) |
| `DEBRID_VALIDATE_TIMEOUT_MS` | Opcional | Plazo al validar la clave debrid en `/configure` (9000 ms); sube a 12000–15000 si el proveedor responde lento |
| `ANIMEFLV` | Opcional | `off` desactiva AnimeFLV experimental |
| `FRENCHSTREAM` | Opcional | `off` desactiva FrenchStream experimental |
| `DEVIDEOSRC` | Opcional | `off` desactiva DeVideoSRC experimental (solo URLs directas, puede no devolver resultados) |
| `VIXSRC` | Opcional | `off` desactiva el extractor VixSrc (activo por defecto; experimental) |
| `PLAYLATIN_URL` | Opcional | Dominio de PlayLatinSRC (defecto `https://playlatinsrc.co`) |
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

El Worker sirve todo el addon (manifest, catálogos, metadatos, landing y logo embebido) sin dependencias externas. Plan **free** suficiente; si tu comunidad crece, mira [Escalar en el plan free](#-escalar-en-el-plan-gratuito-100k--145k-peticionesdía): los catálogos por defecto se sirven como *static assets* (gratis e ilimitados) y no gastan la cuota diaria.

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
openssl rand -base64 32                  # copia el resultado, no lo publiques
npx wrangler secret put DEBRID_ENCRYPTION_KEY
npm run debrid:kv                        # crea la KV y la enlaza en wrangler.toml
```

`npm run debrid:kv` (que también se ejecuta solo dentro de `npm run deploy`) crea el namespace `DEBRID_KV` si no existe y escribe él mismo el bloque `[[kv_namespaces]]` de `wrangler.toml`; si no hay sesión de Cloudflare, avisa y continúa sin fallar el despliegue. También puedes hacerlo a mano con `npx wrangler kv namespace create DEBRID_KV` y copiar el `id` al bloque. **Sin KV, conectar debrid sigue funcionando**: el Worker guarda las credenciales cifradas en la Cache API de Cloudflare, pero esa caché es por datacenter y Cloudflare puede expulsar las entradas, así que la KV es la opción recomendada. Para Real-Debrid, registra una aplicación OAuth y configura en el dashboard/CLI `REALDEBRID_CLIENT_ID`, `REALDEBRID_CLIENT_SECRET` y `REALDEBRID_REDIRECT_URI`; este último debe coincidir exactamente con `https://<tu-dominio>/internal/debrid/real-debrid/callback` y con el callback registrado en la aplicación.

En local, copia `.dev.vars.example` a `.dev.vars`, rellena los secretos OAuth si vas a probar RD y crea/configura también una KV de desarrollo. `/healthz` muestra `debrid.providers`, `realDebrid.oauthConfigured`, `realDebrid.credentialStorageReady` y `realDebrid.credentialStorage` (`kv` duradero, `cache` Cache API del Worker o `memory` en local). Se puede conectar cuentas en cuanto existe `DEBRID_ENCRYPTION_KEY`; sin la KV las credenciales viven en la Cache API (por datacenter y expulsables), así que conviene crearla para que no se pierdan.

Las claves API de los usuarios se introducen en `/configure`; no son secretos globales del despliegue. También puedes configurar secretos OAuth y las claves de TMDB/OMDB en **Cloudflare → Workers & Pages → catalogos-plus → Settings → Variables and Secrets**. El servidor Node local usa almacenamiento en memoria efímero; el despliegue Vercel no tiene un backend KV configurado en este repositorio, por lo que la conexión debrid queda deshabilitada allí.

##### Si «no valida» la clave debrid

El botón **Validar y conectar** hace un `POST /internal/debrid/connect`; el Worker comprueba la
clave contra el proveedor y solo la guarda si el proveedor la acepta. Cuando falla, `/configure`
muestra el motivo concreto en su bloque de estado —rojo si es tu clave, amarillo si es la cuenta,
azul si el servicio no respondió— y debajo, en gris, el mensaje público del proveedor si lo trae.
Los códigos:

| `code` en la respuesta | Qué significa | Qué hacer |
| --- | --- | --- |
| `invalid_credential` | El proveedor rechazó la clave (401/403 con JSON, `BAD_TOKEN` en TorBox, `Wrong API key…` en Premiumize) | Copia la API key desde la web del proveedor (TorBox: `torbox.app/settings` → apartado API; Premiumize: `premiumize.me/account` → API key, no el Customer ID). Si la acabas de resetear, espera un minuto |
| `provider_blocked` | El borde del proveedor (Cloudflare/anti-bot) cortó la petición antes de leer la clave | No es tu clave. Los clientes salen con `User-Agent` explícito (sin él, Cloudflare Workers mandan el agente vacío y TorBox/RD/Premiumize responden 403 con HTML); si persiste, revisa las reglas de Firewall de Cloudflare y la IP de salida del Worker |
| `provider_timeout` / `provider_unreachable` | El proveedor no respondió a tiempo o el Worker no tuvo salida | Reintenta; si es recurrente sube `DEBRID_VALIDATE_TIMEOUT_MS` (p. ej. `12000`) |
| `provider_unavailable` | El proveedor está caído o en mantenimiento (5xx) | Espera; el addon ya reintenta una vez y deja los magnets públicos funcionando |
| `provider_rate_limited` | Límite del proveedor (TorBox 300/min, Real-Debrid 250/min) o el tuyo propio (8 intentos/min por IP en `/connect`) | Espera un minuto |
| `provider_login_redirect` | El proveedor redirigió su API al login en vez de responder en JSON (pasa con EasyDebrid cuando no te trata como API) | Reintenta desde `/configure`; si persiste, la ruta de la API cambió y hay que actualizar `lib/easyDebrid.js` |
| `provider_endpoint_missing` | El endpoint de validación cambió de ruta (404) | Actualizar el adaptador (`lib/<proveedor>.js`) |
| `debrid_not_configured` | Falta `DEBRID_ENCRYPTION_KEY` y un almacén (KV o Cache API) | Crea el secreto; `/healthz` → `realDebrid.credentialStorageReady` debe ser `true` (y `credentialStorage` indica `kv` o `cache`) |
| `credential_format` | La clave pegada tiene una forma imposible | Copia la clave entera (entre 12 y 256 caracteres, sin espacios) |

Para separar «mi clave está mal» de «mi Worker no llega al proveedor», usa la autocomprobación —
primero contra el proveedor y luego contra tu despliegue (la clave va por variable de entorno para
que no quede en el historial del shell):

```bash
DEBRID_KEY=«tu-api-key» npm run debrid:selftest -- torbox   # igual que el script directo
DEBRID_KEY=«tu-api-key» node scripts/debrid-selftest.mjs torbox
DEBRID_KEY=«tu-api-key» node scripts/debrid-selftest.mjs torbox --url https://catalogo.tu-usuario.workers.dev
# opcional: comprueba un hash concreto y si el proveedor devuelve enlace directo
DEBRID_KEY=«tu-api-key» node scripts/debrid-selftest.mjs torbox --hash 0123456789abcdef0123456789abcdef01234567
```

Las variables **no secretas** van en `wrangler.toml` (`WATCH_REGION = "NI"`, `ADDON_NAME`, `TMDB_MIN_VOTE_COUNT`, `CACHE_TTL_SECONDS`) y puedes editarlas con seguridad.

> **TVMaze no requiere clave** — el catálogo "Series · En TV hoy" funciona sin configurar nada.

### 3.3 Desarrollo local del Worker

```bash
cp .dev.vars.example .dev.vars   # pon tus claves para desarrollo local
npm run dev:worker               # http://localhost:8787
```

### 3.4 Desplegar

```bash
npm run deploy                   # = prerender catálogos + prerender web + wrangler deploy
npx wrangler deploy              # solo el Worker, sin regenerar catálogos estáticos
```

`npm run prerender` congela los catálogos del manifest por defecto en `public/catalog/` (necesita
`TMDB_API_KEY` en el entorno; sin clave no escribe nada y el Worker los sigue resolviendo en vivo).
Con `[assets]` en `wrangler.toml` esas peticiones las sirve Cloudflare **sin ejecutar el Worker**, así
que son gratuitas e ilimitadas. Detalles y el resto de palancas en
[docs/escala-plan-free.md](docs/escala-plan-free.md).

Obtendrás una URL tipo `https://catalogos-plus.tu-subdominio.workers.dev`:

- **Manifest (para instalar en Stremio):** `https://catalogos-plus.tu-subdominio.workers.dev/manifest.json`
- **Landing con botón de 1 clic:** `https://catalogos-plus.tu-subdominio.workers.dev/`
- **Healthcheck:** `https://catalogos-plus.tu-subdominio.workers.dev/healthz`

#### Capacidad del plan free: +230K–500K peticiones/día

El plan gratuito de Workers tiene **100.000 invocaciones/día por cuenta** (Error 1027), **10 ms de CPU**, **50 subpeticiones/invocación**, **1.000 lecturas KV/día** y **20.000 archivos estáticos** por versión. `Catálogos+` está diseñado para **+500.000 peticiones/día** combinando siete defensas automáticas:

> **Aviso importante para `*.workers.dev`:** la Cache API de Cloudflare **no funciona** en esos
> subdominios («any Cache API operations … in *.workers.dev deployments will have no impact») y allí
> no se pueden crear Cache Rules. Sin dominio propio, lo único gratis son los static assets, así que
> el paso 3 (dominio propio) es el que decide si llegas a 500K.

1. **Zero-Worker Static Assets (`public/`, tráfico gratis e ilimitado).** Con `[assets]` (`run_worker_first = false`) en `wrangler.toml`, Cloudflare sirve sin despertar al Worker los 121 catálogos por defecto (`npm run prerender`), **las fichas de sus títulos** (`public/meta/`, hasta 1.500), el logo y, al definir `PUBLIC_ORIGIN=https://tu-dominio.example npm run build:web`, también `public/index.html`, `public/configure/index.html`, `public/manifest.json` y `public/internal/branding.json`. El workflow `.github/workflows/prerender.yml` los regenera y despliega automáticamente cada 6 h, y el script se detiene antes de superar los 20.000 archivos del plan free.
2. **Caché de respuestas en el isolate (`lib/responseCache.js`).** Va **antes** que la Cache API porque esta última no hace nada en `*.workers.dev`. Guarda la respuesta completa en memoria (presupuesto por bytes, `RESPONSE_CACHE_MB`, 24 MB por defecto), respeta el `Cache-Control` publicado, sirve *stale* mientras revalida y ejecuta **una sola** carga para las peticiones simultáneas del mismo recurso. No ahorra invocaciones, pero sí CPU, subpeticiones y cuota de TMDB/OMDB.
3. **Edge Cache canónica entre usuarios (`worker.mjs`).** Las rutas `/<cfg>/catalog/*`, `/<cfg>/meta/*` y `/<cfg>/stream/*` (sin debrid) comparten la misma clave en `caches.default` según sus parámetros reales (`lang`, `region`, filtros), aunque cada usuario tenga un token `/<cfg>/` distinto. Las respuestas con `debridId` jamás tocan caché compartida (`Cache-Control: no-store`).
3. **CDN Edge con `s-maxage` + `stale-while-revalidate` (dominio propio).** Todas las rutas públicas emiten `s-maxage` y `stale-while-revalidate`. Con un dominio propio en Cloudflare y una **Cache Rule** que respete `Cache-Control` en rutas públicas (`/catalog/`, `/meta/`, `/manifest.json`), el CDN absorbe >75 % del tráfico con **0 invocaciones al Worker**.
4. **Caché en memoria de KV Debrid (`lib/debridCredentials.js`).** Las credenciales descifradas se cachean 5 min en RAM del isolate (con invalidación instantánea al actualizar/desconectar) y `cacheTtl: 300` en KV, reduciendo >95 % las lecturas contra el límite gratuito de 1.000 lecturas KV/día.
5. **Presupuesto estricto de subpeticiones y Single-Flight (`cache.coalesce`).** Coalescencia de peticiones concurrentes en TMDB, OMDB, catálogos, fichas y streams; tope de 24 `/external_ids` por invocación (muy por debajo del límite de 50 subrequests de Cloudflare) y `MAX_ENTRIES = 8000` en la LRU.
6. **Cero fan-out innecesario en web.** Los 21 estudios llevan logo estático integrado (0 llamadas extra al abrir `/configure`), botón *«Esenciales (carga rápida)»* para manifiestos ligeros y coalescencia de peticiones en `/configure`. Consulta la arquitectura detallada y la Cache Rule exacta en [docs/escala-plan-free.md](docs/escala-plan-free.md).
7. **Auditoría medible (`npm run scale:audit`).** El Worker marca sus respuestas con `X-Catalogos-Runtime: worker`: lo que llegue sin esa cabecera no consumió invocación. Con eso, `node scripts/scale-audit.mjs --url https://tu-dominio` mide qué parte de tu tráfico es gratis y proyecta cuántas invocaciones/día necesitarías (sale con código `2` si te pasas de las 100.000).

### Corregido tras las pruebas en vivo del 17/11/2026

Ver [docs/pruebas-en-vivo-2026-11-17.md](docs/pruebas-en-vivo-2026-11-17.md). Los cinco fallos que se veían en el
cliente y su estado:

| Fallo | Corrección |
|---|---|
| Streams de otras series dentro de una ficha («The Bad Guys Breaking In» en Breaking Bad) | `isRelevant()` exige que el título aparezca como frase contigua, además de temporada y episodio. |
| Publicidad de «vercineo.net» en descripciones **y en títulos** de TMDB/TVMaze | Nuevo `lib/sanitize.js`, aplicado en catálogos, fichas, portada y TVMaze. |
| `tvdb:` y `tmdb:<id>` sin tipo devolvían `[]` o una serie equivocada en silencio | Se señalan con un motivo (`stage: parseId` en `/internal/streams-test.json`) y `meta` desambigua `tmdb:<id>` con el tipo de la petición. |
| Debrid: la credencial desaparecía a los 5 minutos sin avisar | El servidor devuelve `durable: false` y `/configure` lo advierte. Para que sea duradero sigue haciendo falta crear `DEBRID_KV`. |


```bash
npm run scale:audit -- --url https://tu-dominio            # proyección a 500.000 peticiones/día
npm run scale:audit -- --url https://tu-dominio --requests 800000
```

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
| `GET /stream/:type/:id.json` | Streams torrent de Knaben + Torlock + BlackHoleBay + Nyaa + YTS + EZTV + The RarBg + Índice BR + Torrentio ES/Latino + Español (ES/LAT) + SpinFlix + Fanpelis + Embed69 + VideoAPI + PlayLatinSRC (`tt…`, `tt…:T:E` en series) |
| `GET /<config>/stream/:type/:id.json` | Streams con proveedores/filtros y, si hay cuenta conectada, los enlaces directos que el adaptador confirme; respuesta `no-store` |
| `GET /internal/streams-test.json?id=tt…` | Diagnóstico de streams: título resuelto, query, respuesta por proveedor y cuántos resultados caen en cada categoría de filtro (`categories`) |
| `GET /hls?u=…&ref=…` | Proxy HLS de los streams directos de SpinFlix (lista blanca de hosts y extensiones de media) |
| `GET /healthz` | Estado del addon y de las fuentes configuradas |
| `GET /assets/logo.png` | Logo del addon |
| `GET /` | Landing con instalador de 1 clic |

## 📝 Notas

- **Caché**: catálogos 6h por defecto; ids externos 7 días; OMDB 24h. La caché en memoria usa LRU, coalesce cargas repetidas y sirve streams conocidos hasta 6h más mientras los renueva. En Cloudflare, `/catalog`, `/meta` y streams públicos pasan por Cache API; cualquier stream personalizado con credencial debrid es `no-store` para no compartir enlaces personales.
- **Degradación elegante**: si falta una clave, esa fuente se omite sin romper el resto.
- **Idioma y región**: el idioma (18 opciones) se pasa a TMDB y cambia títulos, sinopsis y pósters; los nombres de los catálogos y la web siguen en español. La región (44 países) es el `watch_region` de los catálogos "por plataforma" y el país de «En cines» y «Próximos estrenos». Si una plataforma no tiene resultados en la región elegida se prueba con `WATCH_REGION_FALLBACK` (por defecto `MX,US`). Los valores de partida son `TMDB_LANGUAGE` y `WATCH_REGION`.
- **Soporte**: el enlace sale de `SUPPORT_URL`. Si es de Discord se muestra con su marca; cualquier otra URL http(s) aparece como «Soporte». Por defecto se usa la invitación permanente actual; si cambia, actualiza `SUPPORT_URL`.
- **Donaciones (Ko-fi → PayPal)**: la web muestra tu página de Ko-fi (`KOFI_USERNAME`) en la barra, en una tarjeta propia y en el pie; Ko-fi es quien cobra, con PayPal o tarjeta, y no cobra comisión por donaciones. No hace falta ninguna clave: **Ko-fi no tiene API pública de lectura** —su única superficie para desarrolladores es un webhook que notifica cada pago completado (`POST` con campo `data` en JSON y `verification_token`)—, así que este addon no guarda ni consulta donaciones. Si más adelante quieres un contador de agradecimiento o los últimos apoyos públicos, hace falta ese webhook (`KOFI_WEBHOOK_VERIFICATION_TOKEN`) y un sitio donde guardarlos; dímelo y lo montamos. `/healthz` informa del estado con `donations`.
- **Proveedores de contenido (streams)**: Knaben, Torlock, BlackHoleBay, Nyaa, YTS, EZTV, The RarBg, Índice BR, Torrentio ES/Latino, Español (ES/LAT), SpinFlix, Fanpelis, Embed69, VideoAPI y PlayLatinSRC no requieren clave. Se consultan en paralelo, se deduplican por infoHash y se cachean 1 h; el timeout es configurable (6 s por indexador por defecto) y una segunda búsqueda por título alternativo solo recibe 2,5 s. El título se resuelve desde IMDb con TMDB (en inglés, que es lo que indexan los torrents), con respaldo TVMaze (series) y **Cinemeta** (sin clave). Control con `STREAM_PROVIDERS`/`STREAM_MAX_RESULTS` y por usuario en `/configure`.
- **Servicios debrid**: se conecta una sola cuenta por configuración. TorBox comprueba la caché antes de crear el torrent con `add_only_if_cached=true` y `seed=3` («don't seed», el parámetro documentado por TorBox es 1=auto, 2=sembrar, 3=no sembrar); un hit puede quedar listado en la cuenta. Los clientes mandan `User-Agent` propio: Cloudflare Workers salen sin él y el borde anti-bots de los proveedores responde 403 antes de mirar la clave. EasyDebrid solo llama a `link/generate` tras un lookup positivo. Premiumize solo llama a `transfer/directdl` tras `cache/check` positivo; esa comprobación es best-effort y el proveedor puede aplicar fair-use. Real-Debrid usa OAuth, renueva tokens en servidor y solo busca hashes entre torrents con estado `downloaded` de la biblioteca personal: no consulta la caché global, no añade ni selecciona torrents. Cada petición revisa como máximo 8 hashes y genera hasta 3 enlaces. Real-Debrid recorre la biblioteca personal en páginas de 500 entradas, con un tope defensivo de 20 páginas (10.000 torrents) y un presupuesto total de hasta 15 s; las respuestas incompletas por alcanzar el tope o el tiempo no se cachean como misses definitivos. Los magnets públicos siempre permanecen como respaldo. La URL/manifest personal contiene un ID opaco que da acceso a esa conexión: no compartas esa URL. En Cloudflare se requiere `DEBRID_ENCRYPTION_KEY`; con la KV `DEBRID_KV` las credenciales son duraderas y, sin ella, el Worker usa su Cache API (por datacenter y expulsable, conviene la KV); RD también necesita client ID/secret y callback OAuth. Node local guarda en memoria efímera; Vercel no tiene almacenamiento persistente configurado y no permite conectar cuentas en producción. Las pruebas mock no sustituyen una verificación en vivo con cuentas de proveedor.
- **Nyaa, YTS y EZTV** son fuentes especializadas: solo se consultan cuando aplican.
  - **YTS** (solo películas) se busca por IMDb id, así que el resultado es exacto. API: [yts.gg/api](https://yts.gg/api).
  - **Nyaa** (anime y producciones asiáticas: idioma original japonés, coreano, chino o tailandés, o título de origen desconocido) se consulta a través de una API comunitaria no oficial de nyaa.si ([nyaaapi.onrender.com](https://nyaaapi.onrender.com/docs)). Se busca con el título en inglés, el original y los romanizados (romaji) de TMDB — sin clave de TMDB no hay romaji y se pierden los lanzamientos que solo llevan ese nombre. El filtro entiende la numeración de fansub (`Título - 05`, `Título S2 - 05`, `Título 2nd Season - 05`) y los lotes por temporada.
  - Nyaa **no** cubre: numeración absoluta (`One Piece - 1100`), temporadas que se publican con subtítulo propio en vez de número, ni especiales (temporada 0). La API devuelve como mucho los 75 resultados con más seeders por búsqueda.
  - En un lote de temporada en los proveedores que no devuelven `fileIdx`, el addon deja que el cliente deduzca el archivo a partir de la temporada y el episodio. Un cliente que no lo haga podría abrir el archivo más grande del torrent. Torrentio ES/Latino sí devuelve y conserva `fileIdx` cuando está disponible.
  - **EZTV** (solo series) se consulta por IMDb id. API: [eztv1.xyz/api](https://eztv1.xyz/api/). Solo sabe listar todos los torrents de una serie, del más reciente al más antiguo y de 100 en 100, así que el episodio se busca en esa lista: una petición si es reciente y hasta 4 (los 400 torrents más nuevos) si no. En series muy largas (Los Simpson pasa de 2.400 torrents) los episodios antiguos quedan fuera. Temporada, episodio y título se leen del nombre del lanzamiento, porque la API deja a menudo `season`/`episode` a 0 y a veces asigna a una serie torrents de otra de nombre parecido.
  - Si alguna de las APIs cambia de dominio: `NYAA_API_URL`, `YTS_API_URL`, `EZTV_API_URL` y `RARBG_API_URL`.
  - **Al actualizar**: si tu despliegue define `STREAM_PROVIDERS`, añade los proveedores nuevos (`nyaa,yts,eztv,rarbg,torrentindexer,torrentioes,espanol`). Las URL personales ya instaladas llevan su lista de proveedores: vuelve a `/configure`, marca los nuevos y reinstala.
- **Torrentio ES/Latino** consulta el endpoint de addon público de Torrentio con `providers=mejortorrent,wolfmax4k,cinecalidad` y `language=spanish,latino` (los tres siguen vivos y devolviendo resultados; se comprueba contra su `manifest.json`). Amplía resultados de **castellano** y **español latino**; manda el IMDb id y recibe magnets/hash, seeders, archivos y `fileIdx`. Se filtran respuestas sin marca de audio español/latino y los episodios se validan (SxxEyy, 1x02 y `Cap. 102`/packs). Es una fuente externa comunitaria que ya mantiene su propio índice; depende de su disponibilidad y límites. Se puede cambiar la base con `TORRENTIO_ES_URL`; desactívala en `/configure` o exclúyela de `STREAM_PROVIDERS` si no quieres depender de ella.
- **Español (ES/LAT)** es la vía para el contenido en castellano y español latino que **no** publican las webs hispanas: los índices generales (Knaben, Torlock y BlackHoleBay) sí lo tienen, pero con el título en español («Duna: Parte Dos», «El Batman»), así que buscar solo en inglés no lo encuentra nunca. Funciona así:
  - Pide a TMDB el título en **español de España** (`language=es-ES`) y, si difiere, el de **México** (`es-MX`); si en español se titula igual que en inglés, no repite la consulta (ya la hacen los proveedores generales). Sin clave de TMDB el proveedor se omite sin contar como fallo.
  - Vuelve a consultar los tres índices con ese título (más el año en películas y `SxxEyy` en episodios) y se queda con lo hispano: releases cuyo nombre lleva el título en español o que declaran audio español (`Castellano`, `Español`, `Latino`, `[ESP]`, `[LAT]`…).
  - El título de México solo se prueba si el de España no dio nada, para no triplicar peticiones; si las tres fuentes fallan, el proveedor falla y se pausa como los demás.
  - Si TMDB sirve la ficha en español pero **sin traducir el título** (pasa con bastantes series), se usa el título original: es como lo nombran los releases hispanos cuando no hay traducción. Con `tmdb:<id>` el id se guarda aunque TMDB no esté configurado.
  - No añade dependencias nuevas: son las mismas APIs públicas ya usadas, así que respeta sus límites y no requiere configuración. Desactívalo en `/configure` o exclúyelo de `STREAM_PROVIDERS` si no te interesa.
- **SpinFlix** ([spinoff.link](https://spinoff.link/pelis/)) sirve **streams directos** (HLS, sin torrent ni debrid) en español latino, desde la API de su fuente LaMovie.
  - Su buscador indexa **solo títulos en español**: `interstellar` devuelve 0 resultados e `interestelar` devuelve la ficha. Por eso se consulta primero con el título de TMDB en `es-ES`/`es-MX` y después con el de la petición; sin ese primer paso el proveedor apenas daba resultados.
  - El `.m3u8` de vimeos.net lleva token de 12 h (no ligado a IP). El CDN sirve las playlists con **200 y sin `Referer`**, pero los segmentos `.ts` son el eslabón débil: si el CDN los cierra o el proxy de su web se cae, la reproducción se queda a medias sin aviso.
  - Por eso el stream se sirve por el **proxy propio del addon**: `GET /hls?u=<url del CDN>&ref=<referer>`. Pone el `Referer` en **cada** petición (no solo en la primera playlist porque reescribe las URI de dentro) y no depende de terceros. El `/streamproxy` de su API devuelve 403 en los segmentos.
  - `/hls` solo acepta HTTPS, hosts de una lista blanca (`vimeos.net`/`vimeos.com` + `HLS_PROXY_HOSTS`) y extensiones de media (`.m3u8`, `.ts`, `.m4s`, `.mp4`, `.vtt`, `.key`): no es un proxy abierto. `SPINFLIX_PROXY_URL` permite volver al proxy de su web o a otro.
  - **Cuota:** cada segmento servido por `/hls` sí ejecuta el Worker (el vídeo no es un static asset). Para no gastar el plan free, deja `SPINFLIX_PROXY_URL` apuntando al proxy de la web y usa el propio solo como rescate.
  - Un fallo puntual con uno de los títulos ya no aborta la búsqueda: se prueba el siguiente. Si **ninguna** consulta responde, el proveedor falla (y se pausa como los demás); si responden vacías, simplemente no tiene la obra.
  - No requiere clave ni cuenta. Desactívalo en `/configure` o exclúyelo de `STREAM_PROVIDERS`.
- **Embed69** ([embed69.org](https://embed69.org)) es la API de embeds que usan PelisPlusHD y Cuevana3: **español latino** (y algo de castellano y subtitulado) de hosts externos como VidHide, Filemoon o StreamWish. No es torrent: son enlaces directos, así que no necesitan debrid.
  - Se consulta por **IMDb**: `GET /f/{imdb}/` en películas y `GET /f/{imdb}-{temporada}x{episodio}/` en series. No acepta búsqueda por texto.
  - Los enlaces vienen **cifrados**. La página trae un PoW (`POW_CHALLENGE`/`POW_DIFFICULTY`/`POW_SALT`): hay que encontrar un `i` tal que `sha256(challenge + i)` empiece por *dificultad* ceros, y la clave AES-CBC es `sha256(challenge + i + salt)`. Un formato alterno es base64 de un JSON con la URL.
  - **Aviso de CPU:** el PoW es cálculo puro. Con dificultad 5 son ~126.000 hashes (~9 s en un núcleo): no cabe en los 10 ms de CPU del plan Free. Por eso:
    - El resultado se cachea por *challenge* (dura minutos): el coste se paga una vez por isolate, no por petición.
    - `npm run embed69:pow` lo resuelve y lo imprime; `--kv` lo sube a la KV como `EMBED69_POW` (`challenge|difficulty|salt|hex`), con lo que el Worker no calcula nada. Lo ideal es un cron cada ~10 min.
    - `EMBED69_POW=off` desactiva el proveedor sin tocar el resto. `EMBED69_URL` cambia el dominio.
  - Los enlaces caducan: se cachean 30 min y el PoW resuelto 45.
- **VideoAPI** ([videoapi.la](https://videoapi.la)) es una API **pública y documentada** de embeds en español (latino, castellano y subtitulado) identificados por **TMDB**: declara 89.155 películas, 19.012 series, 3.240 animes y 464.692 episodios. Como Embed69, entrega enlaces directos: no necesita debrid.
  - **Sin PoW y sin clave**, que es lo que la hace interesante: dos `GET` y nada más. Embed69 con dificultad 5 son ~9 s de SHA-256; esto son ~20 ms de CPU en total, así que cabe en el plan Free sin precalentar nada.
  - Flujo: `GET /api/v1/public/exists/movie/{tmdb}` (o `/exists/series/{tmdb}/{t}/{e}`) devuelve `{exists, path}`; si `exists` es `false` **no se pide nada más** (un solo `GET`, y ese negativo se cachea 24 h). Si es `true`, se pide `{path}` y se saca el `<iframe>` del reproductor, que apunta a `lamovie.link` o `vimeos.net` — los mismos hosts que ya usa SpinFlix.
  - Solo identifica por **TMDB** (`imdb_supported: false`), y el addon recibe IMDb: se usa el `tmdbId` que `resolveTitle` ya resuelve con TMDB (o el que venga en `tmdb:<id>`). Si TMDB no responde y solo hay IMDb, el proveedor **se salta** en vez de fallar.
  - El reproductor valida `Origin`/`Referer` y exige `referrerpolicy="origin"`: por eso el stream se entrega con `proxyHeaders` y el `Referer` de la propia página del embed (no el de vimeos, que es lo que necesitan los HLS de SpinFlix).
  - `VIDEOAPI=off` lo desactiva sin tocar el resto; `VIDEOAPI_URL` cambia el dominio. En `/configure` se puede desmarcar como cualquier otro.
  - **Depende de TMDB** para traducir el IMDb de Stremio a TMDB. Sin `TMDB_API_KEY` (o sin `tmdb:<id>` en la petición) el proveedor no tiene llave con la que preguntar y se salta: es la única pieza de configuración que necesita.
  - Sonda real, sin claves y con código de salida: `npm run videoapi:check`. Habla con VideoAPI por TMDB id (Interstellar 157336, Breaking Bad 1396) y verifica el contrato completo (`exists` → `path` → iframe de vimeos.net). Es el paso estricto de la CI: si la fuente cambia, el run se pone rojo.
- **Fanpelis** ([fanpelis.to](https://fanpelis.to)) es una web hispana con **API JSON pública**: no hay que scrapear HTML ni resolver ningún PoW. Es la fuente que menos cuesta de todas las hispanas evaluadas (tres `GET` y ~10 ms de CPU).
  - `GET /api/rest/search?query=…&post_type=movies|tvshows,animes` → fichas con `_id`, título traducido, original y año; `GET /api/rest/episodes?post_id={serie}` → episodios por temporada; `GET /api/rest/player?post_id={obra|episodio}&_any=1` → `embeds[]` ya resueltos (`url`, `lang`, `quality`).
  - El embed es de **vimeos.net**, el mismo host que ya reproduce SpinFlix, y su HTML viene empaquetado con el `eval(function(p,a,c,k,e,d)…)` de Dean Edwards: de ahí sale el `.m3u8` (y las pistas `.vtt`) **sin ejecutar nada**, reutilizando el desempaquetador de `lib/spinflix.js`. El stream se sirve por el **proxy HLS propio** (`/hls?u=…`), que pone el `Referer` en cada segmento.
  - **La API solo indexa el título traducido**: «The Matrix» devuelve 0 fichas y «Matrix» devuelve 3. Por eso, además del título de la petición, se prueba siempre **sin el artículo inicial** (`the/el/la/los/las`). Con TMDB configurado, el título en español se usa primero.
  - Lo que la web lista como `downloads[]` (Mega, Mediafire, 1fichier, magnet) **se ignora a propósito**: no se reproduce desde un Worker.
  - `FANPELIS=off` lo desactiva sin tocar el resto; `FANPELIS_URL` cambia el dominio. En `/configure` se puede desmarcar como cualquier otro.
  - Sonda real: `npm run fanpelis:check -- --query matrix --deep` (búsqueda → reproductor → embed → `.m3u8`).
- **FrenchStream (FR, experimental)**: películas con título y año exactos; busca Vidzy y solo devuelve HLS extraído. Hasta tres solicitudes; puede fallar por verificación o bloqueos. Sin validación de reproducción. `FRENCHSTREAM=off` lo desactiva.

- **DeVideoSRC (DE, experimental)**: shell y resolver por IMDb, solo fuentes marcadas HLS o MP4; puede devolver cero resultados. Sin verificación de reproducción en el Worker. `DEVIDEOSRC=off` lo desactiva.

- **VixSrc (IT/EN)**: extractor usado por StreamingCommunity, por ID TMDB, con dos GET habituales y hasta cuatro ante un 410. Devuelve HLS con Referer; la disponibilidad de audio depende del título. Sin WebView ni PoW. `npm run vixsrc:check` comprueba API, embed y master HLS; estado y límites en [evaluación multiidioma](docs/proveedores-multiidioma-2026-11-17.md). La reproducción final aún requiere validación en Stremio.

- **PlayLatinSRC** ([playlatinsrc.co](https://playlatinsrc.co)) es una API de streaming en español que identifica por **ID de IMDb** y sirve las tres versiones (Latino, Castellano y Subtitulado) desde el mismo embed. Declara 21.615 películas, 290 series y 11.568 episodios.
  - Es la única fuente hispana del addon que funciona **solo con IMDb**: VideoAPI exige TMDB y Fanpelis busca por texto, así que cuando TMDB no responde o el título no está en su catálogo, este proveedor sigue teniendo con qué preguntar. No hay PoW ni clave.
  - Verificado en la CI: `tt0110357` → 4 streams (Latino y Castellano, 9 `sources` en el resolve) en ~900 ms y `tt0108778` S1E1 → 2 streams, con el buscador del addon devolviendo 4 hits.
  - Flujo: `GET /custom/movie/{imdb}` (películas) o `GET /custom/serial/{imdb}/{temporada}/{episodio}` (series) devuelve una cáscara con `data-id` y `data-resolve-token`; después `POST /api/resolve` con `{type, id, season, episode, mode, token}` en el **cuerpo** devuelve `sources[]` (`url`, `version`, `kind`). Los `kind` `mp4`/`hls` se reproducen directos; los `embed` se entregan con `proxyHeaders` porque Dropload, Doodstream y Mixdrop validan `Referer`.
  - El token caduca con la sesión del reproductor: viaja de la página al resolve dentro de la misma invocación, no se guarda y no se reenvía a ningún tercero. Si la página no trae token (título fuera de catálogo o captcha), el proveedor devuelve 0 streams sin marcarse como caído.
  - Las fuentes se cachean 30 min por ruta, y se recortan a 4 por título para no inundar la lista de streams: el mismo enlace en tres idiomas ya son tres entradas.
  - `PLAYLATIN=off` lo desactiva sin tocar el resto; `PLAYLATIN_URL` cambia el dominio. En `/configure` se puede desmarcar como cualquier otro.
  - Sonda real, con el código de producción y código de salida: `npm run playlatin:check -- --imdb tt0110357 --series tt0108778 --season 1 --episode 1 --stream`. Es el paso estricto de la CI: si el sitio cambia el contrato del embed o del resolve, el run se pone rojo.
- **Índice BR** ([torrent-indexer](https://github.com/felipemarinho97/torrent-indexer), de felipemarinho97) agrega los sitios brasileños **Comando Torrents, BluDV, Torrent dos Filmes, Starck Filmes, Rede Torrent y Vaca Torrent** en una sola API JSON. Es la vía para el contenido en portugués: lanzamientos `Dublado`, `Dual Áudio` o `Nacional` que los índices generales no tienen, con el nombre del release en portugués. Se consulta de dos formas en paralelo:
  - **Por IMDb id** (películas; también series cuando el sitio enlaza el id). El índice guarda el enlace de IMDb dentro de cada ficha, así que la búsqueda es exacta aunque el título esté traducido («Vingadores: Ultimato»). Como la similitud de una consulta por id se puntúa 0, se pide con `filter_results=false` y el IMDb id declarado en cada resultado decide qué vale.
  - **Por el título en portugués de TMDB** (`language=pt-BR`, sin clave no hay este paso). En series se busca el título solo (los sitios publican el lote de la temporada) y la relevancia normal descarta las demás temporadas; en películas, título + año.
  - El `magnet_link` del índice a veces viene en base32: el addon monta el magnet con el `info_hash` (siempre en hex) y los trackers que publica cada resultado.
  - No requiere clave ni registro. La instancia pública (`TORRENT_INDEXER_URL`, por defecto `https://torrent-indexer.darklyn.org`) es la del autor y puede no estar siempre arriba; el proyecto es Go + Redis + Meilisearch y se despliega con Docker, así que lo recomendable es usar una propia. `TORRENT_INDEXER_PATH` elige el endpoint: `/search` (Meilisearch, por defecto) o `/indexers/comando_torrents` (sin Meilisearch, solo ese sitio).
- **The RarBg** es un índice general con ficha por título. API: [rarbg.ninjaproxy1.com/developers](https://rarbg.ninjaproxy1.com/developers/). Las películas se piden por IMDb id (resultado exacto, también con el nombre traducido). Los episodios se buscan por texto, porque su filtro de temporada/episodio deja fuera casi todos los capítulos sueltos; el IMDb id de cada resultado descarta los de otra serie. Sin clave admite **30 peticiones por minuto y 10.000 al día por IP**; con la clave gratuita de una cuenta (`RARBG_API_KEY`, secret) son 60 por minuto y 50.000 al día. Si responde HTTP 429 se deja de consultar lo que indique `Retry-After` (máximo `STREAM_PROVIDER_COOLDOWN_SECONDS`).
- **¿No aparecen streams?** 1) Comprueba primero que tu manifest personal responde 200: abre `https://tu-dominio/<tu-config>/manifest.json`. Si devuelve `404 invalid_config`, la URL de config está mal formada (el segmento base64url se valida hasta `MAX_CONFIG_SEGMENT` = 4096 caracteres; una config completa ronda los 600, un tope menor la rompía). Vuelve a `/configure` y reinstala. 2) Redepliega esta versión y **reinstala el addon en Stremio** — el manifest anterior no declaraba el recurso `stream` y Stremio nunca pide streams a un addon sin él. 3) Abre `/internal/streams-test.json?id=tt1160419` en tu despliegue (para un episodio: `?type=series&id=tt22248376:1:5`): indica la etapa que falla (título no resuelto, proveedor caído/bloqueado — Torlock bloquea algunas IPs de datacenter y ofrece whitelisting — o 0 resultados relevantes).

## 🧲 Filtros de streams

Cada usuario los elige en `/configure` y viajan en su URL personal (`hide`, `sort` y `maxSize`). Sin filtros la respuesta es exactamente la de siempre, y las URL instaladas antes de esta versión siguen funcionando igual.

| Grupo | Categorías |
| :--- | :--- |
| Tipo de copia | WEB-DL · WEBRip, BluRay, REMUX, HDTV · DVD · otras, Screener, CAM · TS |
| Resolución | 4K · 2160p, 1080p, 720p, SD, sin indicar |
| Imagen y códec | 3D, HDR, Dolby Vision, HEVC · x265, AV1, Sin doblaje |

- **Cómo se clasifica**: por el **nombre del torrent** (`lib/streamFilters.js`). Cada resultado recibe un tipo de copia y una resolución, más las etiquetas de imagen que apliquen, y se oculta si **cualquiera** de sus etiquetas está desmarcada. Una copia mal etiquetada por quien la subió puede colarse o quedar oculta por error.
- **El título no cuenta**: «Saw 3D», «Cam» o «Charlotte's Web» no se etiquetan a sí mismas; una marca solo vale si aparece en el nombre más veces que en el título de la obra. `TS`/`TC`/`CAM` sueltos solo cuentan si el nombre no declara otra fuente (BluRay, WEB, HDTV…).
- **Orden**: más seeders (por defecto), mejor calidad (de 4K a SD, con CAM y screeners al final) o menor tamaño.
- **Tamaño máximo**: se compara con el tamaño del torrent entero, así que un pack de temporada pesa mucho más que un episodio suelto. Los resultados sin tamaño conocido se conservan.
- **«Recomendado»** oculta CAM · TS, screeners y 3D.
- **Sin doblaje**: oculta lo que el nombre declara doblado al español o al portugués (`Dublado`, `Dual Áudio`, `Doblado`, `Nacional`, `Dual`). Útil con los lanzamientos brasileños del Índice BR si prefieres VOSE.
- **Caché**: la búsqueda se guarda sin filtrar (hasta 100 resultados por título) y los filtros se aplican en cada petición, de modo que dos usuarios con filtros distintos comparten la misma búsqueda. `STREAM_MAX_RESULTS` se aplica **después** de filtrar.
- **Si todo queda oculto** el addon responde una lista vacía: vuelve a marcar alguna categoría. Un estreno reciente puede existir solo en CAM.
- **Diagnóstico**: `/internal/streams-test.json?id=tt…` incluye `categories` con el número de resultados de cada categoría para ese título.

## 📈 Escalar en el plan gratuito (100K → aguanta el doble sin pagar)

El plan free de Workers da **100.000 invocaciones/día por cuenta**: no es un número que se pueda
subir por código (al agotarlo Cloudflare devuelve `error 1027` y no ejecuta el Worker). Lo que sí se
puede hacer es **bajar cuántas peticiones ejecutan el Worker**. Un addon con 178.000 peticiones/día
cabe de sobra si la mayoría llegan como *static assets*, que son gratis e ilimitados:

1. **Catálogos y fichas por defecto como estáticos** — `npm run prerender` escribe
   `public/catalog/<tipo>/<id>.json` **y sus páginas 2 y 3** (`page-2.json`, `page-3.json`, que es
   como pagina Stremio) y `public/meta/<tipo>/<tt…>.json`.
2. **Plan por configuración (`npm run prerender --from-url`)** — los usuarios instalan
   `/<cfg>/manifest.json` y esos catálogos NO eran estáticos. El Worker anota qué configuraciones ve
   (`/internal/cache.json` → `configs`), el script reparte el tope de **20.000 archivos** de
   Cloudflare Free (`lib/staticPlan.js`) y escribe el manifest y los catálogos de las más usadas.
   El segmento `<cfg>` es **canónico**, así que dos usuarios con la misma configuración comparten
   archivo. Ejemplo real: *«el Worker ejecuta ~26.700 de 178.000 peticiones/día (27 % del plan
   free) → aguanta ~666.000 peticiones/día»*.
3. **`_redirects` en el borde** — `/configure/` y `/manifest.json/` ejecutaban el Worker
   **para devolver un 404**: 1 invocación por clic. Ahora son un 301 del borde y cuestan 0. La barra final del manifest se cubre con
   **una sola regla dinámica** (`/:path/manifest.json/`), así que no gasta cupo por usuario.
4. **Configurador pregenerado por región** — el botón «Configurar» de Stremio (`/<cfg>/configure`)
   renderizaba la página entera en el Worker en cada clic. `_redirects` lo manda a
   `/configure/r/<REGION>` (archivo estático, ~500 KB, uno por región usada): **0 invocaciones**,
   con la región y el idioma ya elegidos.
5. **Manifests pequeños** — instala desde `/configure`: 121 catálogos por defecto frente a 12–20 de un
   manifest personal (6–10× menos peticiones por sesión).
6. **Logo y `robots.txt` estáticos** — fuera de la cuota; los crawlers no recorren rutas dinámicas.
7. **Repartir cuota** — la cuota es por cuenta, no por Worker: espejos en otra cuenta o el mismo código
   en Vercel (`api/index.js`) suman cuotas independientes.
8. **5 USD/mes** — 10 M peticiones/mes (≈333K/día) si algún día no quieres trocear URLs.

Todo esto se regenera y despliega solo cada 6 h (`.github/workflows/prerender.yml`). Guía completa
con números, comandos de verificación y límites: [docs/escala-plan-free.md](docs/escala-plan-free.md).

```bash
# Qué configuraciones ha visto tu despliegue y qué conviene pregenerar
curl -s https://tu-dominio/internal/cache.json | head -c 600
PUBLIC_ORIGIN=https://tu-dominio npm run prerender -- --from-url
npm run deploy            # ya incluye --from-url

# Auditoría: cuántas de tus peticiones ejecutan el Worker
npm run scale:audit -- --url https://tu-dominio --requests 178000
```

## 📄 Licencia

MIT

### Límites y errores de proveedores

- OMDB puede responder `Request limit reached!` cuando se agota la cuota. El addon pausa nuevas consultas durante 15 minutos por instancia; esto no amplía la cuota. Revisa el plan o espera su renovación.
- TMDB puede responder HTTP 429: se reduce el paralelismo al resolver IDs y se aplazan consultas por instancia según `Retry-After` (máximo 5 minutos; 30 segundos si no se indica). Las respuestas ya cacheadas siguen disponibles.
- Un 404 de lookup en TVMaze puede indicar que la serie no existe en su base de datos. Las búsquedas negativas se cachean durante una hora.
- Los timeouts de un indexador (`Timeout de 6000 ms al consultar …`) indican que tardó más que `STREAM_PROVIDER_TIMEOUT_MS` (6 s por defecto); los demás se consultan en paralelo y responden igualmente. Tras 3 timeouts seguidos, o un HTTP 429, ese indexador se pausa (`STREAM_PROVIDER_COOLDOWN_SECONDS`, 5 min por defecto) y las respuestas sin él se cachean solo ese rato. Una respuesta incompleta no sustituye la caché buena. Si queda una entrada vieja, se sirve al instante mientras se renueva en segundo plano.
- Los mensajes de error de la aplicación no incluyen parámetros ni cuerpos de respuesta. OMDB y TMDB (con clave v3) aún requieren claves en la URL: configura la plataforma de observabilidad para no guardar parámetros de esas solicitudes. Si una clave apareció en registros, rótala y elimina o restringe el acceso a los registros históricos.
- Cachés y pausas son locales a cada instancia; no coordinan cuotas entre instancias serverless.

### Mejoras de compatibilidad del addon

- **Paginación en Stremio:** Tendencias, Populares, Top Valoradas y Anime (películas y
  series) anuncian `skip` en el manifest. Node/Vercel y Workers aceptan rutas como
  `/catalog/series/tv_anime/skip=20.json`, también con prefijo de configuración personal.
  El servidor traduce el desplazamiento a páginas de TMDB y valida límites.
  Solo se anuncia en esos ocho catálogos para conservar los 121 catálogos dentro del
  límite estricto de 8 KB del SDK. Los demás siguen disponibles como antes.
- **Series sin IMDb:** las tarjetas generan identificadores canónicos `tmdb:tv:…`.
  Se conservan las fichas con identificadores antiguos `tmdb:series:…`.
- **Streams por episodio:** se separan correctamente temporada y episodio de los IDs
  TMDB/TVMaze; antes el número de episodio podía confundirse con el ID de la serie.
  Se conservan los episodios especiales (temporada 0) y se toleran escapes malformados
  sin lanzar errores en el parser.

Para que Stremio detecte los cambios de capacidades, actualiza o reinstala el addon
usando tu URL de configuración habitual. Los resultados siguen dependiendo de las
claves, proveedores y disponibilidad del contenido; estas correcciones no añaden
fuentes ni requieren compartir credenciales.

### Diseño de la portada y de `/configure`

Ambas páginas comparten un único sistema de diseño (`lib/theme.js`): negro profundo, tipografía
del sistema (SF Pro donde existe), barra de navegación de cristal con `backdrop-filter`, botones
de píldora y superficies de vidrio con hairline. El color lo aporta el contenido, no la interfaz;
no se cargan fuentes, CSS ni scripts de terceros (cero peticiones y cero FOUC). Los iconos son SVG
en línea (`lib/icons.js`, Lucide/ISC), nunca emoji: se ven igual en todos los sistemas y heredan el
color del texto. `lib/layout.js` pone las piezas comunes (fondo decorativo, isla de navegación,
tarjetas de soporte y donación, pie).

Idiomas: la página se escribe en castellano y `lib/webI18n.js` la traduce en el navegador con un
diccionario de **frases exactas** (`PHRASES`, seis columnas: es/en/pt/fr/de/it) más unas reglas para
texto compuesto («121 catálogos», «Validar y conectar TorBox», nombres de país e idioma vía
`Intl.DisplayNames`). Esto condiciona el marcado, y es la norma a respetar al tocar el diseño:

- Un texto visible que se escriba con `textContent` desde el script **no se traduce** si su frase no
  está en el diccionario. Por eso los estados de la tarjeta debrid son variantes pre-renderizadas
  (`data-status` + `data-tone`) y el script solo cambia cuál está visible.
- Un `<code>` o un `<a>` dentro de una frase parte el nodo de texto y la deja sin traducir: se
  mantienen fuera de las frases que deban traducirse (el detalle técnico del proveedor va en
  `#debridDetail`, marcado `translate="no"` porque es texto literal del servicio).
- `test/configurePage.test.js` audita la tarjeta debrid y falla si aparece una frase sin entrada.

La tarjeta «06 · Servicios debrid» sigue el mismo lenguaje visual que las fichas de plataformas y
estudios: `.provider-tile` con `radio` en lugar de `<select>` (se conecta un solo servicio, y la
elección se ve de un vistazo), campo de clave con botón «Mostrar/Ocultar» (la mayoría de rechazos
son un espacio o un carácter de más al pegar), una línea de ayuda **solo del servicio elegido** con
dónde está su clave, y un estado con color por gravedad —neutro, buscando, correcto, aviso de plan
sin suscribir y error— en lugar de un párrafo gris que decía lo mismo cuando funcionaba y cuando
fallaba. El `maxlength` del campo coincide con el límite real de validación (256).

### ¿Alguna fuente en español «no da»? Sonda rápida

```bash
npm run providers:check                              # Interstellar y compañía
npm run providers:check -- --series=tt0903747        # una serie (Breaking Bad)
npm run providers:check -- --query=interestelar      # sin clave de TMDB
```

Comprueba contra los servicios reales las fuentes hispanas (**Torrentio ES/Latino**, **Español (ES/LAT)**, **SpinFlix**, **VideoAPI**, **Fanpelis** y **PlayLatinSRC**) y dice si el problema es de la fuente (caída, dominio cambiado) o del addon (filtro, URL mal formada). Recuerda: ninguna busca por el título en inglés, y las dos últimas van por id (TMDB e IMDb respectivamente).

### Fuentes e idioma de audio

En `/configure`, la sección de proveedores permite elegir **streaming directo**, **torrents** o ambos; después, uno o varios idiomas de audio y los proveedores visibles compatibles. Las selecciones se guardan en la URL personal. Las instalaciones antiguas sin estos campos mantienen todos los tipos e idiomas activos.

La lista de idiomas de cada proveedor es orientativa. El filtro de audio utiliza únicamente etiquetas disponibles: un resultado sin audio identificado se clasifica como **Desconocido**; los subtítulos por sí solos no garantizan el idioma del audio. Elegir idiomas y quitar Desconocido puede ocultar fuentes válidas sin etiquetar. Debrid sigue aplicado a torrents seleccionados. Si no se selecciona tipo o idioma, no hay streams.

### Enlaces directos y publicidad

El endpoint de streams descarta páginas embed (HTML) que los proveedores presentan como vídeo y solo deja pasar URLs reconocibles de MP4/HLS/WebM, el proxy HLS propio y la playlist de VixSrc. Fanpelis no devuelve el iframe cuando no puede extraer la playlist. Esto puede reducir los resultados de VideoAPI, Embed69 y PlayLatinSRC: resolver sus hosts requiere extractores adicionales; no significa que el título no exista. Los proxies externos con formatos no reconocidos y URLs de vídeo sin extensión pueden quedar excluidos.

El filtro descarta también URLs con algunos indicadores inequívocos de anuncios y evita seleccionar esas URLs primero al extraer HLS. **No verifica que la playlist corresponda a la película ni elimina anuncios insertados dentro de ella**. Hace falta validar los casos reales y sus hosts; no hay garantía de reproducción ni de ausencia de anuncios.

- **AnimeFLV.or.at (experimental)**: solo series de primera temporada, búsqueda por título exacto y episodio del sitio; únicamente la opción HLS de Zilla validada como playlist. Subtítulos en español no implican audio español: aparece con idioma de audio desconocido. Hasta cuatro solicitudes. Sin validación completa de reproducción ni garantía de ausencia de anuncios; temporadas posteriores no se buscan para evitar confundir numeración absoluta. `ANIMEFLV=off` lo desactiva.
