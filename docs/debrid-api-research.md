# Investigación de APIs de servicios debrid

**Fecha de consulta:** 2026-11-10. Se consultaron las páginas oficiales enlazadas por cada proveedor. Esto documenta capacidades publicadas; no sustituye una prueba en vivo con cuentas de usuario.

## Resumen ejecutivo

El diagnóstico de partida (antes de esta integración) encontró estos problemas en el flujo antiguo de Real-Debrid:

1. El módulo anterior consultaba `/torrents/instantAvailability`, pero el endpoint dejó de estar disponible en noviembre de 2024 y no aparece en la documentación oficial actual. `GET /torrents` solo enumera torrents de la cuenta del usuario; no reemplaza una consulta de caché global.
2. La interfaz anterior pedía pegar un token API privado de Real-Debrid. La documentación oficial advierte que ese token no debe usarse en aplicaciones públicas y recomienda OAuth2.
3. El flujo antiguo seleccionaba `all` los archivos, sin una comprobación segura de la biblioteca personal.

La decisión de producto fue integrar TorBox, EasyDebrid y Premiumize además de corregir Real-Debrid. En una experiencia explícitamente **«solo contenido ya cacheado; no iniciar descargas»**, esos tres servicios tienen operaciones de lookup documentadas. **Offcloud** publica una consulta de caché, pero su documento oficial es antiguo y requeriría una validación actual. **Debrid-Link** permite enviar un hash que solo se añade si está cacheado, pero la operación muta la cuenta. **AllDebrid** entrega `ready` al subir un magnet, que tampoco equivale a una consulta sin efectos. Real-Debrid no ofrece en la documentación actual la consulta global histórica; por eso la implementación limita RD a su biblioteca personal.

## Comparación

| Servicio | Consulta de caché publicada | Resolución de enlace | Autenticación documentada | Precauciones relevantes |
| --- | --- | --- | --- | --- |
| **Real-Debrid** | El endpoint histórico `/torrents/instantAvailability/{hash}` está desactivado/no se documenta actualmente. `GET /torrents` es la lista de la cuenta, no la caché global. | Añadir magnet, seleccionar archivos y luego obtener/unrestrict el enlace. | OAuth2. Para apps open-source, la documentación describe device flow y credenciales asociadas a cada usuario. | No aceptar el token privado en una app pública. No marcar disponibilidad global con datos de la biblioteca personal. Límite documentado: 250 peticiones/minuto. |
| **AllDebrid** | No encontré una consulta no-mutante de caché en la lista actual de endpoints. `/magnet/upload` devuelve `ready`, pero es una operación de subida del magnet. | `/v4/magnet/files` da archivos/enlaces cuando está listo; endpoints de estado actuales están bajo `/v4.1/magnet/status`. | PIN flow (`/v4.1/pin/get`, `/v4/pin/check`) produce una API key; usar `Authorization: Bearer`. | No usar `upload` para cada resultado si la regla es «nunca iniciar descargas». Límites publicados: 12 req/s y 600 req/min. |
| **Premiumize** | `POST /api/cache/check`, una lista `items[]`; respuesta indexada con `response`, `filename` y `filesize`. La lista de servicios indica cuáles aceptan lookup; la documentación lo describe como best-effort. | `POST /api/transfer/directdl`; para magnet/torrent puede devolver varios archivos y sus URLs. | API key como Bearer u OAuth2; PKCE o device flow disponibles. | Consultar caché antes de pedir el enlace directo. Tratar resultados, cuotas y límites de fair use como respuestas por usuario. No cachear enlaces personales en el borde. |
| **TorBox** | `GET`/`POST /v1/api/torrents/checkcached`, admite hashes por lotes y `list_files`; la documentación dice que el resultado se cachea una hora y que unas 100 consultas tardan menos de un segundo. | `POST /torrents/createtorrent` con `add_only_if_cached=true`; después `/torrents/requestdl` para el archivo. | API token en `Authorization: Bearer` en general. | `createtorrent` tiene límites publicados (300/min globales y 60/h para elementos no cacheados); la bandera `add_only_if_cached` evita añadir misses. `requestdl` requiere el token como parámetro `token`, así que esa llamada debe ocurrir solo en el servidor; no incluir el permalink con API key en Stremio. Los CDN links son temporales y no deben cachearse. No hay selección de archivos al crear torrents; usar `file_id` al pedir el enlace. |
| **Debrid-Link** | La documentación v2 actual no lista un endpoint de cache-check independiente. La operación `POST /seedbox/add` permite pasar un hash; la guía dice que el hash solo se añade si ya está cacheado. | `/seedbox/list` expone `downloadUrl`; los archivos están listos cuando `downloadPercent == 100`. | OAuth2 recomendado o token API privado, en `Authorization: Bearer`. | El hash-only add sirve como comprobación con efecto de añadir a la cuenta el elemento disponible. La documentación dice que la API es para uso personal y no para revender el servicio. Manejar errores mediante el booleano `success`, no solo el código HTTP. |
| **Offcloud** | `POST /api/cache?key=…` acepta un arreglo de infohashes y comprueba si están listos para descarga inmediata. | `/api/instant` entrega una URL para descarga instantánea. | API key, documentada como `?key=` en la URL de la API. | La referencia oficial localizada es de 2018 y no publica límites actuales. La key debe usarse solo desde el backend; evitar logs de URLs, métricas y mensajes que la contengan. Requiere prueba en vivo antes de desplegar. |
| **EasyDebrid** | OpenAPI oficial: `POST /api/v1/link/lookup` devuelve `cached[]`; `/link/lookupdetails` añade archivos, nombres, tamaños y carpetas. | `/api/v1/link/generate` devuelve enlaces de los archivos de la fuente. La descripción general lo presenta como generación para fuentes cacheadas. | OAuth2 en la especificación. | Es un buen candidato para flujo cached-only: primero lookup/detalles y generar solo para hits. La documentación no publica límites de tasa; añadir backoff y límites locales. |
| **Debrider.app** | No localicé una especificación pública de API suficientemente detallada durante esta consulta. | Sin confirmar. | Sin confirmar. | No implementarlo por conjetura; pedir URL o documentación oficial específica antes de desarrollar el adaptador. |

