# Auditoría de los servicios debrid — 17/11/2026

Rama `arena/b2c60ee9-sas5` · commit base `1c568f6` · 1.745 líneas revisadas en 10 ficheros.

## Veredicto en una página

La arquitectura está bien pensada y el código está por encima de la media de este tipo de integraciones: semántica de caché correcta por proveedor, `add_only_if_cached` como segunda barrera, `redirect: 'manual'` para no filtrar el Bearer, cifrado AES-GCM con AAD, OAuth con `state` en cookie `HttpOnly` y comparación en tiempo constante, y degradación a magnets públicos en todos los caminos. Nada de eso hay que tocarlo.

El problema no está en lo que hace el código, sino en **cuánto calla cuando no lo consigue**. Hay tres fallos que dejan al usuario con un estado que la interfaz pinta como correcto y que en realidad está roto: credenciales que se "guardan" en un almacén que no guarda, fallos de resolución sin una sola línea de log, y un refresh de Real-Debrid que, al fallar una vez, mata la conexión para siempre. Los tres son silenciosos por construcción, no por descuido puntual.

| # | Hallazgo | Severidad | Fichero |
|---|---|---|---|
| C1 | Sin `DEBRID_KV`, el respaldo es la Cache API, que en `*.workers.dev` no guarda nada (`put` nunca falla) → connect responde 200 y la credencial desaparece a los 5 min | **Crítica** | `debridCredentials.js:44-61,157-190` |
| C2 | Fallo de resolución invisible: 5 `catch (_) { return null; }` + `streamsFor` devuelve `[]` sin log si no hay credencial o token | **Crítica** | los 4 adaptadores, `debridStreams.js:16-22` |
| C3 | Refresh de RD: si `updateCredential` falla se descarta el refresh token rotado → `invalid_grant` permanente y silencioso | **Crítica** | `realDebridOAuth.js:147-158` |
| A1 | Presupuesto de 4,5 s contra un trabajo real de 9-18 s: el enriquecimiento casi nunca se ve, pero sigue corriendo en `waitUntil` **con efectos de cuenta** | Alta | `streams.js:1863-1870` |
| A2 | `status.debrid` y `status.debridSlow` se calculan y nadie los lee; `diagnose()` no ejercita debrid → sin observabilidad ni forma de probarlo en producción | Alta | `streams.js:1862,1867` |
| A3 | Desconectar no es inmediato: hasta 5 min de credencial válida en otros isolates | Alta | `debridCredentials.js:31,278-289` |
| A4 | Registros huérfanos sin TTL: `kv.put` sin `expirationTtl`, sin listado ni revocación global | Alta | `debridCredentials.js:170` |
| M1 | `DUPLICATE_ITEM` de `createtorrent` no se reintenta → segunda visualización sin stream | Media | `torbox.js:203-219` |
| M2 | Clave de cifrado = SHA-256 simple del secreto, sin KDF | Media | `debridCredentials.js:113-117` |
| M3 | EasyDebrid descansa en un esquema no verificable (su doc pública da 404) y `assertEasyDebrid` exige `id` | Media | `easyDebrid.js:24-40` |
| M4 | Rate limit por `req.ip` en Express sin `trust proxy` → límite compartido por todos en Vercel | Media | `api/index.js:232` |
| B1-B4 | Token de TorBox en query string (documentado), doble `availability.get`, `record.version=2` con sobre `v3`, `require` repetido | Baja | varios |

---

## C1 · El respaldo sin KV es un almacén que no almacena

`lib/debridCredentials.js` cae a `caches.default` cuando no hay `DEBRID_KV`:

```js
const edge = edgeCache();
if (edge) return { kind: 'cache', cache: edge };
```

y `edgeCache()` solo comprueba que los tres métodos existan, no que funcionen. Eso importa porque, según la documentación de Cloudflare, las operaciones de Cache API solo están garantizadas en dominios propios y en Pages; el despliegue por defecto de este proyecto —el que explica el README §3.4— es `*.workers.dev`, y el propio `docs/escala-plan-free.md` afirma que allí la Cache API es un no-op. Además `cache.put()` **resuelve a `undefined` aunque no guarde nada**: no hay error que capturar.

Reproducido en el sandbox con un `caches.default` que no guarda (lo que hace `workers.dev`):

