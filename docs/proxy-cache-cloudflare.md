# Proxy con caché de Cloudflare para miles de personas

Fecha: 21-11-2026 · Rama `arena/06756792-sas5`

## Respuesta corta

Para **miles de personas** hay dos proxies distintos y no se escalan igual:

| Qué se proxya | ¿Aguanta miles? | Por qué |
|---|---|---|
| **Respuestas del addon** (`/catalog`, `/meta`, `/stream`, portada) | **Sí**, con dominio propio + Cache Rules | Un acierto de caché se sirve en el borde **sin ejecutar el Worker**: 0 invocaciones y 0 subpeticiones. |
| **Vídeo/HLS** (manifiestos, variantes, segmentos) | **Solo con Workers Paid + dominio propio + Cache Rules**, y con riesgos | Cada segmento es una invocación si no hay acierto; el plan gratuito son 100.000/día para toda la cuenta. Además, Cloudflare restringe servir vídeo de terceros por su CDN. |

El proxy de medios ya está implementado (`lib/mediaProxy.js`, ruta `/p/...`) pero **apagado por defecto**. Sin `MEDIA_PROXY=on`, `PROXY_SECRET` y `PROXY_ALLOWED_HOSTS` la ruta responde 404 y los streams siguen saliendo directos, como hasta ahora.

**Recomendación para un addon con miles de usuarios:** no retransmitir vídeo salvo que sea imprescindible para un CDN concreto. El vídeo directo escala sin coste porque Cloudflare no lo toca; el texto del addon se cachea en el borde y cuesta céntimos.

---

## 1. Los límites que deciden el diseño

| Límite | Plan gratuito | Workers Paid |
|---|---|---|
| Peticiones al Worker | **100.000/día** por cuenta | 10 millones/mes incluidas; después **0,30 USD/millón** |
| CPU por invocación | 10 ms | hasta 5 min (30 M CPU-ms/mes incluidas) |
| Subpeticiones por invocación | 50 | 1.000 |
| Ancho de banda | sin cargo | sin cargo |

Otros hechos que ya documenta el código:

- **La Cache API no hace nada en `*.workers.dev`.** Cloudflare lo dice tal cual: cualquier operación de Cache API en un despliegue `*.workers.dev` no tiene efecto. Por eso `lib/responseCache.js` mantiene la caché en memoria del isolate. Para que un acierto no invoque el Worker hace falta **dominio propio en una zona de Cloudflare**.
- **Cloudflare no cachea respuestas `206`** (Range). Un MP4 troceado nunca se cachea; HLS con segmentos completos sí.
- **Si el Worker se ejecuta, la petición se cobra**, aunque responda desde la caché del isolate. El ahorro grande es que la petición **no llegue** al Worker.
- Una respuesta de Worker solo se guarda en el borde si una **Cache Rule** marca la ruta como elegible y la respuesta trae `Cache-Control` público. `Cache-Control: no-store` (streams parciales, claves HLS) nunca se cachea.

### Términos de Cloudflare y vídeo

El acuerdo de autoservicio restringe usar el CDN para servir vídeo o una proporción desproporcionada de contenido no HTML **alojado fuera de Cloudflare**: está permitido si el contenido vive en Stream, Images o R2. La actualización de términos de 2023 lo dejó explícito: el vídeo alojado fuera de Cloudflare sigue restringido aunque se pueda usar el proxy.

