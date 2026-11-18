# 🔁 Duplicar la cuota: de 100.000 a 200.000 peticiones/día (sin pagar)

Guía para el caso concreto de un despliegue en `*.workers.dev` que ya pasó el plan gratuito de
Cloudflare: el panel muestra algo como **`173.803 / 100.000`**. Al llegar a 100.000, Cloudflare
responde `Error 1027` y el Worker **ni se ejecuta**: no hay código que pueda «defenderse» llegado ese
punto.

> **Lo primero, sin rodeos:** las 100.000 invocaciones/día son un límite **por cuenta**, no por
> Worker, y **no se pueden subir desde el código**. Lo que sí se puede hacer es que la mayoría de las
> peticiones **no ejecuten el Worker** (static assets y atajos de borde) y **repartir** a los usuarios
> entre dos despliegues con cuotas independientes. Este documento hace las dos cosas. Al final:
>
> **100.000 × 2 espejos = 200.000 peticiones/día**, y con los atajos de borde el consumo real por
> espejo queda muy por debajo de su cuota.

---

## 1. Qué hay nuevo en el código

### 1.1 Atajos de borde (`lib/edgeShortcuts.js`) — alivia YA, sin tocar nada

El contenido de un catálogo depende solo del idioma, la región y el `id` del catálogo; el de una
ficha, solo del idioma y la región. La selección de plataformas, estudios, proveedores o filtros
decide **qué** catálogos ve el usuario, no **qué devuelve** cada uno.

Por eso, si un usuario no cambió ni el idioma ni la región del despliegue, sus
`/<cfg>/catalog/...` y `/<cfg>/meta/...` son **los mismos** archivos que ya existen en
`/catalog/...` y `/meta/...`. El prerender ahora escribe en `_redirects`:

```txt
/<cfg>/catalog/*   /catalog/:splat   301
/<cfg>/meta/*      /meta/:splat      301
```

`_redirects` se evalúa **antes** de los assets y del Worker, así que esas peticiones cuestan
**0 invocaciones** (y la segunda también: o es un archivo, o si el archivo no existe el Worker la
resuelve con la configuración por defecto, que devuelve exactamente lo mismo).

- Beneficio: **~62 % del tráfico (catálogos) + ~15 % (fichas)** gratis para todas las
  configuraciones que solo cambian proveedores, filtros u orden.
- Aplica a **usuarios ya instalados**: no hay que reinstalar nada. Las reglas se regeneran en cada
  prerender (cada 6 h en el workflow) y llegan con el despliegue.
- No toca `/stream/...`, `/<cfg>/manifest.json` ni `/<cfg>/configure`, y **nunca** una configuración
  con `debridId` (su segmento es privado).
- Tope de Cloudflare: 100 reglas dinámicas → 2 por configuración = ~49 configuraciones atajadas.
  Las que no entran se siguen sirviendo con el Worker (y, si caben, con sus propios archivos).
- Desactivarlo: `STATIC_SHORTCUTS=off` en `wrangler.toml` (`[vars]`) o como variable de entorno.

### 1.2 Espejos de cuota (`lib/mirrors.js`) — duplica el techo

`MIRROR_ORIGINS` declara **otros despliegues del mismo addon** (otra cuenta de Cloudflare, Vercel…).
`/configure` y la portada reparten a cada usuario en **un** espejo, con un hash estable de su
configuración: su manifest, sus catálogos y sus fichas viven siempre en el mismo origen y no se
mezclan.

```toml
# wrangler.toml
[vars]
# La URL del segundo despliegue (y del tercero, si algún día hace falta).
MIRROR_ORIGINS = "https://catalogos-plus-2.mi-subdominio.workers.dev"
```

- Con **2 despliegues**: 100.000 + 100.000 = **200.000 invocaciones/día**.
- Con 3: 300.000. Tope del addon: 8 espejos + el propio.
- No depende de tener dominio propio, Cache Rules ni nada de pago.
- Sin `MIRROR_ORIGINS` todo sigue exactamente igual que antes (una sola URL).
- Diagnóstico: `GET /internal/mirrors.json` y `GET /healthz` → `mirrors`.