```
storageKind: cache | isConfigured: true
connect -> 200 con credentialId, pese a que el put no guardó nada
lectura inmediata (caché del isolate, 5 min): OK
lectura tras 5 min (KV/Cache real): null
=> streamsFor() devuelve [] en silencio
```

Es decir: `/configure` dice «Conectado a TorBox», el manifest se genera con `debridId`, y cinco minutos después —o en el siguiente datacenter— `streamsFor` no encuentra la credencial, devuelve `[]` y **no registra nada**. El usuario ve solo magnets y no tiene forma de saber que su cuenta debrid nunca se guardó.

Agrava el cuadro que `createCredential` no verifica la escritura: no hay lectura de comprobación tras el `put`, así que el 200 es una promesa que el código no ha cumplido.

**Corrección propuesta:** (1) lectura de verificación tras escribir y `debrid_storage_not_configured` si no vuelve; (2) que `storageKind()` distinga «cache» de «cache verificado» y que `/healthz` y `/configure` lo digan; (3) considerar KV obligatoria en producción en lugar de presentar la Cache API como equivalente.

## C2 · El camino de error no deja rastro

En los cuatro adaptadores, la resolución termina siempre igual:

```js
} catch (_) {
  return null;
}
```

`torbox.js:219`, `realDebrid.js:71,131`, `easyDebrid.js:88`, `premiumize.js:86`. Y en el orquestador:

```js
const record = await credentials.getCredential(credentialId, env);
if (!record) return [];
if (!adapter) return [];
...
if (!token) return [];
```

`debridStreams.js:16-22`. Ninguno de esos seis puntos escribe en el log. Solo se registra el fallo del `checkCached` global (`debridStreams.js:47`), que es el caso menos frecuente: la comprobación de caché suele ir bien y lo que falla es la generación del enlace.

Consecuencia práctica: cuando un usuario dice «mi TorBox no da streams», no hay absolutamente nada en `wrangler tail`. Y como `/configure` deduce el estado del `debridId` de la URL y no de una comprobación del servidor, la interfaz seguirá diciendo «Conectado» indefinidamente.

**Corrección propuesta:** un `console.error('[Debrid] <provider> resolve falló: <code>')` en cada `catch`, con el código y sin datos de cuenta; y un `console.warn` en los `return []` tempranos. Con eso `wrangler tail` pasa de inútil a suficiente.

## C3 · Un refresh fallido mata la conexión de RD para siempre

```js
const updated = { ..., refreshToken: token.refresh_token || current.refreshToken, ... };
await credentials.updateCredential(credentialId, updated, env);
return updated.accessToken;
```

`realDebridOAuth.js:156-157`. Real-Debrid rota el refresh token en cada canje. `updateCredential` devuelve `false` en tres casos —id inválido, registro que no normaliza, o `getCredential` que no devuelve nada— y el resultado se ignora. Si la escritura no se aplica, el refresh token nuevo se pierde y el siguiente intento usa el viejo: `invalid_grant`, y `getAccessToken` lo convierte en `null` con un `catch (_) { return null; }`. A partir de ahí `streamsFor` devuelve `[]` para siempre, sin log, hasta que el usuario vuelva a pasar por OAuth.

Es el caso más dañino de los tres porque es **permanente** y porque se dispara justo cuando el almacenamiento está degradado, es decir, se combina con C1.

**Corrección propuesta:** comprobar el retorno de `updateCredential`; si es `false`, reintentar la escritura una vez y, si vuelve a fallar, no devolver el token nuevo (mejor un refresh fallido visible que uno silencioso que quema la sesión).

## A1 · 4,5 s de presupuesto contra un trabajo de 9-18 s

```js
const enrichment = debridStreams.streamsFor(...);
const result = await withDeadline(enrichment, config.debridTimeoutMs || 4500);
if (result.timedOut) {
  scheduleBackground(enrichment, runtime);
```

`streams.js:1863-1870`. En el peor caso real: `checkCached` (4,5 s) + `mylist` (4,5 s) + `createtorrent` (4,5 s) + `requestdl` (4,5 s) = 18 s por hit, con dos resolves en paralelo. El presupuesto de 4,5 s lo cubre solo cuando la comprobación de caché va rápida *y* el torrent ya está en la cuenta. En la práctica, `debridSlow` se activará casi siempre en la primera visualización.

