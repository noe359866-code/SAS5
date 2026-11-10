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
- Real-Debrid usa autorización OAuth, state atado a cookie, intercambio/renovación server-side y solo torrents `downloaded` de la biblioteca personal. No usa el endpoint histórico de disponibilidad, no añade magnets y no afirma cache global.
- La selección de archivos filtra vídeos, descarta samples y elige el episodio si el nombre lo permite; ante dudas debe conservarse el magnet normal en vez de devolver un enlace incorrecto.
- Las pruebas automatizadas mockean las API y cubren hit/miss, almacenamiento cifrado, OAuth, no-cache de respuestas personalizadas y fallback. **No se han ejecutado contra cuentas reales**, y no prueban todos los límites/variantes del proveedor.
- Antes de considerar la integración validada en producción: comprobar con cuentas de prueba los schemas/auth reales de EasyDebrid (OAuth2 vs API key), verificar respuestas actuales de los cuatro servicios, probar links/expiración, y confirmar la política de uso de cada API. Vercel no tiene un backend KV configurado; en Cloudflare Worker se requiere `DEBRID_KV` y `DEBRID_ENCRYPTION_KEY`.

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
