# 📈 Arquitectura de Alta Escala: cómo sostener +230.000–350.000+ peticiones/día

Guía técnica y operativa para sostener **+230.000 peticiones/día** (~2,66 req/s sostenidos, picos de **15–35 req/s** en prime time y ~7M–10M peticiones/mes) sin caídas (`Error 1027`, `Error 1102` de CPU, límite de 50 subpeticiones ni bloqueo 429 en proveedores externos).

---

## 1. Radiografía real de cuellos de botella a 230K req/día

En un addon de Stremio + reproductor web (`/watch`), el tráfico típico se reparte así:

| Ruta / Tráfico | Peso típico | Volumen a 230K/día | Riesgo sin optimización | Cómo lo resuelve `Catálogos+` |
| --- | --- | --- | --- | --- |
| Catálogos (`/catalog/*` y `/<cfg>/catalog/*`) | ~62 % | ~142.600/día | Agota las 100K invocaciones/día de Workers Free y dispara >30 subrequests TMDB por catálogo | **Static Assets (0 invocaciones)** para el manifest general + **Edge Cache canónica** compartida entre usuarios con distinto `<cfg>` + caché de página en RAM |
| Web (`/`, `/configure`, `/watch/*`, `/manifest.json`, logos) | ~13 % | ~29.900/día | Cada apertura de `/configure` y `/watch` lanzaba 2–6 llamadas extra sin caché | **HTML/JSON pregenerados en `public/` (0 invocaciones)** + 21/21 estudios con logo estático + coalescencia cliente + `s-maxage` en `/internal/watch/*` |
| Fichas (`/meta/*` y `/<cfg>/meta/*`) | ~15 % | ~34.500/día | Re-consulta TMDB + OMDB (1.000/día free) + Watchmode (1.000/mes free) por usuario | **Edge Cache canónica (`lang + region`)** + caché `meta:v1:*` coalescida en RAM + circuit-breaker 429/402 en OMDB/Watchmode |
| Streams públicos (`/stream/*` sin debrid) | ~7 % | ~16.100/día | 10 indexadores en paralelo (Español ES/LAT añade hasta 3 consultas con el título en español), timeouts y CPU | **Edge Cache canónica por filtros/proveedores** + pool SWR (`stale-while-revalidate` 6 h) + cooldown automático por proveedor |
| Streams privados Debrid (`/<cfg>/stream/*` con `debridId`) | ~3 % | ~6.900/día | Cloudflare KV Free solo permite **1.000 lecturas/día** (a las 1.001 falla debrid) | **Caché cifrada/descifrada en memoria del isolate + `cacheTtl: 300` en KV** (reduce lecturas KV >95 %) y `Cache-Control: no-store` estricto |

### Límites críticos de Cloudflare Workers Free y cómo queda el presupuesto

| Límite Cloudflare Free | Tope oficial | Presupuesto real con esta arquitectura a **230.000 req/día** |
| --- | --- | --- |
| Invocaciones del Worker | **100.000 / día** | **~22.000 – 48.000 / día** (con `prerender` + `build:web` + CDN Cache Rules en dominio propio; >75 % se sirve desde Static Assets y CDN Edge sin ejecutar el Worker) |
| CPU por invocación | **10 ms** | **< 2,5 ms** en hits de caché/catálogos (`config.reload` por huella, `decodeConfig` memoizado, `prune` amortizado O(1)) y **4–7 ms** en `/stream` |
| Subpeticiones (`fetch`) por invocación | **50 máx.** | **≤ 25** en catálogos fríos (tope de 24 `/external_ids` + 1 `/discover`), **≤ 7** en `/internal/branding.json` (concurrencia 5 + caché 24 h), **≤ 12** en `/stream` |
| Cloudflare KV `get` (`DEBRID_KV`) | **1.000 lecturas / día** (Free) | **~150 – 400 lecturas / día** incluso con miles de reproducciones debrid, gracias a la caché en RAM de 5 min + `cacheTtl: 300` en el PoP de KV |
| Memoria por isolate | **128 MB** | **~25 – 40 MB** con `MAX_ENTRIES = 8000` (cubre las 3.630 claves `tmdb:ext:*` de los 121 catálogos + páginas + pools de streams sin thrashing LRU) |

---

## 2. Las 6 capas de defensa implementadas en el código

### Capa 1 · Zero-Worker Static Offloading (`public/` + GitHub Actions cada 6 h)
En `wrangler.toml`, `[assets] directory = "./public"` con `run_worker_first = false` hace que Cloudflare sirva cualquier archivo estático **antes de facturar o contar una invocación del Worker** (tráfico gratuito e ilimitado):
- `scripts/prerender-catalogs.mjs` genera los 121 JSON en `public/catalog/<type>/<id>.json`.
- `scripts/build-web.mjs` (cuando defines `PUBLIC_ORIGIN` o `ADDON_BASE_URL`) pregenera:
  - `public/index.html` (portada con tendencias horneadas)
  - `public/configure/index.html` (configurador completo)
  - `public/manifest.json` (manifest general)
  - `public/internal/branding.json` (logos oficiales)