## Hallazgos por proveedor

### Real-Debrid

La documentación oficial confirma OAuth2 para aplicaciones y advierte que el token API privado no debe usarse en aplicaciones públicas. El nuevo flujo canjea el código en el servidor, valida la cuenta, cifra access/refresh tokens y renueva el access token. Nunca acepta un token RD pegado en el formulario.

El endpoint de instant availability no figura en la documentación oficial actual. `GET /torrents` se usa únicamente como biblioteca personal; el adaptador solo resuelve torrents `downloaded` que ya pertenecen a esa cuenta. No hace una afirmación de disponibilidad global ni llama a rutas de agregar/seleccionar archivos.

### TorBox

Es la API más directa para una integración segura de solo cacheados: consultar `/checkcached`, inspeccionar los archivos con `list_files`, y crear el torrent únicamente con `add_only_if_cached=true`. La combinación de la consulta y la bandera en el endpoint de creación da defensa en profundidad. Los links de descarga son temporales; el permalink recomendado por su documentación incluye la API key como `token`, por lo que no se debe publicar ese permalink en un manifest. Solicitar el link desde el servidor y devolver la URL de descarga resultante con política `no-store`.

### EasyDebrid

Su OpenAPI oficial expone `lookupdetails` y `generate`. El adaptador usa Bearer y solo llama a `generate` tras un `cached: true`. La OpenAPI describe OAuth2, mientras algunas guías del proveedor hablan de API key; el código trata la clave introducida como Bearer. **La autenticación y los cuerpos/respuestas aún requieren una prueba en vivo**; las pruebas del repositorio simulan las formas documentadas y no prueban una cuenta real. La respuesta queda acotada por `DEBRID_MAX_RESULTS`.

### Premiumize

Tiene una verificación previa de caché y una operación separada para generar los enlaces directos. Una fuente torrent puede producir varios elementos, así que el addon debe seleccionar el archivo de vídeo correcto (y el episodio correcto en packs), no asumir que la respuesta es un único enlace.

### AllDebrid y Debrid-Link