---

## 2. Puesta en marcha (15–20 minutos)

### Paso 0 · Comprobar el estado actual

```bash
curl -s https://TU-DOMINIO/healthz | grep -o '"quota":{[^}]*}'
curl -s https://TU-DOMINIO/internal/mirrors.json
```

`quota.configsTracked` y `configs` de `/internal/cache.json` dicen qué configuraciones ve tu
despliegue: son las que el prerender puede atajar.

### Paso 1 · Desplegar el segundo espejo (cuenta gratuita nueva)

```bash
# Cuenta B de Cloudflare (gratis). Un token con permiso «Workers Scripts: Edit»
# y el Account ID de esa cuenta.
export CLOUDFLARE_API_TOKEN=<token de la cuenta B>
export CLOUDFLARE_ACCOUNT_ID=<account id de la cuenta B>
export PUBLIC_ORIGIN=https://catalogos-plus-2.tu-subdominio.workers.dev
export TMDB_API_KEY=<tu clave>          # la misma de siempre
npm run deploy                          # build:web + prerender + wrangler deploy
```

`npm run deploy` ya hace lo importante: genera los catálogos y fichas estáticos **también para el
espejo** (cada despliegue tiene sus propios static assets) y reescribe `_redirects` con los atajos.

> **Secretos por cuenta.** Cada despliegue tiene sus propios secrets (`wrangler secret put …`):
> TMDB, OMDB, `DEBRID_ENCRYPTION_KEY`, OAuth de Real-Debrid y, si usas KV, su propia
> `DEBRID_KV`. Las cuentas debrid de los usuarios **no** se comparten entre espejos: van cifradas por
> despliegue.

> **Alternativa sin segunda cuenta de Cloudflare:** despliega el mismo repo en Vercel (`api/index.js`
> ya es Express + SDK, ver el README). Ahí no hay static assets, pero sí cuota propia y todas las
> rutas dinámicas.

### Paso 2 · Decirle a cada despliegue quién es el otro

En **ambos** despliegues, con la URL del contrario (o de todos, separados por comas):

```bash
# Cuenta A
MIRROR_ORIGINS="https://catalogos-plus-2.tu-subdominio.workers.dev"

# Cuenta B
MIRROR_ORIGINS="https://catalogos-plus.tu-subdominio.workers.dev"
```

Edítalo en `wrangler.toml` → `[vars]` y vuelve a desplegar, o como secret si prefieres no tenerlo en
el repo. Con eso `/configure` ya reparte: la mitad de las instalaciones nuevas caerá en cada espejo.

> `npm run build:web` y `npm run prerender` **leen también `[vars]` de `wrangler.toml`**
> (`lib/tomlVars.js`): si defines `MIRROR_ORIGINS` ahí, la web pregenerada reparte igual que el
> Worker sin exportar nada a mano. Lo que exportes en la shell o en GitHub Actions tiene prioridad.

> Sin dominio propio no pasa nada: el reparto es por URL de instalación, no por DNS.

### Paso 3 · Regenerar estáticos y `_redirects`

```bash
# Cuenta A
PUBLIC_ORIGIN=https://catalogos-plus.tu-subdominio.workers.dev npm run deploy
```

El log debe mostrar algo así:

```txt
[prerender] Atajos de borde: 12 configuraciones sin gastar archivos (…)
[prerender] _redirects: 31 reglas en el borde (0 invocaciones) · … · 12 configuraciones atajan catálogos y fichas
[prerender] Espejos activos: 2 despliegues × 100.000 invocaciones/día → techo combinado ~200.000 peticiones/día
```

### Paso 4 (solo si quieres repartir el tráfico YA existente)

Stremio guarda la URL que se instaló: **un usuario ya instalado no cambia de espejo solo**. Tienes
dos opciones:

1. **Compartir el enlace del espejo nuevo** con parte de la comunidad
   (`https://catalogos-plus-2…/configure`), o
