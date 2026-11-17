# 📈 Arquitectura de Alta Escala: cómo sostener +230.000–500.000 peticiones/día

Guía técnica y operativa para sostener **+500.000 peticiones/día** (~5,8 req/s sostenidos, picos de **30–70 req/s** en prime time y ~15M peticiones/mes) en el **plan gratuito** de Cloudflare Workers, sin caídas (`Error 1027`, `Error 1102` de CPU, límite de 50 subpeticiones ni bloqueo 429 en proveedores externos).

> ### ⚠️ Los dos datos que deciden todo (verificados en la documentación de 2026)
> 1. **Workers Free = 100.000 invocaciones/día por CUENTA** (no por Worker). Al pasarlas, Cloudflare
>    responde `Error 1027` directamente: el Worker ni se ejecuta, así que ningún código puede
>    «defender» el servicio llegado ese punto. Hay que evitar llegar.
> 2. **La Cache API (`caches.default`) NO funciona en `*.workers.dev`**. Los docs lo dicen literalmente:
>    «any Cache API operations in … any *.workers.dev deployments will have no impact. Only Workers
>    deployed to custom domains have access to functional cache operations». Lo mismo aplica a las
>    Cache Rules: no existen en un subdominio `workers.dev` porque no es tu zona.
>
> Consecuencia: sin dominio propio, **lo único gratis e ilimitado son los static assets** de `public/`
> (con tope de **20.000 archivos por versión**). Todo lo demás cuenta. Por eso el orden de esta guía es:
> primero static assets, después caché del isolate, y solo al final la Cache API del borde.

---

## 1. Radiografía real de cuellos de botella a 230K req/día

En un addon de Stremio, el tráfico típico se reparte así:

| Ruta / Tráfico | Peso típico | Volumen a 230K/día | Riesgo sin optimización | Cómo lo resuelve `Catálogos+` |
| --- | --- | --- | --- | --- |
| Catálogos (`/catalog/*` y `/<cfg>/catalog/*`) | ~62 % | ~142.600/día | Agota las 100K invocaciones/día de Workers Free y dispara >30 subrequests TMDB por catálogo | **Static Assets (0 invocaciones)** para el manifest general + **Edge Cache canónica** compartida entre usuarios con distinto `<cfg>` + caché de página en RAM |
| Web (`/`, `/configure`, `/manifest.json`, logos) | ~13 % | ~29.900/día | Cada apertura de `/configure` lanzaba 2–6 llamadas extra sin caché | **HTML/JSON pregenerados en `public/` (0 invocaciones)** + 21/21 estudios con logo estático + coalescencia cliente + `s-maxage` en `/internal/branding.json` |
| Fichas (`/meta/*` y `/<cfg>/meta/*`) | ~15 % | ~34.500/día | Re-consulta TMDB + OMDB (1.000/día free) por usuario | **Edge Cache canónica (`lang + region`)** + caché `meta:v1:*` coalescida en RAM + circuit-breaker 429/402 en OMDB |
| Streams públicos (`/stream/*` sin debrid) | ~7 % | ~16.100/día | 10 indexadores en paralelo (Español ES/LAT añade hasta 3 consultas con el título en español), timeouts y CPU | **Edge Cache canónica por filtros/proveedores** + pool SWR (`stale-while-revalidate` 6 h) + cooldown automático por proveedor |
| Streams privados Debrid (`/<cfg>/stream/*` con `debridId`) | ~3 % | ~6.900/día | Cloudflare KV Free solo permite **1.000 lecturas/día** (a las 1.001 falla debrid) | **Caché cifrada/descifrada en memoria del isolate + `cacheTtl: 300` en KV** (reduce lecturas KV >95 %) y `Cache-Control: no-store` estricto |

### Límites críticos de Cloudflare Workers Free y cómo queda el presupuesto