Y el `scheduleBackground` no es inocuo: la continuación puede llegar a `createCachedTorrent` y **añadir el torrent a la cuenta de TorBox del usuario después de que Stremio ya haya pintado solo los magnets**. El usuario nunca ve ese stream, pero el elemento queda en su cuenta y consume cuota (60/h para no cacheados).

**Corrección propuesta:** separar el enriquecimiento en dos fases con presupuesto propio (comprobar caché con 2 s; resolver con el resto) y, sobre todo, no dejar correr en segundo plano la fase que muta la cuenta: si el cliente ya no espera, se aborta antes de `createtorrent`.

## A2 · El estado se calcula y se tira

`status.debrid = true` (`streams.js:1862`) y `status.debridSlow = true` (`:1867`) no los lee nadie: `handleStream` devuelve solo `{ streams, cacheMaxAge }` (`core.js:88`). Y `diagnose()` —el endpoint `/internal/streams-test.json`— no toca debrid en ningún punto, porque llama a `streams.diagnose(type, testId, null)` con `cfg = null`.

Resultado: no hay manera de comprobar en producción que el camino debrid funciona, ni de decirle a un usuario por qué no ve el enlace directo. Es la mitad del problema de C2, en la capa de arriba.

**Corrección propuesta:** exponer `debrid` y `debridSlow` en un campo de diagnóstico (no en la respuesta de Stremio) y añadir a `diagnose` una fase opcional que reciba un `debridId` y reporte qué respondió el proveedor, con los mismos códigos de `PROVIDER_MESSAGES`.

## A3 · Desconectar no desconecta

`disconnect` borra el registro y limpia los prefijos de la caché **del isolate actual** (`debridCredentials.js:278-289`). La copia en RAM de otros isolates vive 300 s (`CREDENTIAL_CACHE_TTL`), y la KV tarda en propagar. Durante esa ventana la URL filtrada sigue generando enlaces.

**Corrección propuesta:** documentarlo como «puede tardar hasta 5 minutos», y bajar el TTL de la copia en RAM de credenciales a 60 s (seguimos evitando leer la KV en cada stream, que es para lo que está).

## A4 · Credenciales que nadie va a borrar nunca

`writeEncrypted` hace `kv.put(key, value)` sin `expirationTtl` (`:170`). Cada «conectar», cada prueba fallida y cada reconexión deja un registro cifrado permanente. No hay listado, ni revocación por lote, ni caducidad. Combinado con que el `credentialId` es una capability en la URL, el inventario de credenciales válidas solo crece.

**Corrección propuesta:** `expirationTtl` alineado con la vida razonable de una conexión (p. ej. 180 días) y renovación al usarla; y un endpoint de mantenimiento que liste cuántos registros hay (sin descifrar) para poder auditar.

## M1 · `DUPLICATE_ITEM` no se reintenta

Si `createtorrent` responde `DUPLICATE_ITEM` (el torrent ya existe, típicamente por una petición concurrente o por la ventana de 600 s del listado de TorBox), `assertTorbox` lo convierte en `provider_rejected`, el `catch` lo convierte en `null` y el usuario no ve stream aunque el torrent esté perfectamente disponible. La secuencia correcta sería re-listar y usar el `id` existente.

## M2 · Derivación de clave sin KDF

```js
const digest = await subtle.digest('SHA-256', new TextEncoder().encode(secret));
```

Con un secreto aleatorio de 32+ caracteres es aceptable. Pero `DEBRID_ENCRYPTION_KEY` es una variable que un humano escribe: si alguien pone una frase, un SHA-256 simple se rompe por fuerza bruta a velocidad de GPU. Un PBKDF2 con 100k iteraciones cuesta milisegundos una vez por isolate.

## M3 · EasyDebrid no es verificable

`https://easydebrid.com/api-docs` devuelve 404 hoy. El adaptador entero descansa en un esquema que el propio `docs/debrid-api-research.md` marca como pendiente de prueba en vivo. Además `assertEasyDebrid` exige `data.id != null`: si el proveedor renombra ese campo, **todas** las claves válidas pasan a reportarse como `invalid_credential`, que es exactamente el error que el resto del módulo se esfuerza en no cometer.

**Corrección propuesta:** relajar `assertEasyDebrid` a «objeto JSON no vacío» y mover la exigencia de `id` solo al camino de validación, donde un fallo se puede reportar como `provider_invalid_response` en vez de como clave mala.

