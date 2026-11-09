# 🎬 Catálogos+ — Addon de Stremio

Addon **100% gratuito** para Stremio con catálogos de **películas y series**:

- 🔥 **Tendencias** de la semana (TMDB)
- ⭐ **Top Valoradas** (TMDB, mínimo de votos configurable)
- 🍿 **Populares** (TMDB)
- ⚙️ **Página de configuración** (`/configure`): elige **idioma** (es, es-MX, en, pt-BR…), **región** (NI, MX, US, ES, AR y 12 países más), **plataformas** y **estudios con sus logos** (vía TMDB) → genera tu **manifest personal** `/<config>/manifest.json`
- 📺 **Por plataforma**: Netflix, Prime Video, Disney+, Max (HBO), Apple TV+, Paramount+, Crunchyroll, Hulu, AMC+, MUBI, Tubi, Pluto TV y Peacock — películas y series (TMDB Discover con JustWatch providers, con **fallback automático MX→US** si tu región no tiene resultados)
- 🎥 **Por estudio** (solo películas): Marvel Studios, Pixar, A24, DreamWorks Animation, Studio Ghibli, Warner Bros., Universal, Paramount Pictures y Sony Pictures (TMDB Discover con `with_companies`)
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
│   ├── cache.js          # Caché en memoria con TTL
│   ├── http.js           # fetch JSON con timeout
│   ├── tmdb.js           # Cliente TMDB (+ resolución IMDb ids)
│   ├── tvmaze.js         # Cliente TVMaze (web schedule, lookup por IMDb)
│   ├── tvdb.js           # Cliente TheTVDB v4 (login JWT; fichas por IMDb id)
│   ├── omdb.js           # Cliente OMDB (ratings)
│   ├── watchmode.js      # Cliente Watchmode (plataformas)
│   ├── catalogs.js       # Definición de catálogos (+ filtrado por config)
│   ├── userConfig.js     # Codec/validación de config de usuario (base64url)
│   ├── branding.js       # Logos de plataformas/estudios vía TMDB
│   ├── configurePage.js  # Página /configure (elegir idioma/región/plataformas/estudios)
│   ├── meta.js           # Constructor de metadatos multi-fuente
│   ├── logoData.js       # Logo PNG embebido (base64) para el Worker
│   └── landingPage.js    # Landing visual
├── assets/logo.png       # Logo del addon
├── test/                 # Tests offline (smoke + worker)
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
| `WATCH_REGION` | Opcional | Región JustWatch por defecto: `NI` (defecto), `MX`, `ES`, `US`, `AR`... El usuario puede cambiarla en /configure |
| `TMDB_LANGUAGE` | Opcional | Idioma por defecto de fichas/catálogos: `es` (defecto), `es-MX`, `en`, `pt-BR`... |
| `ADDON_NAME` / `ADDON_BASE_URL` | Opcional | Nombre y URL pública (logo en el manifest) |
| `TMDB_MIN_VOTE_COUNT` | Opcional | Mínimo de votos para "Top Valoradas" (defecto `500`) |
| `CACHE_TTL_SECONDS` | Opcional | TTL de caché (defecto `21600` = 6h) |
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

También puedes añadirlas en el dashboard: **Cloudflare → Workers & Pages → catalogos-plus → Settings → Variables and Secrets**.

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

1. Abre `https://tu-dominio/configure` y elige **idioma · región · plataformas · estudios** (con sus logos).
2. Pulsa **🚀 Instalar en Stremio** — se instala tu manifest personal (`https://tu-dominio/<config>/manifest.json`).
3. O sin configurar: **⚡ Instalación rápida** desde la landing (todo activado).

> **Consejo de región:** la cobertura JustWatch en Nicaragua es limitada; si ves pocos catálogos de plataformas, prueba **MX** o **US** en /configure — tendrán mucho más contenido.

## ▲ Alternativa: Vercel (serverless Node)

El servidor Express (`api/index.js`) también despliega en Vercel tal cual:

1. Sube el repo a GitHub → **vercel.com → Add New → Project** → importa el repo.
2. Añade `TMDB_API_KEY` (y opcionales) en **Environment Variables**.
3. Deploy → manifest en `https://tu-proyecto.vercel.app/manifest.json`.

## 🧰 4. Añadir/quitar plataformas o estudios

Edita `lib/catalogs.js`:

- `PLATFORMS`: añade `{ key, name, providers }` — el `providers` es el **JustWatch provider id** de TMDB (puedes combinar varios con `|`, p. ej. `'1899|384'` para Max). [Lista completa de proveedores TMDB](https://www.themoviedb.org/talk/5-themoviedb-api-v3?page=1) o `/watch/providers/movie` en su API.
- `STUDIOS`: añade `{ key, name, company }` con el **company id** de TMDB (búscalo en `/search/company`).

Cada entrada genera automáticamente su catálogo en el manifest (`cine_<key>` / `tv_<key>`).

## 🔌 Endpoints

| Ruta | Descripción |
| :--- | :--- |
| `GET /configure` | Página de configuración (idioma, región, plataformas, estudios, logos) |
| `GET /<config>/manifest.json` | Manifest personal según la config elegida |
| `GET /internal/branding.json` | Logos de plataformas/estudios (vía TMDB) para /configure |
| `GET /manifest.json` | Manifest por defecto (todo activado) |
| `GET /catalog/:type/:id.json` | Catálogos (`movie`/`series`) |
| `GET /<config>/catalog/:type/:id.json` | Catálogos con tu config |
| `GET /meta/:type/:id.json` | Ficha enriquecida (`tt…`, `tmdb:movie:123`, `tvmaze:123`, `tvdb:series:123`) |
| `GET /healthz` | Estado del addon y de las fuentes configuradas |
| `GET /assets/logo.png` | Logo del addon |
| `GET /` | Landing con instalador de 1 clic |

## 📝 Notas

- **Caché**: catálogos 6h por defecto; ids externos 7 días; OMDB 24h; Watchmode 12h. En serverless cada instancia tiene su propia caché.
- **Degradación elegante**: si falta una clave, esa fuente se omite sin romper el resto.
- **TheTVDB (v4)**: se autentica con `POST /login` → JWT cacheado ~24 días. Alimenta las fichas de series/películas por IMDb id (respaldo cuando TMDB/TVMaze no responden) con nombre/argumento en español si existe la traducción. IDs explícitos soportados: `tvdb:series:123`, `tvdb:movie:123`, `tvdb:123`. TVDB no ofrece un chart público de tendencias, por eso no genera catálogos; si quieres un catálogo por género/cadena de TVDB, dímelo y lo montamos con `/v4/filter`.
- **Región**: los catálogos "por plataforma" usan `watch_region` = `WATCH_REGION` (por defecto `NI`). Cambia a `MX`/`ES`/`US` según tu país.

## 📄 Licencia

MIT