| Límite Cloudflare Free | Tope oficial | Presupuesto real con esta arquitectura a **230.000 req/día** |
| --- | --- | --- |
| Invocaciones del Worker | **100.000 / día** | **~22.000 – 48.000 / día** (con `prerender` + `build:web` + CDN Cache Rules en dominio propio; >75 % se sirve desde Static Assets y CDN Edge sin ejecutar el Worker) |
| CPU por invocación | **10 ms** | **< 2,5 ms** en hits de caché/catálogos (`config.reload` por huella, `decodeConfig` memoizado, `prune` amortizado O(1)) y **4–7 ms** en `/stream` |
| Subpeticiones (`fetch`) por invocación | **50 máx.** | **≤ 25** en catálogos fríos (tope de 24 `/external_ids` + 1 `/discover`), **≤ 7** en `/internal/branding.json` (concurrencia 5 + caché 24 h), **≤ 12** en `/stream` |
| Cloudflare KV `get` (`DEBRID_KV`) | **1.000 lecturas / día** (Free) | **~150 – 400 lecturas / día** incluso con miles de reproducciones debrid, gracias a la caché en RAM de 5 min + `cacheTtl: 300` en el PoP de KV |
| Memoria por isolate | **128 MB** | **~25 – 40 MB** de cachés de datos + **hasta `RESPONSE_CACHE_MB` (24 MB por defecto)** para respuestas completas; el presupuesto se mide en **bytes**, no en entradas |
| Archivos por versión (static assets) | **20.000** (Free) | **~130 de catálogos + hasta 1.500 fichas + ~40 de web + N configuraciones populares**: `lib/staticPlan.js` reparte el presupuesto y el prerender se detiene y avisa antes de pasar el tope (`scripts/prerender-catalogs.mjs`) |
| Configurador por región (`/configure/r/XX`) | 1 archivo por región usada (~500 KB) | **3–10 archivos**: solo las regiones que aparecen en el informe más la del despliegue |
| Reglas de `_redirects` | **2.000 estáticas + 100 dinámicas** | **5 fijas + 1 por configuración conocida** (~40–200): barras finales y `/manifest.json/`. Si se pasara, se recortan por prioridad y avisa |
| Cache API (`caches.default`) | Funcional **solo en dominio propio** | En `*.workers.dev` es un **no-op**: por eso la caché de respuestas del isolate (`lib/responseCache.js`) va **antes** y es la que sostiene esos despliegues |

---

## 2. Las 8 capas de defensa implementadas en el código

### Capa 0 · Caché de respuestas en el isolate (`lib/responseCache.js`)

Es la capa nueva y la que más cambia las cuentas en un `*.workers.dev`. Guarda la **respuesta HTTP
completa** (estado + cabeceras + cuerpo) en la memoria del isolate:

- **Va antes que la Cache API.** `cache.match()` cuenta como subpetición (límite de 50) y además no
  funciona en `workers.dev`; la memoria no gasta ni CPU ni subpeticiones.
- **Presupuesto por bytes** (`RESPONSE_CACHE_MB`, 24 MB por defecto, `0` la desactiva): un catálogo
  pesa ~100 veces una ficha, así que limitar por número de entradas no protegería los 128 MB.
- **TTL derivado del `Cache-Control`** que ya publicamos, más ventana *stale-while-revalidate*: si la
  entrada caducó pero sigue en su gracia, se sirve al instante y se recalcula en segundo plano.
- **Single-flight**: 20 peticiones simultáneas del mismo recurso frío ejecutan **una sola** carga.
- **Nunca guarda `no-store`/`private`** (Debrid, respuestas degradadas).

Ojo con lo que **no** hace: no reduce invocaciones —eso solo lo consiguen los static assets y una
Cache Rule del CDN—, pero convierte una petición de ~5 ms y 25 subpeticiones en una de ~0,1 ms y 0
subpeticiones, que es lo que evita el `Error 1102` de CPU y el agotamiento de TMDB/OMDB.