Ambos tienen flujos de autorización aptos para usuarios (PIN en AllDebrid; OAuth2 recomendado en Debrid-Link). Sin embargo, sus rutas de magnets no equivalen a un endpoint de lookup no-mutante: en AllDebrid la señal `ready` aparece como parte de la operación de upload; en Debrid-Link el patrón actual es enviar el hash como `seedbox/add`, que solo se acepta cuando ya está cacheado. Si se habilitan, hay que informar de ese efecto de cuenta, deduplicar por hash y limpiar/evitar entradas duplicadas según las reglas del proveedor.

## Diseño implementado y verificaciones pendientes

- Adaptadores independientes para TorBox, EasyDebrid, Premiumize y Real-Debrid; dispatcher común con límite de concurrencia, timeout y fallback a los magnets públicos.
- El vault cifra credenciales AES-GCM (formato v2) y la URL de Stremio solo recibe un ID opaco y proveedor. Las credenciales privadas no se incluyen en streams ni en caché HTTP compartida.
- TorBox recibe `add_only_if_cached=true` como segunda barrera tras el cache check y `seed=false`. Puede añadir el resultado cacheado a la cuenta, como advierte la interfaz.
- EasyDebrid: `lookupdetails` positivo antes de `generate`. Premiumize: `cache/check` positivo antes de `transfer/directdl`, que es best-effort.
- Real-Debrid usa autorización OAuth, state atado a cookie, intercambio/renovación server-side y solo torrents `downloaded` de la biblioteca personal. No añade magnets ni afirma cache global. La biblioteca se recorre con `page` y `limit=500`, hasta 20 páginas y con un presupuesto total de 15 s; un resultado incompleto por alcanzar cualquiera de los topes no se cachea como una ausencia definitiva.
- La referencia oficial directa no estuvo disponible al auditar el endpoint. La colección Postman y el cliente `pyrd` describen un máximo de 5000 por página; un proyecto de integración activo (`torboxed`, actualizado en octubre de 2026) solicita 500 por página y pagina hasta una página corta. Un cliente Android más antiguo menciona 100, así que se adoptó 500 como tamaño moderado y con paginación, no se trata el máximo como verificado por la documentación oficial actual.
- La selección de archivos filtra vídeos, descarta samples y elige el episodio si el nombre lo permite; ante dudas debe conservarse el magnet normal en vez de devolver un enlace incorrecto.
- Las pruebas automatizadas mockean las API y cubren hit/miss, almacenamiento cifrado, OAuth, no-cache de respuestas personalizadas y fallback. **No se han ejecutado contra cuentas reales**, y no prueban todos los límites/variantes del proveedor.
- Antes de considerar la integración validada en producción: comprobar con cuentas de prueba los schemas/auth reales de EasyDebrid (OAuth2 vs API key), verificar respuestas actuales de los cuatro servicios, probar links/expiración, y confirmar la política de uso de cada API. Vercel no tiene un backend KV configurado. En Cloudflare Worker se requiere `DEBRID_ENCRYPTION_KEY`; `DEBRID_KV` da almacenamiento duradero (se crea con `npm run debrid:kv`) y, sin ella, el Worker guarda las credenciales cifradas en su Cache API (por datacenter y expulsable).

## Fuentes oficiales consultadas