Referencia: [blog.cloudflare.com/updated-tos](https://blog.cloudflare.com/updated-tos/)

Es decir: retransmitir el HLS de un CDN ajeno a través de una zona gratuita o Pro es, como mínimo, un riesgo de suspensión. Si el proyecto crece, la vía legítima es alojar el contenido en R2/Stream o no retransmitir.

---

## 2. Los dos proxies

### A. Caché de borde para las respuestas del addon (lo que escala)

No es un proxy de terceros: es cachear **tu propio** JSON/HTML en el borde.

```
Stremio ──► Cloudflare (Cache Rule) ──► HIT: responde el borde (0 invocaciones)
                                    └─► MISS: Worker → TMDB/proveedores → se guarda
```

- Rutas: `/catalog/*`, `/meta/*`, `/stream/*`, `/manifest.json`, `/`, `/configure`.
- Claves canónicas ya implementadas (`/__edge/...`) para que dos configuraciones equivalentes compartan entrada.
- `stale-while-revalidate` y `stale-if-error` ya van en las cabeceras; el borde puede servir caducado mientras refresca.
- Además, `public/` (logo, iconos, catálogos pregenerados) se sirve como static asset: **0 invocaciones incluso en el plan gratuito**.

Con esto, miles de usuarios que piden los mismos catálogos generan muy pocas invocaciones reales.

### B. Proxy de medios `/p/...` (opcional)

```
Stremio ──► /p/<destino firmado> ──► HIT: borde (0 invocaciones)
                                  └─► MISS: Worker → CDN (con Referer/Origin) → se guarda
```

Diseño implementado:

- **Firma HMAC-SHA256 determinista** sobre `destino + referer`, sin nonce ni caducidad por usuario. Dos personas que ven el mismo capítulo reciben la **misma URL** y comparten caché. Rotar `PROXY_SECRET` invalida todas las URLs emitidas.
- **Allowlist de hosts** (`PROXY_ALLOWED_HOSTS`): solo esos dominios y sus subdominios. Se rechazan credenciales en la URL, `localhost`, rangos privados y destinos que no sean medios.
- **El destino va en la ruta** (`/p/<base64url>`), no en `?url=`, para que una Cache Rule cubra `/p/*` sin abrir un proxy genérico.
- **Cabeceras**: el Worker añade `Referer`/`Origin` del reproductor y retira `proxyHeaders` del stream para no duplicar saltos.
- **Caché**: segmentos (`ts`, `m4s`, `aac`, `vtt`…) `max-age=86400, immutable`; manifiestos `max-age=60`; claves HLS y respuestas `206` `no-store`.
- **Redirecciones** se siguen hasta 3 saltos y se revalidan contra la allowlist.
- **Errores del CDN no se cachean** ni se reenvían con cuerpo.
- **Timeout** configurable (`PROXY_TIMEOUT_MS`, 20 s por defecto).
- **Solo se emite desde el Worker.** `searchStreams` necesita que el runtime declare su origen público (`runtime.origin`). En el servidor Express/Vercel no existe `/p/`, así que los enlaces siguen directos aunque la variable esté puesta: un despliegue Node no publica URLs rotas.

---

## 3. Cuánto cuesta de verdad

Un capítulo de 45 min con segmentos de 6 s son **~450 segmentos**; una hora, **~600**. Cada segmento que no esté en caché es una invocación.

### Plan gratuito (100.000/día)

```
100.000 invocaciones ÷ 600 segmentos/hora ≈ 166 horas de reproducción/día
```

Es decir: **~166 personas viendo una hora**, y sin contar manifiestos ni el resto del addon. Para miles de personas, el plan gratuito no llega ni de lejos.

### Workers Paid (10 M incluidas, 0,30 USD/millón extra)

| Escenario | Invocaciones/día | Invocaciones/mes | Factura aprox. |
|---|---:|---:|---:|
| 1.000 personas viendo **el mismo** contenido (caché compartida) | ~10.000 | 0,3 M | **5 USD** |
| 1.000 personas viendo **contenido distinto**, 2 h/día | ~1,2 M | 36 M | **~13 USD** |
| 10.000 personas, contenido distinto, 2 h/día | ~12 M | 360 M | **~110 USD** |
| 50.000 personas, contenido distinto, 2 h/día | ~60 M | 1.800 M | **~540 USD** |

Supuestos: 80 % de aciertos de caché, 600 segmentos por hora, un manifiesto por reproducción. Si el acierto baja al 50 %, multiplica la columna de invocaciones por 2,5.

El addon de texto es despreciable en comparación: 10.000 usuarios × 40 peticiones/día = 400.000/día, y con caché y prerender la mayoría no invoca el Worker.

---

## 4. Puesta en marcha

### 4.1 Dominio propio (obligatorio para cachear)

1. Añade el dominio a Cloudflare (zona).
2. En `wrangler.toml`, apunta el Worker a una ruta de la zona:

```toml
# routes = [
#   { pattern = "addon.tudominio.com/*", zone_name = "tudominio.com" }
# ]
```

Sin esto, el despliegue sigue en `*.workers.dev`, donde **todo** lo que pase por `/p/` invoca el Worker y no hay caché de borde posible.

### 4.2 Variables y secreto

```sh
# Secreto de firma: 32 bytes aleatorios. No lo pongas en wrangler.toml.
openssl rand -base64 32 | npx wrangler secret put PROXY_SECRET
```

En `wrangler.toml`:

```toml
[vars]
MEDIA_PROXY = "on"
# Solo los CDN que de verdad necesitan Referer/Origin. Empieza por uno.
PROXY_ALLOWED_HOSTS = "vimeos.net"
# PROXY_MANIFEST_TTL = "60"
# PROXY_SEGMENT_TTL  = "86400"
# PROXY_TIMEOUT_MS   = "20000"
```

Si falta el secreto o la allowlist, `/healthz` informa `mediaProxy.ready: false` y `/p/` responde 404.

### 4.3 Cache Rule sobre `/p/*`

Dashboard → **Caching → Cache Rules → Create rule**:

- **When incoming requests match:** `starts_with(http.request.uri.path, "/p/")`
- **Cache eligibility:** Eligible for cache
- **Edge TTL:** Use cache-control header if present, bypass cache if not
- **Browser TTL:** Respect origin TTL
- **Cache key:** URL completo, incluida la query string (por defecto)

Equivalente por API (Rulesets):

```json
{
  "rules": [
    {
      "description": "RamdonLatam · proxy de medios con caché de borde",
      "expression": "starts_with(http.request.uri.path, \"/p/\")",
      "action": "set_cache_settings",
      "action_parameters": {
        "cache": true,
        "edge_ttl": { "mode": "respect_origin" },
        "browser_ttl": { "mode": "respect_origin" }
      }
    }
  ]
}
```

Repite el mismo criterio para `/catalog/`, `/meta/`, `/stream/` y `/__edge/` si aún no tienes reglas para ellas: son las que convierten miles de usuarios en pocas invocaciones.

### 4.4 Límite de abuso

Crea una **Rate Limiting Rule** sobre `/p/*` (p. ej. 60 peticiones/minuto por IP). La firma evita que terceros inventen destinos, pero una URL firmada es pública para quien la reciba: el límite de tasa evita que un solo cliente consuma la cuota de todos.

### 4.5 Verificación

```sh
# 1. El proxy está listo
curl -s https://addon.tudominio.com/healthz | jq .mediaProxy

# 2. Una URL de stream debe salir por /p/
curl -s https://addon.tudominio.com/stream/movie/tt0816692.json | jq -r '.streams[].url'

# 3. Dos peticiones seguidas: la segunda debe ser HIT y no llevar marca del Worker
curl -sI "<url-firmada>" | grep -iE 'cf-cache-status|cache-control|x-catalogos-runtime'
```

En un HIT de verdad: `cf-cache-status: HIT` y **no** aparece `x-catalogos-runtime: worker` (esa cabecera solo la añade el Worker al ejecutarse). Es la misma auditoría que hace `npm run scale:audit`.

La sonda `node scripts/worker-streams-live.js --playback` **omite** los candidatos con proxy (los cuenta como `con proxy (omitidos)`); para validar `/p/` usa el `curl` anterior.

---

## 5. Riesgos que hay que asumir

1. **Términos de Cloudflare:** servir vídeo de terceros por el CDN puede provocar suspensión. Un despliegue con miles de usuarios y vídeo proxado es justo el caso que Cloudflare vigila.
2. **El 403 puede seguir:** el CDN puede rechazar también la IP del Worker. Ya pasó con la antigua `/hls` (CDN 403 → proxy 502). Probar con `curl` antes de anunciarlo.
3. **Coste variable:** el vídeo proxado se paga por petición; un título nuevo sin caché cuesta como si cada espectador fuera único.
4. **Derechos de autor:** el addon no aloja nada, pero al retransmitir desde tu dominio el tráfico pasa a ser tuyo. Es una decisión distinta a enlazar.
5. **Firma pública:** quien reciba una URL firmada puede reutilizarla hasta que caduque el token del CDN. Rotar `PROXY_SECRET` corta todas; el JSON de `/stream` en caché tarda como mucho 300 s en reflejarlo.

---

## 6. Qué no hacer

- **Activar `/p/` en `*.workers.dev`.** No hay caché de borde: cada segmento invoca el Worker y se paga.
- **Convertirlo en proxy abierto** (`?url=` sin firma, allowlist vacía o `*`). La allowlist no admite comodines a propósito.
- **Proxyar MP4 con Range como caso principal.** Los `206` no se cachean; cada salto de reproducción vuelve a invocar.
- **Cachear claves HLS.** Van con `no-store`; son por sesión.
- **Confiar en la caché en memoria para vídeo.** El isolate se recicla y los segmentos pesan demasiado; la memoria es para JSON pequeño.

---

## 7. Decisión recomendada

Para miles de personas, en este orden:

1. Dominio propio + Cache Rules para el texto del addon + prerender de catálogos. **Esto es lo que hace que el addon aguante.**
2. Workers Paid (5 USD/mes) para no depender de 100.000 peticiones/día.
3. Vídeo directo. `proxyHeaders` de Stremio sigue cubriendo los CDN que solo piden `Referer`.
4. Solo si un CDN concreto no funciona ni directo ni con Stremio: activar `MEDIA_PROXY` **únicamente para ese host** y vigilar la factura el primer mes.