### Capa 1 · Zero-Worker Static Offloading (`public/` + GitHub Actions cada 6 h)
En `wrangler.toml`, `[assets] directory = "./public"` con `run_worker_first = false` hace que Cloudflare sirva cualquier archivo estático **antes de facturar o contar una invocación del Worker** (tráfico gratuito e ilimitado):
- `scripts/prerender-catalogs.mjs` genera los 121 JSON en `public/catalog/<type>/<id>.json`.
- Ese mismo script pregenera las **fichas** de los títulos que aparecen en esos catálogos
  (`public/meta/<type>/<tt…>.json`, hasta `--max-metas=1500`): las fichas son el segundo bloque de
  tráfico (~15 %) y así dejan de ejecutar el Worker en las instalaciones sin personalizar.
- `scripts/build-web.mjs` (cuando defines `PUBLIC_ORIGIN` o `ADDON_BASE_URL`) pregenera:
  - `public/index.html` (portada con tendencias horneadas)
  - `public/configure/index.html` (configurador completo)
  - `public/manifest.json` (manifest general)
  - `public/internal/branding.json` (logos oficiales)
- `scripts/prerender-catalogs.mjs --from-url` añade, además, las **páginas 2 y 3** de cada catálogo
  (`/page-2.json`, `/page-3.json`, que es como pagina Stremio) y los catálogos de las
  configuraciones populares (Capa 7), y regenera `public/_redirects`.
- `.github/workflows/prerender.yml` ejecuta los scripts cada 6 horas y despliega automáticamente los estáticos frescos sin intervención manual.

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
Esto incluye `/internal/branding.json`, `/` y `/configure` (salvo cuando trae parámetros OAuth de Real-Debrid).

### Capa 4 · Single-Flight Coalescing (`cache.coalesce`) extremo a extremo
Si una película entra en tendencia y 80 usuarios piden simultáneamente el mismo catálogo, ficha o stream en frío:
- `lib/catalogs.js`, `lib/meta.js`, `lib/tmdb.js`, `lib/omdb.js`, `lib/branding.js`, `lib/streams.js` y `lib/debridCredentials.js` **coalescen** las promesas en vuelo.
- Las 80 peticiones comparten **1 sola llamada HTTP** al proveedor externo. Las métricas agregadas en `/internal/cache.json` exponen el contador `coalesced`.

### Capa 5 · Presupuesto de Subpeticiones, Cuotas Externas y CPU
- **TMDB (`lib/tmdb.js`)**: caché compacta `tmdb:ext:<type>:<id>` (7 días), caché negativa de 404 (1 h) y tope de **24 `/external_ids` no cacheados por invocación** con pool de concurrencia 6. Garantiza no cruzar jamás el límite de 50 subpeticiones de Cloudflare Workers.
- **KV Debrid (`lib/debridCredentials.js`)**: cachea la credencial descifrada 5 min en el isolate (`debrid:credential:<id>`), coalesciendo lecturas simultáneas y pasando `{ cacheTtl: 300 }` a `DEBRID_KV.get()`, con invalidación inmediata al actualizar o desconectar.
- **CPU (`lib/config.js`, `lib/userConfig.js`, `lib/cache.js`)**: `config.reload(env)` calcula una huella ligera y evita re-parsear variables en cada request; `decodeConfig` guarda hasta 512 configs normalizadas clonadas en memoria; `cache.js` sube a `8.000` entradas con barrido amortizado cada 250 escrituras.
- **Protección anti-abuso (`worker.mjs`, `api/index.js`)**: `/internal/streams-test.json` aplica `rateLimit` por IP (6 req/min) y coalescencia de 30 s.

### Capa 6 · Reducción de Fan-Out en el Navegador (`/configure`)
- **21/21 estudios con logo estático** en `lib/staticLogos.js`: abrir `/configure` ya **no necesita disparar** `fetch('/internal/branding.json')`.
- **Botón «Esenciales (carga rápida)»** en `/configure`: permite instalar con un clic las 8 plataformas y 6 estudios principales (~38 catálogos frente a 121, reduciendo >3× las peticiones por sesión de Stremio).
- **Deduplicación en el cliente de `/configure`**: coalescencia y memoización para que la carga inicial no pida el mismo catálogo por duplicado ni repita llamadas al cambiar de sección.