2. **Pedir una reinstalación** (Addons → Catálogos+ → Desinstalar → instalar desde `/configure`),
   que es lo que el README ya recomienda al cambiar de versión.

Mientras tanto, los atajos de borde ya reducen el consumo de **todos** los instalados sin tocar nada,
y en muchos casos bastan para volver por debajo de 100.000.

---

## 3. Verificación (no hay que creerse nada)

```bash
# 1) Cuántos despliegues suma el addon y cuál es el techo real
curl -s https://TU-DOMINIO/internal/mirrors.json
# -> {"self":"https://…","mirrors":["https://…-2…"],"shards":2,
#     "perShardDaily":100000,"dailyCapacity":200000,…}

# 2) Que los atajos están en el borde (301 SIN la marca del Worker)
curl -sI https://TU-DOMINIO/<cfg>/catalog/movie/cine_tendencias.json \
  | grep -iE '^(HTTP|location|x-catalogos-runtime)'

# 3) Que la segunda petición la sirve un archivo (gratis)
curl -sI https://TU-DOMINIO/catalog/movie/cine_tendencias.json | grep -iE '^(HTTP|x-catalogos-runtime)'

# 4) Auditoría con tu volumen real (el script sale con 2 si no cabe)
npm run scale:audit -- --url https://TU-DOMINIO --requests 173803
```

La auditoría ahora imprime además:

```txt
Espejos de cuota: 2 despliegue(s) × 100.000 invocaciones/día → techo combinado ~200.000/día
```

### Cómo revertir

- Atajos: `STATIC_SHORTCUTS=off` y vuelve a desplegar (el prerender deja de escribirlos).
- Espejos: borra `MIRROR_ORIGINS`; `/configure` vuelve a usar solo su propio origen.

---

## 4. Límites que conviene tener claros

| Límite | Valor | Qué implica aquí |
| :--- | :--- | :--- |
| Invocaciones/día | **100.000 por cuenta** | Es lo que se duplica con espejos. No se puede subir por código. |
| Static assets | Ilimitados, **20.000 archivos** por versión | Cada espejo los suya; el prerender se detiene antes del tope. |
| Reglas `_redirects` | 2.000 estáticas + **100 dinámicas** | Los atajos usan 2 por configuración (~49 configuraciones). |
| KV (credenciales debrid) | 1.000 lecturas/día (free) | Por cuenta: cada espejo tiene su propia KV. |
| CPU por invocación | 10 ms (free) | Los atajos evitan ejecutar el Worker, así que no gastan CPU. |
| Subpeticiones | 50 por invocación | Sin cambios. |

### ¿Y si no quiero tocar a los usuarios ni abrir otra cuenta?

Solo queda **Workers Paid (5 USD/mes)**: ~333.000 invocaciones/día, 30 s de CPU y 1.000
subpeticiones por invocación. Para 173.803 peticiones/día sobra incluso sin atajos. Está explicado en
[escala-plan-free.md](escala-plan-free.md#e-cuándo-pasar-a-workers-paid-5-usdmes).

### Si algún cliente web no sigue las redirecciones

`_redirects` responde un **301** a `/catalog/...` y `/meta/...`; Stremio (desktop, móvil, TV y web)
sigue redirecciones en sus peticiones GET. Si usas un cliente que no las siguiera, apágalos con
`STATIC_SHORTCUTS=off` y vuelve a desplegar: todo vuelve a resolverse en el Worker como antes (y
sigues teniendo los archivos y los espejos).

### ¿Y si el número sigue subiendo?

Orden de impacto, de mayor a menor:

1. **Atajos de borde** (ya activos con el prerender): quitan catálogos y fichas del Worker.
2. **Espejos**: cada despliegue nuevo suma 100.000/día.
3. **Dominio propio + Cache Rule** (gratis): el CDN sirve `/catalog/`, `/meta/` y `/manifest.json`
   sin ejecutar el Worker, incluso en `https://tu-dominio.com/<cfg>/…`. Es la palanca que sirve
   también para los usuarios que no se reinstalan.
4. **Workers Paid**, si el tráfico real pasa de ~400.000/día con dos espejos.
