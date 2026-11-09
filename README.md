# 🎬 Catálogos+ — Addon de Stremio

Addon **100% gratuito** para Stremio con catálogos de **películas y series**:

- 🔥 **Tendencias** de la semana (TMDB)
- ⭐ **Top Valoradas** (TMDB, mínimo de votos configurable)
- 🍿 **Populares** (TMDB)
- 📺 **Por plataforma**: Netflix, Prime Video, Disney+, Max (HBO), Apple TV+, Paramount+, Star+ y Crunchyroll — películas y series (TMDB Discover con JustWatch providers)
- 🎥 **Por estudio** (solo películas): Marvel Studios, Pixar, A24, DreamWorks Animation, Studio Ghibli, Warner Bros., Universal, Paramount Pictures y Sony Pictures (TMDB Discover con `with_companies`)
- 📡 **Series · En TV hoy** (TVMaze, **gratis y sin clave**)

Metadatos enriquecidos en la ficha:

- 🎞️ Ficha principal, póster, fondo, géneros, reparto y dirección → **TMDB**
- ⭐ Valoraciones **IMDb · Rotten Tomatoes · Metacritic** → **OMDB**
- 📺 **Dónde ver en streaming** ("Disponible en NI: Netflix · Prime Video") → **Watchmode**
- 📡 Argumento, géneros y canales → **TVMaze** (funciona siempre)

## 📁 Estructura

```text
├── addon.js              # Manifest + handlers catalog/meta
├── api/index.js          # Express + SDK router + landing + /healthz
├── server.js             # Arranque local (npm start)
├── lib/
│   ├── config.js         # Variables de entorno
│   ├── cache.js          # Caché en memoria con TTL
│   ├── http.js           # fetch JSON con timeout
│   ├── tmdb.js           # Cliente TMDB (+ resolución IMDb ids)
│   ├── tvmaze.js         # Cliente TVMaze (web schedule, lookup por IMDb)
│   ├── omdb.js           # Cliente OMDB (ratings)
│   ├── watchmode.js      # Cliente Watchmode (plataformas)
│   ├── catalogs.js       # Definición de TODOS los catálogos
│   ├── meta.js           # Constructor de metadatos multi-fuente
│   └── landingPage.js    # Landing visual
├── assets/logo.png       # Logo del addon
├── test/smoke.test.js    # Tests offline (sin claves ni red)
├── vercel.json           # Despliegue serverless en Vercel
└── .env.example          # Plantilla de variables
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
| `WATCH_REGION` | Opcional | Región JustWatch: `NI` (defecto), `MX`, `ES`, `US`, `AR`... |
| `ADDON_NAME` / `ADDON_BASE_URL` | Opcional | Nombre y URL pública (logo en el manifest) |
| `TMDB_MIN_VOTE_COUNT` | Opcional | Mínimo de votos para "Top Valoradas" (defecto `500`) |
| `CACHE_TTL_SECONDS` | Opcional | TTL de caché (defecto `21600` = 6h) |
| `PORT` | Opcional | Puerto local (defecto `7000`) |

> **TVMaze no requiere clave.** Sin TMDB el addon arranca igualmente, pero los catálogos de películas/series TMDB aparecerán vacíos; el catálogo "Series · En TV hoy" siempre funciona.

## ▶️ 2. Ejecutar

```bash
npm start          # http://localhost:7000
npm test           # tests offline
```

- Landing: `http://localhost:7000/` (botón "Instalar en Stremio")
- Manifest: `http://localhost:7000/manifest.json`
- Health: `http://localhost:7000/healthz`
- Ejemplo catálogo: `http://localhost:7000/catalog/movie/cine_netflix.json`

Instalación en la app: **Add-ons → pegar la URL del manifest → Instalar**.

## 🚀 3. Desplegar en Vercel (gratis)

1. Sube el repo a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo.
3. En **Environment Variables** añade al menos `TMDB_API_KEY` (y las opcionales que uses). `ADDON_BASE_URL=https://tu-proyecto.vercel.app` mejora el logo del manifest.
4. **Deploy**. Tu manifest público quedará en `https://tu-proyecto.vercel.app/manifest.json`.

### Instalación con un clic

Visita `https://tu-proyecto.vercel.app/` y pulsa **🚀 Instalar en Stremio**.

## 🧰 4. Añadir/quitar plataformas o estudios

Edita `lib/catalogs.js`:

- `PLATFORMS`: añade `{ key, name, providers }` — el `providers` es el **JustWatch provider id** de TMDB (puedes combinar varios con `|`, p. ej. `'1899|384'` para Max). [Lista completa de proveedores TMDB](https://www.themoviedb.org/talk/5-themoviedb-api-v3?page=1) o `/watch/providers/movie` en su API.
- `STUDIOS`: añade `{ key, name, company }` con el **company id** de TMDB (búscalo en `/search/company`).

Cada entrada genera automáticamente su catálogo en el manifest (`cine_<key>` / `tv_<key>`).

## 🔌 Endpoints

| Ruta | Descripción |
| :--- | :--- |
| `GET /manifest.json` | Manifest (logo resuelto contra el host actual) |
| `GET /catalog/:type/:id.json` | Catálogos (`movie`/`series`) |
| `GET /meta/:type/:id.json` | Ficha enriquecida (`tt…`, `tmdb:movie:123`, `tvmaze:123`) |
| `GET /healthz` | Estado del addon y de las fuentes configuradas |
| `GET /` | Landing con instalador de 1 clic |

## 📝 Notas

- **Caché**: catálogos 6h por defecto; ids externos 7 días; OMDB 24h; Watchmode 12h. En serverless cada instancia tiene su propia caché.
- **Degradación elegante**: si falta una clave, esa fuente se omite sin romper el resto.
- **Región**: los catálogos "por plataforma" usan `watch_region` = `WATCH_REGION` (por defecto `NI`). Cambia a `MX`/`ES`/`US` según tu país.

## 📄 Licencia

MIT