---

### Capa 7 · Plan de estáticos por configuración (`lib/staticPlan.js`)

En `*.workers.dev` **cada petición que no sea un archivo de `public/` ejecuta el Worker**, incluidos
los catálogos de quien instaló `/<cfg>/manifest.json`. Las capas 1–6 bajan CPU, subpeticiones y
llamadas a TMDB, pero **no bajan el número de invocaciones**, que es lo que agota las 100.000/día.

Esta capa sí. El addon ahora **pregunta a su propio tráfico** qué pregenerar:

1. `worker.mjs` anota cada configuración visitada en `lib/configRegistry.js` (solo el segmento
   base64url y la selección; **nunca** configs con `debridId`).
2. Ese informe se publica en `/internal/cache.json` → `configs`.
3. `npm run prerender -- --from-url=https://tu-dominio` lo lee, reparte el presupuesto de
   **20.000 archivos** de Cloudflare Free (`lib/staticPlan.js`) y escribe:
   - `public/<cfg>/manifest.json` → abrir el addon deja de invocar el Worker.
   - `public/<cfg>/catalog/<tipo>/<id>.json` y **`/page-2.json`, `/page-3.json`** → cada
     «cargar más» de Stremio también es gratis (antes gastaba una invocación por página).
   - `public/meta/…` y `public/catalog/…` por defecto, como ya hacía.

Cuatro detalles que hacen que esto funcione de verdad:

- **Segmento canónico.** `encodeConfig` ordena plataformas/estudios/catálogos/proveedores con el
  orden del addon y `/configure` omite el idioma por defecto. Así dos usuarios con la misma
  configuración comparten **el mismo archivo** (antes `['netflix','disney']` y `['disney','netflix']`
  generaban URLs distintas y no se podía pregenerar ninguna).
- **Manifests primero.** Cuestan 1 archivo y evitan una invocación por sesión y usuario: entran
  siempre, aunque el presupuesto se acabe.
- **Topes por tipo.** Ningún grupo (catálogos por defecto 45 %, fichas 35 %, catálogos por config
  15 %, páginas 10 %, manifests 8 %) se come el presupuesto de los demás.
- **Fichas compartidas.** Una ficha no depende de la selección de plataformas, así que una sola
  copia sirve a todas las configuraciones.

Además, `public/_redirects` se regenera en cada despliegue (`lib/edgeRoutes.js`) con las rutas que
el Worker resolvía **gastando una invocación para devolver un 404**: `/configure/` y
`/manifest.json/` sin barra final. `_redirects` se
evalúa antes de los assets y del Worker: **0 invocaciones**. Se respeta el tope de Cloudflare
(2.000 estáticas + 100 dinámicas) y se conservan las reglas manuales.

Dos piezas más del mismo esfuerzo, que no gastan cupo de reglas:

- **Una sola regla dinámica** (`/:path/manifest.json/ → /:path/manifest.json`) cubre *todas* las
  configuraciones presentes y futuras. Antes hacía falta una por usuario.
- **El botón «Configurar» de Stremio** (`/<cfg>/configure`) ya no renderiza el configurador entero
  en el Worker en cada clic: `_redirects` lo manda a `/configure/r/<REGION>`, un **archivo
  pregenerado por región** (`prerenderConfigPages`, ~500 KB, uno por región usada). El configurador
  abre con la región y el idioma correctos; la selección fina sigue viniendo del borrador del
  navegador (`localStorage`), que tiene prioridad. Coste: **0 invocaciones**.

**Cómo se comprueba** (sin creerse nada):

```bash
# 1. Qué configuraciones ha visto tu despliegue en las últimas 24 h
curl -s https://tu-dominio/internal/cache.json | head -c 600

# 2. Pregenerar con ese informe y ver el plan y la proyección
PUBLIC_ORIGIN=https://tu-dominio npm run prerender -- --from-url

# 3. Que las barras finales no invocan al Worker (301 sin marca)
curl -sI https://tu-dominio/configure/ | grep -iE '^(HTTP|location|x-catalogos-runtime)'
```