- `.github/workflows/prerender.yml` ejecuta ambos scripts cada 6 horas y despliega automáticamente los estáticos frescos sin intervención manual.

### Capa 2 · Canonicalización de Edge Cache (`worker.mjs`)
Antes, `caches.default` indexaba por `request.url` literal. Dos usuarios con distinto `/<cfg>/` (por ejemplo, distinto `debridId`, distintos estudios o distintos filtros de streams) **jamás compartían caché** aunque pidieran exactamente el mismo catálogo o la misma ficha.

Ahora `worker.mjs` proyecta claves canónicas internas sobre `caches.default`:
- **Catálogos** (`/<cfg>/catalog/:type/:id.json`) → clave canónica por `(type, id, lang, region, skip)`. Un usuario con TorBox en México y otro con Real-Debrid en México comparten el **mismo hit en el PoP**.
- **Metadatos** (`/<cfg>/meta/:type/:id.json`) → clave canónica por `(type, id, lang, region)`.
- **Streams públicos sin debrid** (`/<cfg>/stream/:type/:id.json`) → clave canónica por `(type, id, activeProviders, hide, badges, sort, maxSize)`.
- **Privacidad blindada**: si `cfg.debridId` existe, `/<cfg>/manifest.json` y `/<cfg>/stream/*` **nunca** pasan por `edgeCached` y siempre devuelven `Cache-Control: no-store`.

### Capa 3 · Cabeceras CDN `s-maxage` + `stale-while-revalidate` + `stale-if-error`
Todas las respuestas públicas del Worker y de Express/Vercel emiten ahora:
```http
Cache-Control: public, max-age=..., s-maxage=..., stale-while-revalidate=86400, stale-if-error=604800
```
Esto incluye `/internal/watch/*` (`catalogs`, `catalog`, `search`, `meta`, `extras`, `episodes`, `streams` públicos), `/internal/branding.json`, `/` y `/configure` (salvo cuando trae parámetros OAuth de Real-Debrid).

### Capa 4 · Single-Flight Coalescing (`cache.coalesce`) extremo a extremo
Si una película entra en tendencia y 80 usuarios piden simultáneamente el mismo catálogo, ficha o stream en frío:
- `lib/catalogs.js`, `lib/meta.js`, `lib/tmdb.js`, `lib/omdb.js`, `lib/watchmode.js`, `lib/tvdb.js`, `lib/branding.js`, `lib/streams.js` y `lib/debridCredentials.js` **coalescen** las promesas en vuelo.
- Las 80 peticiones comparten **1 sola llamada HTTP** al proveedor externo. Las métricas agregadas en `/internal/cache.json` exponen el contador `coalesced`.

### Capa 5 · Presupuesto de Subpeticiones, Cuotas Externas y CPU
- **TMDB (`lib/tmdb.js`)**: caché compacta `tmdb:ext:<type>:<id>` (7 días), caché negativa de 404 (1 h) y tope de **24 `/external_ids` no cacheados por invocación** con pool de concurrencia 6. Garantiza no cruzar jamás el límite de 50 subpeticiones de Cloudflare Workers.
- **KV Debrid (`lib/debridCredentials.js`)**: cachea la credencial descifrada 5 min en el isolate (`debrid:credential:<id>`), coalesciendo lecturas simultáneas y pasando `{ cacheTtl: 300 }` a `DEBRID_KV.get()`, con invalidación inmediata al actualizar o desconectar.
- **CPU (`lib/config.js`, `lib/userConfig.js`, `lib/cache.js`)**: `config.reload(env)` calcula una huella ligera y evita re-parsear variables en cada request; `decodeConfig` guarda hasta 512 configs normalizadas clonadas en memoria; `cache.js` sube a `8.000` entradas con barrido amortizado cada 250 escrituras.
- **Protección anti-abuso (`worker.mjs`, `api/index.js`)**: `/internal/streams-test.json` aplica `rateLimit` por IP (6 req/min) y coalescencia de 30 s.

### Capa 6 · Reducción de Fan-Out en el Navegador (`/configure` y `/watch`)
- **21/21 estudios con logo estático** en `lib/staticLogos.js`: abrir `/configure` ya **no necesita disparar** `fetch('/internal/branding.json')`.
- **Botón «Esenciales (carga rápida)»** en `/configure`: permite instalar con un clic las 8 plataformas y 6 estudios principales (~38 catálogos frente a 121, reduciendo >3× las peticiones por sesión de Stremio).
- **Deduplicación en `/watch/watch.js`**: coalescencia y memoización en cliente para que la carga inicial (`load()` + `loadHomeRails()`) no pida `cine_tendencias` por duplicado ni repita llamadas al cambiar de pestaña.

---

## 3. Regla de Caché en Cloudflare CDN (clave para superar 230K–500K req/día en Plan Free)