## M4 · Rate limit compartido en Vercel

`api/index.js:232` usa `req.ip` sin `app.set('trust proxy', 1)`. En Vercel el socket remoto es el proxy, así que los 8 intentos/minuto son globales para todos los usuarios. Debrid ya está deshabilitado en Vercel, pero `/internal/streams-test.json` (6/min) sufre lo mismo.

## Lo que está bien y no hay que tocar

- **TorBox**: `seed=3` (no booleano, como documenta TorBox), `add_only_if_cached=true` como segunda barrera real, `checkcached` con `list_files=true` para ahorrarse el viaje a `mylist`, y `filesFromAvailability` como atajo. Verificado contra la documentación oficial actual.
- **Real-Debrid**: OAuth de tres patas con `grant_type` correcto también en el refresh (`http://oauth.net/grant_type/device/1.0`), `state` de 32 bytes en cookie `HttpOnly` + `SameSite=Lax` + `timingSafeEqual`, validación de `redirect_uri` contra el origen de la petición, y **no** llamar a `instantAvailability`/`addMagnet`/`selectFiles`: solo biblioteca personal `downloaded`. Paginación de 500 con tope de 20 páginas y presupuesto de tiempo, y no cachear los misses parciales — eso está mejor resuelto que en la mayoría de clientes.
- **Premiumize**: `cache/check` antes de `directdl` (fair use) y lectura de `content[]` por encima de los campos de conveniencia obsoletos (`location`/`filename`/`filesize`), que la documentación ya marca como legacy. Correcto.
- **Compartido**: `DEBRID_HEADERS` con User-Agent propio (sin él, Cloudflare Workers salen con agente vacío y los tres proveedores responden 403), `redirect: 'manual'` para no reenviar el Bearer a otro origen, clasificación de errores que distingue clave mala de borde bloqueado, y `PROVIDER_MESSAGES` como catálogo de diagnósticos honestos.
- **Aislamiento de caché**: `cacheMaxAge = 0` con `debridId` en `core.js` y `serveStream` que se salta el borde por completo. Los enlaces personales no entran en caché compartida. Bien.

## Lo que no he podido verificar

- **Ninguna prueba en vivo.** Los 328 tests mockean las APIs. Todas las afirmaciones sobre esquemas de respuesta son contra documentación, y la de EasyDebrid ni siquiera está disponible.
- **Los códigos de error de TorBox**: `assertTorbox` mapea `BAD_TOKEN`, `NO_AUTH`, `AUTH_ERROR`, `TOO_MANY_REQUESTS`, `ENDPOINT_NOT_FOUND` y `PLAN_RESTRICTED_FEATURE`, todos presentes en la tabla oficial. Faltan `MONTHLY_LIMIT`, `COOLDOWN_LIMIT`, `ACTIVE_LIMIT` y `DOWNLOAD_TOO_LARGE`, que hoy caen en `provider_rejected` genérico y merecerían su propio mensaje (son los que el usuario puede resolver cambiando de plan o esperando).
- **El comportamiento real de la Cache API en el `workers.dev` de este despliegue.** El código lo asume; la documentación actual no lo promete y la del propio repo dice que no funciona. Habría que probarlo con un deploy real.

## Orden de corrección sugerido

1. **C1 + C3** (una sola tanda en `debridCredentials.js` y `realDebridOAuth.js`): verificación de escritura, chequeo del retorno de `updateCredential`, TTL en RAM a 60 s. Es lo que convierte «conectado» en una promesa que se cumple.
2. **C2** (los cuatro adaptadores + `debridStreams.js`): logs con código. Cambio pequeño, y hace diagnosticable todo lo demás.
3. **A1**: partir el presupuesto en dos fases y no mutar la cuenta en segundo plano.
4. **A2 + A4 + A3**: observabilidad en `diagnose`, `expirationTtl` y documentar la ventana de desconexión.
5. **M1 + M3**: reintento en `DUPLICATE_ITEM` y relajar `assertEasyDebrid`.

Ninguno de estos cambios toca la semántica de caché de los proveedores, así que el riesgo de regresión es bajo y verificable con los tests existentes más cuatro nuevos: escritura que no persiste, refresh que no se guarda, `createtorrent` duplicado y `resolveCached` que falla (debe loguear).