La proyección del script se calcula con `TRAFFIC` (catálogos 62 %, fichas 15 %, web 13 %; los
streams, 10 %, nunca son estáticos) y sale del tipo:

`Con este plan el Worker ejecuta ~26.700 de 178.000 peticiones/día (27 % del plan free) → aguanta ~666.000 peticiones/día.`

Es una **proyección**, no una medición: los números reales los da
`npm run scale:audit -- --url https://tu-dominio --requests 178000`.

---

## 3. Regla de Caché en Cloudflare CDN (clave para superar 230K–500K req/día en Plan Free)

> **Importante sobre Cloudflare:** En un subdominio `*.workers.dev`, la petición entra primero al Worker (contando contra las 100.000 invocaciones/día) incluso cuando `caches.default` hace HIT.  
> En cambio, si conectas el Worker a un **dominio propio** en Cloudflare (gratis) y activas **1 Cache Rule**, el CDN de Cloudflare responde desde el borde **antes de despertar al Worker (0 invocaciones consumidas)**, igual que un archivo estático, pero también para rutas `/<cfg>/catalog/*`, `/<cfg>/meta/*` y `/internal/branding.json`.

### Configuración exacta en Cloudflare Dashboard → Caching → Cache Rules

Crea una regla llamada **`Catalogos+ Public Edge Cache`**:

- **When incoming requests match (Expression):**
  ```txt
  (http.request.method eq "GET") and (
    starts_with(http.request.uri.path, "/catalog/") or
    starts_with(http.request.uri.path, "/meta/") or
    http.request.uri.path eq "/internal/branding.json" or
    http.request.uri.path eq "/manifest.json" or
    ends_with(http.request.uri.path, "/catalog/movie/") eq false and (
      http.request.uri.path contains "/catalog/" or
      http.request.uri.path contains "/meta/"
    )
  )
  ```
  *(Más simple en el editor visual: `URI Path` contains `/catalog/` OR `URI Path` contains `/meta/` OR `URI Path` equals `/manifest.json`)*
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

### C) Verificar si TU despliegue aguanta 500.000 peticiones/día

No hay que creerse la tabla: se mide. `scripts/scale-audit.mjs` pregunta al despliegue real y
proyecta cuántas de esas peticiones ejecutarían el Worker. El truco es la cabecera
`X-Catalogos-Runtime: worker`, que el Worker añade a **todas** sus respuestas: lo que llegue sin ella
fue servido por un static asset o por el CDN, es decir, **gratis**.

```bash
node scripts/scale-audit.mjs --url https://tu-dominio            # proyección a 500.000/día
PUBLIC_ORIGIN=https://tu-dominio npm run scale:audit             # lo mismo, con la variable del repo
node scripts/scale-audit.mjs --url https://tu-dominio --requests 800000
node scripts/scale-audit.mjs --url https://tu-dominio --json     # para CI
```

Además de sondear rutas, la auditoría lee `/internal/cache.json`, reconstruye el plan de estáticos
(`lib/staticPlan.js`) y lo proyecta:

```
Plan de estáticos (configuraciones vistas: 3):
  574 archivos · 3 configuraciones pregeneradas
  121 catálogos por defecto, 0 fichas, 450 catálogos por configuración, 3 manifest
  Con ese plan el Worker ejecutaría ~53.400 de 178.000 peticiones/día (53 % del plan free)
  → techo ~333.333/día
```

Sale del script con código `0` si cabe en las 100.000 invocaciones y `2` si no, así que se puede usar
como comprobación automática después de cada despliegue.

### D) Las tres cuentas que importan (500.000 peticiones/día)