> **Importante sobre Cloudflare:** En un subdominio `*.workers.dev`, la petición entra primero al Worker (contando contra las 100.000 invocaciones/día) incluso cuando `caches.default` hace HIT.  
> En cambio, si conectas el Worker a un **dominio propio** en Cloudflare (gratis) y activas **1 Cache Rule**, el CDN de Cloudflare responde desde el borde **antes de despertar al Worker (0 invocaciones consumidas)**, igual que un archivo estático, pero también para rutas `/<cfg>/catalog/*`, `/<cfg>/meta/*` y `/internal/watch/*`.

### Configuración exacta en Cloudflare Dashboard → Caching → Cache Rules

Crea una regla llamada **`Catalogos+ Public Edge Cache`**:

- **When incoming requests match (Expression):**
  ```txt
  (http.request.method eq "GET") and (
    starts_with(http.request.uri.path, "/catalog/") or
    starts_with(http.request.uri.path, "/meta/") or
    starts_with(http.request.uri.path, "/internal/watch/") or
    http.request.uri.path eq "/internal/branding.json" or
    http.request.uri.path eq "/manifest.json" or
    ends_with(http.request.uri.path, "/catalog/movie/") eq false and (
      http.request.uri.path contains "/catalog/" or
      http.request.uri.path contains "/meta/"
    )
  )
  ```
  *(Más simple en el editor visual: `URI Path` contains `/catalog/` OR `URI Path` contains `/meta/` OR `URI Path` starts with `/internal/watch/` OR `URI Path` equals `/manifest.json`)*
- **Then:**
  - **Cache eligibility:** `Eligible for cache`
  - **Edge TTL:** `Use cache-control header if present, bypass cache if not`

**¿Es seguro para Debrid?** **Sí, 100 % seguro**:
1. La regla **no incluye `/stream/`** ni `/<cfg>/manifest.json` personales.
2. Incluso si añadieras una regla general respetando cabeceras (`Use cache-control header if present`), el Worker marca toda respuesta con `debridId` y toda respuesta degradada con `Cache-Control: no-store`, por lo que Cloudflare jamás la almacena.

Con **Static Assets + esta Cache Rule en dominio propio**, de 230.000 peticiones/día solo llegan al Worker los misses de CDN y las búsquedas de `/stream` únicas (~15.000–35.000 invocaciones/día), dejando más del **65 % del plan gratuito libre** y permitiendo escalar hasta **~500.000 peticiones/día sin coste**.

---

## 4. Puesta en marcha paso a paso

### A) Despliegue manual con pregeneración completa
```bash
# 1. Configura tus variables en .env
#    TMDB_API_KEY=...
#    PUBLIC_ORIGIN=https://tu-dominio.com

# 2. Genera los 121 catálogos estáticos + web + manifest + branding y despliega
PUBLIC_ORIGIN=https://tu-dominio.com npm run deploy
```

### B) Refresco automático cada 6 horas en GitHub Actions (ya incluido)
El archivo `.github/workflows/prerender.yml` ya está listo en el repositorio. Solo añade en tu repo de GitHub (**Settings → Secrets and variables → Actions**):

- **Secrets:**
  - `CLOUDFLARE_API_TOKEN` (permiso *Workers Scripts: Edit*)
  - `CLOUDFLARE_ACCOUNT_ID`
  - `TMDB_API_KEY` (o `TMDB_ACCESS_TOKEN`)
- **Variables (o Secrets):**
  - `PUBLIC_ORIGIN` → `https://tu-dominio.com` (o tu URL `https://catalogos-stremio.<subdominio>.workers.dev`)
  - `WATCH_REGION` → `NI` (o tu país principal, p. ej. `MX`, `ES`)

### C) Cuándo pasar a Workers Paid ($5 USD/mes)
Si decides **no** usar dominio propio con Cache Rules, o si tu comunidad supera las **~80.000 búsquedas únicas de `/stream` al día** (>600.000–800.000 peticiones totales/día):
- **Workers Paid ($5/mes)** sube las cuotas a **10.000.000 invocaciones/mes** (~333.000 invocaciones puras de Worker al día, equivalentes a **>1,5 millones de peticiones totales/día** sumando Static Assets + CDN), **30 s de CPU** por invocación y **1.000 subpeticiones** por invocación, además de **10 millones de lecturas KV/mes**.

---

## 5. Verificación rápida en producción

```bash
# 1. Comprobar que catálogos y Watch API devuelven s-maxage y stale-while-revalidate
curl -sI https://TU-DOMINIO/catalog/movie/cine_tendencias.json | grep -iE 'cache-control|cf-cache'
curl -sI https://TU-DOMINIO/internal/watch/catalogs | grep -iE 'cache-control|cf-cache'

# 2. Consultar salud de la caché en memoria y peticiones coalescidas
curl -s https://TU-DOMINIO/internal/cache.json
# -> {"entries":...,"maxEntries":8000,"inFlight":0,"hits":...,"misses":...,"staleHits":...,"evictions":0,"coalesced":...}
```
