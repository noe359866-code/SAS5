# 📈 Escalar en el plan gratuito: de 100K a 145K+ peticiones/día

Guía práctica para que el addon aguante **~145.000 peticiones/día** sin pagar, o para saber
exactamente cuánto falta cuando la cuota del plan free se queda corta.

---

## 1. Qué cuenta y qué no en el plan free

| Límite (Workers Free) | Valor | ¿Te afecta aquí? |
| --- | --- | --- |
| Peticiones que **ejecutan el Worker** | **100.000/día, por cuenta** (`error 1027` al agotarse, reinicio 00:00 UTC) | Sí, es el techo real |
| CPU por petición | 10 ms | Sí en `/stream` (fan-out a proveedores) |
| Subpeticiones por petición | 50 | Sí en `/stream` con debrid |
| Peticiones a **static assets** | **Gratis e ilimitadas** | Es la palanca principal |
| KV | 100.000 lecturas y **1.000 escrituras**/día | Sirve para leer, no para contar cada request |
| Cron triggers | 5 por cuenta | Sí para refrescar datos |

Fuentes: [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/) y
[pricing (static assets)](https://developers.cloudflare.com/workers/platform/pricing/).
Dos matices que suelen confundir:

- La cuota es **por cuenta**, no por Worker. Tener 5 Workers no multiplica nada.
- Pages Functions y Workers **comparten** la misma cuota de 100.000/día.

## 2. Las cuentas de tu caso

- 145.000 peticiones/día ≈ **4,35 millones al mes**.
- Hoy **todo** pasa por el Worker: manifest, catálogos, meta, streams, portada, logo y `/configure`.
- El manifest por defecto declara **121 catálogos**. Una sesión de navegación que abre todas las
  filas gasta ~121 peticiones solo en catálogos:

```text
100.000 peticiones/día ÷ 121 catálogos ≈ 820 sesiones completas al día
```

Para sostener 145.000 hay que **sacar del Worker ≥ 45.000 peticiones/día (31 %)**, o bajar el
consumo por usuario. Lo primero es mucho más barato y ya está implementado.

## 3. Palanca 1 (ya implementada): catálogos por defecto como static assets

`wrangler.toml` ahora declara:

```toml
[assets]
directory = "./public"
run_worker_first = false
```

Con eso, **si el archivo existe, Cloudflare lo sirve sin ejecutar el Worker**: esas peticiones son
gratuitas e ilimitadas. `scripts/prerender-catalogs.mjs` genera un JSON por catálogo del manifest
por defecto en `public/catalog/<tipo>/<id>.json`, con el mismo cuerpo que devuelve el Worker.

```bash
npm run prerender        # usa TMDB_API_KEY / WATCH_REGION / TMDB_LANGUAGE del entorno
npm run deploy           # = prerender + wrangler deploy
```

Resultado: `/catalog/movie/cine_tendencias.json`, `/catalog/series/tv_netflix.json`… dejan de
gastar cuota; `/manifest.json`, `/<config>/catalog/...`, `/meta`, `/stream` y `/configure` siguen
en el Worker.

**Cuánto ahorra.** Los catálogos suelen ser la mayoría del tráfico de un addon de Stremio
(60–80 %). Si son el 70 %:

```text
145.000 × 70 % = 101.500 peticiones/día servidas gratis
145.000 − 101.500 = 43.500 peticiones/día en el Worker   (43 % de la cuota)
```

Es decir: con esta palanca sola, 145.000/día cabe **con margen**, y el nuevo techo pasa a ser el
tráfico de `meta` + `stream`.

**Refrescar los datos.** Los estáticos se congelan en cada `deploy`, así que conviene regenerarlos
por cron (GitHub Actions, cada 6 h):

```yaml
name: refrescar-catalogos
on:
  schedule: [{ cron: '0 */6 * * *' }]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      CF_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      TMDB_API_KEY: ${{ secrets.TMDB_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - if: env.CF_API_TOKEN != ''
        run: npx wrangler deploy
        env: { CLOUDFLARE_API_TOKEN: '${{ env.CF_API_TOKEN }}' }
```

**Comprobar que funciona** (en local, sin desplegar):

```bash
npm run prerender
npx wrangler dev            # otra terminal
curl -sI http://127.0.0.1:8787/catalog/movie/cine_tendencias.json | grep -i 'cache-control\|cf-cache'
```

Debe responder `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` y
`CF-Cache-Status: HIT` (cabeceras de `public/_headers`). En producción, compara **Requests del
Worker** (Workers & Pages → Metrics) con el **tráfico total del dominio** (Analytics → Traffic):
la diferencia son las peticiones que ya no gastan cuota.

**Límites de esta palanca**

- Solo cubre el manifest **por defecto**. Un manifest personalizado (`/<config>/catalog/...`) tiene
  otra URL y sigue resolviéndose en caliente.
- Una sesión que filtre por género, `skip` u otros extras tampoco es un archivo estático.
- Los datos tienen la antigüedad del último deploy (con el cron: ≤ 6 h). El Worker ya cacheaba 6 h.
- No se escribe un archivo si el catálogo vino vacío: así nunca se sustituyen datos buenos por
  listas vacías (por ejemplo, si el build se lanzó sin `TMDB_API_KEY`).

## 4. Palanca 2: menos catálogos por usuario

Cada fila que el usuario abre en Stremio es una petición. El manifest por defecto tiene 121 filas
porque enseña todo; quien usa 3 plataformas no necesita 30.

- Instala el manifest **personalizado** desde `/configure` (idioma, región, plataformas, estudios,
  base). Un manifest típico baja a **12–20 catálogos**, es decir, ~6–10× menos peticiones por sesión.
- En la comunidad, reparte el enlace `/configure` en lugar del manifest "todo activado".
- Si quieres un perfil ultra-ligero, desmarca las plataformas y estudios que no uses: los catálogos
  base (Tendencias, Populares, Top, En TV hoy) son 8.

Con manifiestos de ~15 catálogos, el techo por sesión sube de ~820 a ~6.600 sesiones/día.

## 5. Palanca 3: portada, `/configure` y logo

- **Logo**: ya es estático (`public/assets/logo.png`), así que cada landing no gasta cuota al
  cargarlo.
- **Portada y `/configure`** se renderizan con el host real y tendencias de TMDB. Si fijas
  `ADDON_BASE_URL` (dominio propio estable) puedes pregenerar el HTML y servirlo como
  `public/index.html` y `public/configure/index.html`; entonces esas visitas también son gratis.
  Ojo: perderían las tendencias en vivo y el `origin` dinámico.

## 6. Palanca 4: repartir la cuota

La cuota es **por cuenta**, así que hay dos formas legítimas de multiplicarla:

1. **Varias cuentas de Cloudflare** (una por despliegue, con su propio `workers.dev` o subdominio).
   Cada una aporta 100.000/día. Como en Stremio cada URL es un addon distinto, puedes publicar
   "Catálogos+ (espejo 1 / 2 / 3)" y repartir a la comunidad entre ellas. No hay forma de repartir
   automáticamente sin un router, y el router también gastaría cuota.
2. **Otro proveedor en paralelo.** El repo ya trae el servidor Express (`api/index.js`) para
   Vercel y `addon.js` para el SDK: despliega la misma app allí y ofrece dos URLs de instalación
   (una por backend). Vercel/Deno/Netlify tienen cuotas independientes de Cloudflare.

## 7. Palanca 5: bajar el coste de cada petición

- **No publiques los endpoints internos** (`/internal/cache.json`, `/internal/branding.json`,
  `/internal/streams-test.json`, `/healthz`) en la portada ni en foros: cualquier bot que los
  sondea gasta tu cuota. Si los necesitas, protégelos con un token.
- **`robots.txt`**: los crawlers que recorren catálogos, fichas y streams se comen la cuota.
  El repo ya incluye `public/robots.txt`, que bloquea `/catalog/`, `/meta/`, `/stream/`,
  `/internal/` y `/healthz` pero deja indexables `/` y `/configure` (SEO de la landing).
- **CPU, no cuota**: si ves `error 1102` en `/stream`, el problema son los 10 ms de CPU, no las
  100.000 peticiones. Baja `DEBRID_MAX_CHECKS`, recorta proveedores o pasa a plan de pago.

## 8. Palanca 6: el plan de pago de 5 USD

Si tras las palancas 1–3 sigues por encima, el plan Workers Paid cuesta **5 USD/mes** e incluye
10 millones de peticiones/mes (≈ 333.000/día) y 30 s de CPU por petición. 145.000/día = 4,35 M/mes:
cabe con holgura y el exceso se factura a 0,30 USD por millón. Suele ser la opción más barata si el
addon ya tiene comunidad y no quieres trocear URLs.

## 9. Checklist

```bash
# 1) Generar estáticos con las claves de producción en el entorno
cp .env.example .env    # rellena TMDB_API_KEY
npm run prerender       # debe imprimir "Catálogos: N escritos"

# 2) Desplegar (prerender + wrangler en un paso)
npm run deploy

# 3) Verificar en producción
curl -sI https://TU-DOMINIO/catalog/movie/cine_tendencias.json | grep -i 'cache-control'
curl -s  https://TU-DOMINIO/catalog/movie/cine_tendencias.json | head -c 120
```

```text
[ ] public/catalog/<tipo>/<id>.json generados y desplegados
[ ] /catalog/... responde con Cache-Control largo y sin gastar Worker
[ ] cron de refresco cada 6 h (o el intervalo que quieras)
[ ] /configure difundido para que la gente use manifests de 12–20 catálogos
[ ] public/robots.txt desplegado (bloquea rutas dinámicas)
[ ] endpoints /internal/* no publicitados
[ ] métricas del Worker revisadas a los 2–3 días
```

## 10. Qué NO cambia con nada de esto

- `/meta` y `/stream` son dinámicos por naturaleza: dependen del id que pide cada persona.
- Un manifest por usuario (`/<config>/...`) nunca será un archivo estático compartido.
- Los enlaces debrid de una cuenta jamás se cachean (ni en estáticos ni en caché compartida).