| Escenario | Catálogos + fichas + web (90 %) | Streams (10 %) | Invocaciones/día | ¿Cabe en Free? |
| --- | --- | --- | --- | --- |
| **A. Dominio propio + Cache Rule** | CDN y static assets → **0** | Worker (no se cachean: son por título, y con Debrid además `no-store`) | **~50.000** | ✅ **Sí** (50 % del presupuesto libre) |
| **B. `*.workers.dev` con prerender** | Gratis **solo sin configuración**; con `/<cfg>/` ejecutan el Worker | Worker | **~50.000 – 500.000** según cuántos usuarios instalen el manifest personal | ⚠️ Depende: si más del ~20 % del tráfico lleva `/<cfg>/`, te pasas |
| **B-bis. `*.workers.dev` + plan por configuración** | Catálogos/fichas/manifest por defecto **y** los de las N configuraciones más usadas → static assets | Worker solo en streams y long-tail | **~30.000 – 60.000** para 178.000–500.000 peticiones/día | ✅ **Sí** — es la vía recomendada sin dominio propio |
| **C. `*.workers.dev` sin prerender** | Todo ejecuta el Worker | Worker | **~500.000** | ❌ No (5× por encima) |

Por qué cambia tanto: sin Cache Rule, cada petición con configuración propia (`/<cfg>/…`, que es lo
que instala `/configure`) pasa sí o sí por el Worker. En el escenario B, la caché de respuestas del
isolate evita que eso se convierta en un fan-out a TMDB en cada repetición, pero **no** evita la
invocación.

**Recomendación, en orden de impacto:**
1. **Conecta un dominio propio** (gratis) y crea la Cache Rule de la sección 3. Es el único paso que
   convierte el 90 % del tráfico en gratis *incluso con configuración personal*.
2. **Pregenera con el informe real** (`PUBLIC_ORIGIN=… npm run deploy`, que ya encadena
   `prerender --from-url`): catálogos, fichas, portada, `/configure`, `_redirects` y los catálogos
   de las configuraciones que de verdad usa tu gente. Sin dominio propio, este es el paso que más
   invocaciones ahorra: el workflow cada 6 h lo repite solo.
3. **Deja la caché del isolate activa** (`RESPONSE_CACHE_MB=24`): es la red de seguridad para el
   tráfico que sí llega al Worker.
4. Compruébalo con `npm run scale:audit -- --url https://tu-dominio`.

### E) Cuándo pasar a Workers Paid ($5 USD/mes)
Si decides **no** usar dominio propio con Cache Rules, o si tu comunidad supera las **~80.000 búsquedas únicas de `/stream` al día** (>600.000–800.000 peticiones totales/día):
- **Workers Paid ($5/mes)** sube las cuotas a **10.000.000 invocaciones/mes** (~333.000 invocaciones puras de Worker al día, equivalentes a **>1,5 millones de peticiones totales/día** sumando Static Assets + CDN), **30 s de CPU** por invocación y **1.000 subpeticiones** por invocación, además de **10 millones de lecturas KV/mes**.

---

## 5. Verificación rápida en producción

```bash
# 0. Que las barras finales no despierten al Worker (301 del borde).
curl -sI https://TU-DOMINIO/configure/ | grep -iE '^(HTTP|location|x-catalogos-runtime)'
# 1. Comprobar que catálogos y logos devuelven s-maxage y stale-while-revalidate
curl -sI https://TU-DOMINIO/catalog/movie/cine_tendencias.json | grep -iE 'cache-control|cf-cache'
curl -sI https://TU-DOMINIO/internal/branding.json | grep -iE 'cache-control|cf-cache'
# 2. Configuraciones vistas (lo que usará el prerender) y modo ahorro
curl -s https://TU-DOMINIO/internal/cache.json | head -c 800
curl -s https://TU-DOMINIO/healthz | grep -o '"quota":{[^}]*}'

# 3. Salud de la caché en memoria y peticiones coalescidas
curl -s https://TU-DOMINIO/internal/cache.json
# -> {"entries":...,"maxEntries":8000,"inFlight":0,"hits":...,"misses":...,"staleHits":...,
#     "evictions":0,"coalesced":...,"responseCache":{...},"configs":{"configs":[...],...}}
```