- [Real-Debrid API](https://api.real-debrid.com/)
- [AllDebrid API v4](https://docs.alldebrid.com/)
- [Premiumize API](https://www.premiumize.me/api)
- [TorBox API](https://api-docs.torbox.app/)
- [Debrid-Link API v2: introducción](https://debrid-link.com/api_doc/v2/introduction) y [añadir torrent](https://debrid-link.com/api_doc/v2/seedbox-add)
- [Offcloud API oficial (GitHub)](https://github.com/Offcloud/offcloud-api)
- [EasyDebrid OpenAPI](https://easydebrid.com/apidoc/index.html)

## Fuentes de corroboración de cambios de Real-Debrid

- [Incidente de endpoint deshabilitado en rdt-client](https://github.com/rogerfar/rdt-client/issues/617)
- [Análisis contemporáneo de TorrentFreak, noviembre de 2024](https://torrentfreak.com/real-debrid-implements-extreme-anti-piracy-filters-to-appease-film-companies-241122/)


---

## Verificación documental del 2026-11-12 (contra las documentaciones oficiales)

Se volvieron a consultar las documentaciones citadas y se corrigieron tres cosas
del adaptador TorBox y de la capa común de red. Lo de abajo es lo que dicen hoy las
fuentes oficiales y qué se hizo con cada dato.

### TorBox — `https://api-docs.torbox.app/` (y SDKs oficiales `TorBox-App/*`)

- Base real: `https://api.torbox.app` + versión `v1`, es decir `https://api.torbox.app/v1/api` ✅ ( coincide con el adaptador).
- Envoltorio estándar: `{ success, error, detail, data }`. La documentación dice
  literalmente que **el código 200 siempre es éxito y el 403 es un error de
  autenticación**; 400 = entrada incorrecta; 500 = cosa de TorBox. La tabla de
  errores publica `NO_AUTH` (sin credenciales), `BAD_TOKEN` (token inválido),
  `AUTH_ERROR`, `ENDPOINT_NOT_FOUND`, `PLAN_RESTRICTED_FEATURE`, `DUPLICATE_ITEM`,
  `MONTHLY_LIMIT`, `COOLDOWN_LIMIT`, `ACTIVE_LIMIT`, etc.
  → **Cambio:** un 403/401 ya no se traduce a ciegas en «clave inválida»: si el
  cuerpo es JSON del proveedor, sí lo es; si es HTML (bloqueo del borde), se
  reporta como `provider_blocked`.
- `POST /torrents/createtorrent` acepta: `magnet` o `file`, `name`, `as_queued`,
  `allow_zip`, `add_only_if_cached` y **`seed`, que es un entero: 1=auto,
  2=sembrar, 3=no sembrar**. El adaptador mandaba `seed=false`.
  → **Cambio:** se envía `seed=3`, que es lo que la documentación entiende como
  «no sembrar». `add_only_if_cached=true` queda confirmado como parámetro real.
- `GET /torrents/requestdl` exige el `token` como parámetro de consulta (documentado
  así) y su enlace caduca (≈3 h para empezar la descarga). La documentación recomienda
  el *permalink* `…/requestdl?token=…&redirect=true` para ahorrar llamadas: **no** se
  usa, porque metería la API key del usuario en el manifest/URL de Stremio.
- Límites: **300 peticiones/minuto** por token; `createtorrent` 300/min para
  elementos cacheados y **60/h** para los no cacheados. `checkcached` se cachea
  una hora en su lado (por eso el TTL local de disponibilidad es de 30 min).
- `/user/me?settings=false` es el endpoint de identidad y devuelve `id`, `plan`,
  `is_subscribed`, `premium_expires_at`, `total_downloaded`… → la validación ahora
  aprovecha `is_subscribed`/`premium_expires_at` para avisar de «clave válida,
  cuenta sin plan» en vez de dejar que el fallo aparezca después, sin streams.

### Real-Debrid — `https://api.real-debrid.com/`

- **Confirmado**: la documentación actual no publica `GET /torrents/instantAvailability`.
  La sección `/torrents` solo lista `GET /torrents`, `GET /torrents/info/{id}`,
  `activeCount`, `availableHosts`, `addTorrent`, `addMagnet`, `selectFiles`, `delete`.
  Seguir limitándose a la biblioteca personal es, por tanto, lo correcto.
- **Corrección a la nota de investigación previa**: `GET /torrents` sí documenta
  `limit` («must be within 0 and 5000, default: 100») y `page`, y **no** se puede usar
  `offset` y `page` a la vez (gana `page`). El tope de 500 por página que usa el
  adaptador queda dentro de lo documentado; la advertencia anterior («no verificado»)
  queda zanjada.
- Autenticación: `Authorization: Bearer your_api_token`, y se admite `?auth_token=` como
  último recurso — no lo usamos. La propia documentación avisa: «Never ever use your
  private API token for public applications» ✅ (coherente con exigir OAuth).
- Límite: **250 peticiones/minuto**; los rechazos cuentan y puede bloquear la IP.
- Códigos `error_code` publicados (útiles para no dar un diagnóstico falso): 8 *Bad token*,
  9 *Permission denied*, 14 *Account locked*, 22 *IP Address not allowed*,
  25 *Service unavailable*, 34 *Too many requests*, 36 *Fair Usage Limit*,
  **37 *Disabled endpoint*** (el del cambio de noviembre de 2024).
  → `lib/debridShared.js` traduce estos números a códigos propios.

### Premiumize — `https://www.premiumize.me/api`

- Autenticación: **Bearer con la API key a secas** (`Authorization: Bearer KEY`); el
  `customer_id` solo se necesita en las variantes legacy `?apikey=`/`?pin=`. El
  adaptador ya lo hacía bien; lo que fallaba era la interpretación del error.
- El error llega como `{ "status": "error", "message": "…", "code": … }` — con
  `message`, no con un `code` de texto. Antes solo se reconocía
  `code === 'authentication_failed'`, así que «Wrong API key or other credentials»
  se convertía en un 502 genérico. → Ahora el mensaje manda.
- `GET /account/info` → `customer_id`, `premium_until` (`null` en cuentas gratis) y
  `limit_used`; `POST /api/cache/check` → arrays paralelos `response[]`,
  `filename[]`, `filesize[]` ✅ (como los lee el adaptador).

### EasyDebrid — `https://easydebrid.com/apidoc/index.html` (OpenAPI 1.2.0)

- Servidor real: **`https://easydebrid.com/api/v1`** ✅ (no `api.easydebrid.com`).
- `GET /user/details` → `{ "id": 123123123, "paid_until": "2023-10-01" }`;
  `POST /link/lookup` → `{ "cached": [true, false] }`;
  `POST /link/lookupdetails` → `{ "result": [ { "cached": true, "files": [ { "size", "name", "folder" } ] } ] }`;
  `POST /link/generate` → `{ "files": [ { "filename", "directory": [], "size", "url" } ] }`.
  El adaptador lee exactamente esas formas ✅.
- La especificación declara **solo OAuth2** como autenticación y no publica límites de
  tasa. En la práctica el panel entrega una API key que se manda como Bearer; si el
  proveedor empieza a responder 3xx/HTML en lugar de JSON, el addon ahora lo dice
  (`provider_login_redirect`) en vez de culpar a la clave del usuario.
- `paid_until` se usa para avisar de suscripción caducada.
- Comprobado en vivo contra `https://easydebrid.com/api/v1/user/details`: cuando la
  petición no se reconoce como llamada de API, EasyDebrid **redirige al login HTML**
  en vez de responder 401 en JSON. Con `redirect: 'error'` eso era un `TypeError`
  opaco; ahora la 3xx se reporta como `provider_login_redirect` y la redirección no
  se sigue (el `Bearer` no puede salir hacia otro origen).

### Capa común (`lib/debridShared.js`)

- **`User-Agent` explícito en todas las llamadas a proveedores.** Cloudflare Workers
  no envían `User-Agent` en `fetch()`, y TorBox/Real-Debrid/Premiumize están detrás de
  Cloudflare: un agente vacío es el patrón que cortan las reglas anti-bots, con 403 +
  HTML. Ese 403 **no** es una credencial inválida, pero el código anterior lo
  presentaba así (`err.status === 403` → «El proveedor rechazó la clave API»). Es la
  causa más probable de un «no me valida TorBox» con una clave buena.
- `redirect: 'manual'`: no se sigue ninguna redirección (el Bearer no puede salir del
  origen) y una 3xx se reporta como lo que es.
- Clasificación de fallos: `provider_timeout`, `provider_unreachable`,
  `provider_blocked`, `provider_rate_limited`, `provider_endpoint_missing`,
  `provider_login_redirect`, `provider_account_locked`, `provider_ip_blocked`,
  `provider_fair_usage`, `provider_endpoint_disabled`, `invalid_credential`.
- Un reintento corto **solo** en validación de credenciales y solo para fallos de
  transporte; nunca para «clave inválida» (no se debe martillar la cuota del proveedor).
- Plazo propio para validar (`DEBRID_VALIDATE_TIMEOUT_MS`, 9 s) frente al plazo corto de
  resolución de streams (`DEBRID_TIMEOUT_MS`, 4,5 s).
- Normalización de la clave pegada (espacios interiores, comillas, prefijo `Bearer `),
  con rechazo por **forma** (`credential_format`) antes de gastar una llamada.

