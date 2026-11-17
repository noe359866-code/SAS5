# Pruebas en vivo del addon desplegado — 17/11/2026

Instancia probada: <https://catalogo.noe359866.workers.dev>
Método: peticiones HTTP reales (`fetch`/`curl`) a cada endpoint, más reproducción local del
código de filtrado con `node`. No se modificó código del proyecto en este trabajo.

---

## 1. Resumen ejecutivo

El addon **funciona** en lo esencial: manifiesto, 121 catálogos, fichas de película y serie,
y streams torrent para películas. Hay **cuatro defectos graves** que se ven a simple vista
en el cliente y **tres problemas de despliegue** que explican otros fallos:

| # | Defecto | Gravedad | Visible para el usuario |
|---|---|---|---|
| 1 | El filtro de relevancia de series acepta **cualquier** serie con el mismo SxxEyy | Crítica | Sí: streams de otras series dentro de una ficha |
| 2 | Spam de `vercineo.net` inyectado en descripciones **y en títulos** | Crítica | Sí: nombres como «Anatomía de Grey ¡Busca Vercineo.net en Google!» |
| 3 | `stream` con id `tvmaze:` y `tvdb:` devuelve vacío; `tmdb:` sin prefijo de tipo rompe la temporada | Alta | Sí: sin streams en esas series |
| 4 | El worker desplegado es un build **anterior** al último commit de `main` | Alta | Sí: sigue sirviendo `/watch` y anunciando `tvdb:` |
| 5 | Sin KV ni OAuth de Real-Debrid → el botón de debrid no puede funcionar | Alta | Sí: «This server…» al conectar debrid |

Detalle de cada uno abajo, con la evidencia exacta y el arreglo propuesto.

---

## 2. Dónde está desplegado el código (hallazgo 4)

El worker responde con `"version": "1.5.0"`, pero **no coincide con `main` (`3740c47` ni el
`1c568f6` posterior)**:

| Comprobación | Desplegado | `main` (`1c568f6`) |
|---|---|---|
| `manifest.idPrefixes` | `["tt","tmdb:","tvmaze:","tvdb:"]` | `["tt","tmdb:","tvmaze:"]` |
| `GET /watch` | 200 con la biblioteca completa | **eliminado** en `1c568f6` |
| `GET /` y catálogos | OK | OK |

`git show 3740c47:lib/core.js` sí contiene `'tvdb:'`, y `1c568f6` lo quita. Conclusión: el
worker desplegado es anterior a `1c568f6` (probablemente `3740c47`). **Antes de corregir
nada hay que redesplegar**, o se corregirá código que no está en producción.

Ojo con el efecto secundario: al desplegar `1c568f6` + arreglos, `/watch` desaparece y
`tvdb:` deja de anunciarse (correcto, porque no está implementado — ver hallazgo 3b).

---

## 3. Hallazgo 1 — contaminación de streams de series (crítico)

### Síntoma

`GET /stream/series/tt0903747:1:1.json` (Breaking Bad S01E01) devuelve 10 streams, de los
cuales **4 son de otra serie**:

```json
{"title":"The Bad Guys Breaking In S01E01 1080p HEVC x265-MeGusta", ...}
{"title":"The Bad Guys Breaking In S01E01 1080p WEB h264-DOLORES", ...}
{"title":"The Bad Guys Breaking In S01E01 720p HEVC x265-MeGusta", ...}
{"title":"The Bad Guys Breaking In S01E01 480p x264-mSD", ...}
```

El `internal/streams-test.json` confirma que no es un solo proveedor: `totalStreams: 54` en
la búsqueda, con `knaben` 20/20 «relevantes», `torlock` 44/44 «relevantes».

### Causa exacta

`lib/streams.js:310` `isRelevant()`. Para series con temporada y episodio, **la rama de
series no compara nunca el título**:

```js
if (resolved.mediaType === 'series' && resolved.season != null && resolved.episode != null) {
  const episode = releaseEpisode(hit.title);
  if (episode) {
    if (episode.season !== resolved.season) return false;
    if (episode.episode == null) return true;
    return resolved.episode >= episode.episode && resolved.episode <= episode.lastEpisode;
  }
  ...
```

Si el release declara `S01E01`, se devuelve `true` **antes** de mirar el título. El bloque de
comparación por tokens (`titleTokens`, `ratio >= 1`…) está más abajo y nunca se ejecuta en
la rama de series.

### Reproducción (ejecutada, no teórica)

```
$ node -e "… isRelevant({title}, {mediaType:'series',title:'Breaking Bad',year:'2008',season:1,episode:1})"
true   Breaking.Bad.S01E01.Pilot.1080p.HEVC.x265-MeGusta
true   The Bad Guys Breaking In S01E01 1080p HEVC x265-MeGusta
true   Better.Call.Saul.S01E01.1080p.WEB-DL
true   El.Chavo.S01E01.720p
true   The.Bad.Guys.Breaking.In.S01E01.1080p
false  Breaking Bad S02 Complete 1080p     ← esto sí se filtra bien
```

Toda serie con `S01E01` en el nombre pasa el filtro. Control de películas: correcto
(`The.Matrix.1999` pasa, `Matrix.Reloaded.2003` y `Godzilla.Minus.One.2023` se rechazan).

### Arreglo propuesto

Exigir **título y episodio** en la rama de series: calcular `ratio`/`matched` para series
igual que para películas y devolver `false` si `ratio < 0.6` (o `matched < 2`). El bloque de
tokens ya existe; basta con no retornar antes y combinar ambas condiciones:

```js
if (episode) {
  if (episode.season !== resolved.season) return false;
  if (episode.episode != null &&
      !(resolved.episode >= episode.episode && resolved.episode <= episode.lastEpisode)) return false;
  // no retornar aún: validar también el título
} else {
  if (!(flat.includes(`s${s}`) || name.includes(`season ${resolved.season}`) ||
        name.includes(`temporada ${resolved.season}`))) return false;
}
// …y caer al bloque de tokens de abajo
```

Tests a añadir en `test/`: `The Bad Guys Breaking In S01E01` → `false` con Breaking Bad;
`Better.Call.Saul.S01E01` → `false`; pack `S01E01-07` → `true`; `1x01` y `Cap. 101` → `true`.

---

## 4. Hallazgo 2 — spam de `vercineo.net` en descripciones y títulos (crítico)

### Síntoma

TMDB devuelve, en algunos `overview` **y en algunos `name`/`title`**, texto publicitario que
el addon copia tal cual. Ejemplos reales servidos hoy:

| Endpoint | Campo | Valor |
|---|---|---|
| `catalog/series/tv_anime.json` | `name` | `Pokémon ¡Busca Vercineo.net en Google!` |
| `catalog/series/tv_popular.json` | `name` | `Anatomía de Grey ¡Busca Vercineo.net en Google!` |
| `catalog/series/tv_anime.json` | `description` | `¿Buscas películas y series gratis? ¡Busca Vercineo.net en Google!\n\nver gratis in vercineo.net La serie narra…` |
| `catalog/series/tv_popular.json` | `description` | `VerGratisEnVERCINEO.NET Un ingenuo entrenador…` (Ted Lasso) |
| `catalog/movie/cine_netflix.json` | `description` | `…¡Busca Vercineo.net en Google! … ver gratis in vercineo.net` |
| `catalog/movie/cine_proximos.json` | `description` | `…¡Busca Vercineo.net en Google! Una antigua epopeya…` |

Afecta a **los tres** puntos de render: catálogo, ficha (`meta`) y `/watch`.

### Causa

No hay ningún saneado. Confirmado por búsqueda: `grep -rn "vercineo\|sanitiz\|sanea\|spam"
lib/` no devuelve **nada**. Los dos puntos donde se construye el texto son:

- `lib/tmdb.js:104-106` — `mapTmdbItem()` → `description: item.overview + '⭐ TMDB: …'` y
  `name: item.title || item.name` **sin filtrar**.
- `lib/meta.js:62` — `const descriptionLines = [details.overview || ''];` y `lib/meta.js:41`
  `const title = details.title || details.name || originalId;`

### Arreglo propuesto

Añadir `lib/sanitize.js` con una función pura y testearla aparte:

```js
// Corta el bloque publicitario y limpia el título.
function cleanText(s) {
  if (!s) return s;
  return s
    .replace(/¿Buscas películas y series gratis\?[^.]*?Google!\s*/gi, '')
    .replace(/VerGratisEnVERCINEO\.NET\s*/gi, '')
    .replace(/ver gratis in vercineo\.net\s*/gi, '')
    .replace(/\s*vercineo\.net\s*/gi, '')
    .trim();
}
```

Aplicarlo en `mapTmdbItem()` (a `overview` **y** a `title`) y en `buildFromTmdb()` de
`meta.js` (a `details.overview`, `details.title`, `details.name`). Conviene además un
descartable genérico: si el texto contiene un dominio `.net`/`.com` en mayúsculas o una
frase con «Busca … en Google», se corta la línea.

Nota: es contenido de TMDB, no del addon, pero **el addon lo publica**. Mientras no se
saneen, los usuarios ven el anuncio como si fuera el título de la serie.

---

## 5. Hallazgo 3 — streams vacíos con `tvmaze:` y `tvdb:`; temporada perdida con `tmdb:` sin tipo

### 3a. `tvmaze:ID:T:E` devuelve `[]`

```
GET /stream/series/tvmaze:72988:1:1.json        → {"streams":[],"cacheMaxAge":0}
GET /internal/streams-test.json?type=series&id=tvmaze:72988:1:1
   → {"ok":false,"stage":"resolveTitle","message":"No se pudo resolver el título…"}
```

Pero `GET /meta/series/tvmaze:72988.json` → **200, ficha completa** (`Избранный`, 2025,
TVMaze). O sea: la ficha funciona y el stream no.

Causa: `parseStreamId()` (`lib/streams.js:156`) acepta `tvmaze:\d+`, pero la regex solo
captura temporada/episodio cuando el id es `tt…`. Para `tvmaze:72988:1:1` la regex **no
hace match** en absoluto (el `(?::(\d+):(\d+))?` va después del grupo alternativo, pero
`tvmaze:\d+` no admite el sufijo), así que `baseId` queda como `tvmaze:72988:1:1`, y luego
`resolveTitle` busca `showById("72988:1:1")` → 404 → `null` → `[]`.

Verificado en local:

```
{"raw":"tvmaze:72988:1:1","baseId":"tvmaze:72988","season":1,"episode":1}   ← HEAD actual, correcto
```

Espera: en el código local **actual** el `baseId` sí sale bien. El fallo en vivo indica que
el regex del build desplegado es más antiguo que el de `main`. **Reproducir tras
redesplegar** antes de abrir incidencia: puede ser el mismo problema que el hallazgo 4.

### 3b. `tvdb:series:81189:1:1` devuelve `[]`

```
GET /stream/series/tvdb:series:81189:1:1.json → {"streams":[]}
GET /internal/streams-test.json?type=series&id=tvdb:series:81189:1:1
   → {"ok":false,"stage":"resolveTitle", …}
```

Causa confirmada: `resolveTitle()` (`lib/streams.js:219`) tiene ramas para
`baseId.startsWith('tt')`, `'tmdb:'` y `'tvmaze:'`. **No hay rama para `tvdb:`**, así que
`title` queda `null` y la función devuelve `null` en la línea 298. El respaldo TVMaze
(`showLookupByImdb`) solo actúa con ids `tt…`.

Y `tvdb:` se **anuncia en el manifest** del build desplegado, así que Stremio ofrece
streams para fichas `tvdb:` que el addon no puede resolver. En `main` ya está quitado de
`idPrefixes` (`1c568f6`), lo que resuelve el anuncio, pero no el comportamiento si llega un
id así. Recomendación: o implementar la rama `tvdb:` (con `lib/tvdb.js`, hoy eliminado) o
dejarlo fuera del manifest y devolver `[]` de forma explícita y logueada.

### 3c. `tmdb:ID` sin prefijo de tipo pierde la temporada

```
GET /internal/streams-test.json?type=series&id=tmdb:1396:1:1
  → resolved: {"title":"Pride","year":"2004","season":null,"episode":null}
  → query: "Pride 2004"          ← buscó la serie equivocada, sin SxxEyy
```

`tmdb:1396` en `type=series` debería ser Breaking Bad (id 1396 de TMDB **es** Breaking Bad),
y en cambio resolvió «Pride». El regex de `parseStreamId` exige `tmdb:(tv|series|movie):`,
así que `tmdb:1396:1:1` no matchea y el sufijo se pierde; luego `resolveTitle` toma
`baseId.split(':').pop()` = `1396` y busca **en el tipo que le digan**, devolviendo un
resultado inesperado.

Con el prefijo explícito sí funciona:

```
GET /internal/streams-test.json?type=series&id=tmdb:tv:1396:1:1
  → resolved: {"title":"Breaking Bad","season":1,"episode":1}
  → query: "Breaking Bad S01E01", totalStreams: 25
```

**No es urgente** (el addon emite `tmdb:tv:`/`tmdb:series:`), pero la regex debería aceptar
`tmdb:ID` y sanear el sufijo, o rechazar el id con un 400 explícito en vez de resolver otra
serie en silencio.

---

## 6. Hallazgo 5 — debrid inoperable en este despliegue

`GET /healthz`:

```json
"realDebrid": {
  "supported": true, "mode": "oauth-personal-library",
  "oauthConfigured": false,
  "credentialStorageReady": true,
  "credentialStorage": "cache"
}
```

Consecuencias encadenadas, ya predichas en la auditoría (`docs/auditoria-debrid-2026-11-17.md`,
C1/C3) y ahora **confirmadas en el despliegue real**:

1. Sin `REALDEBRID_CLIENT_ID`/`SECRET`, `GET /internal/debrid/real-debrid/authorize` no puede
   iniciar el flujo → redirige a `/configure?debrid_error=oauth_not_configured`. En la página,
   el mensaje correspondiente (`lib/configurePage.js:1781`) es «This server…», truncado en el
   HTML servido: **el usuario no sabe qué pasa**.
2. `DEBRID_KV` no está vinculada → `credentialStorage: "cache"` (Cache API del worker). Es
   por datacenter y evictable: la credencial de TorBox/EasyDebrid/Premiumize que se guarde en
   un PoP **no se ve desde otro**, y a los 5 minutos puede haber desaparecido (reproducido en
   la auditoría). El usuario conecta la cuenta y el addon «olvida» la conexión.
3. Sin KV, `disconnect` solo limpia el isolate local (A3).

**No se pueden probar TorBox/EasyDebrid/Premiumize/Real-Debrid con datos reales sin las
credenciales del usuario**; lo anterior es lo que se deduce de `healthz` + el código.

### Arreglo mínimo para que debrid funcione

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "DEBRID_KV"
id = "<id de la KV creada con: npx wrangler kv namespace create DEBRID_KV>"
```

más `DEBRID_ENCRYPTION_KEY` (≥ 32 caracteres) y `REALDEBRID_CLIENT_ID`/`SECRET` como secrets.
Sin las tres cosas no hay debrid, y el mensaje de `/configure` debería decirlo con claridad
en vez de «This server…».

---

## 7. Proveedores caídos / degradados (afecta la percepción de calidad)

`internal/streams-test.json` con Breaking Bad y Matrix, hoy:

| Proveedor | Estado | Detalle |
|---|---|---|
| `blackholebay` | **caído** | `HTTP 403` en `theblackholebay.lol/api/search` |
| `rarbg` | **caído** | `HTTP 403` en `rarbg.ninjaproxy1.com/api/v1/search/` |
| `torrentioes` | **limitado** | `HTTP 429` en el tercero `torrentio.strem.fun` |
| `embed69` | sin resultados | 0 relevantes en película |
| `eztv` | inútil en este caso | 77 crudos, 0 relevantes (cross-ref IMDb) |
| `nyaa`, `yts` | omitidos por diseño | correcto |

`/stream/movie/tt0133093.json` devuelve `cacheMaxAge: 0`, marcador de respuesta parcial:
cuando algún proveedor falla, el addon no cachea. Es coherente, pero significa que con
`blackholebay` y `rarbg` caídos cada visita vuelve a golpear los 14 proveedores.

Sugerencia: marcar los proveedores con 403 recurrente como «pausados» por un TTL y no
golpearlos en cada petición; y un `cacheMaxAge` corto (p. ej. 60) en vez de 0 para no perder
toda la caché de respuesta por un solo proveedor roto.

---

## 8. Lo que funciona bien (verificado, no asumido)

| Prueba | Resultado |
|---|---|
| `GET /manifest.json` | OK, 121 catálogos, `configurable: true`, 4 tipos de id |
| `GET /healthz` | OK; 14 proveedores de stream; TMDB/TVMaze/OMDb/Watchmode activos |
| `GET /configure` | OK, 3 pasos, 30 regiones, 21 estudios, 14 fuentes, bloque debrid |
| `GET /` y `GET /watch` | OK (el segundo sobra: ya no está en `main`) |
| `catalog/movie/cine_tendencias.json` | OK, año 2026, pósters `w185`, notas TMDB |
| `catalog/movie/cine_netflix.json` | Contenido correcto (**descripciones contaminadas**) |
| `catalog/movie/cine_proximos.json` | OK, 2 metas |
| `catalog/series/tv_enemision.json` | OK, paginación y `skip` ignorado correctamente |
| `catalog/series/tv_anime.json` | OK (**un `name` contaminado**) |
| `skip=100` en `cine_tendencias` | OK, devuelve la página siguiente |
| `skip=5000` en `cine_estrenos` | OK, `{"metas":[]}` sin error |
| `skip=abc` | OK, ignorado sin romper |
| `meta/movie/tt0133093.json` | OK, reparto, dirección, `cacheMaxAge: 21600` |
| `meta/movie/tt23289160.json` | OK estructuralmente (**descripción contaminada**) |
| `meta/series/tvmaze:72988.json` | OK, ficha completa desde TVMaze |
| `meta/series/tvdb:series:81189.json` | OK, ficha completa |
| `stream/movie/tt0133093.json` | ~89 torrents con `infoHash` + trackers + DHT |
| `stream/movie/tmdb:603.json` | OK, misma respuesta que por IMDb |
| `stream/series/tt0903747:1:1.json` | 200, con episodio correcto (**+ contaminación**) |
| `stream/series/tt0903747:1:1` con config ficticia | Los públicos siguen funcionando (debrid caído no rompe nada) |
| `/<segmento-inválido>/manifest.json` | `{"error":"invalid_config"}`, 200 controlado |
| `meta/movie/tt0000000000.json` | Ficha degradada honesta («Metadatos no disponibles») |

---

## 9. Cachés: sin memoria entre peticiones

Dos lecturas de `/healthz` y `/internal/cache.json` en momentos distintos:

```
healthz        → cache.entries: 0,  responseCache.entries: 0
internal/cache → entries: 42,    responseCache: {entries: 1, stored: 1, misses: 105}
healthz otra vez → sigue en 0
```

Los contadores son **por isolate**: cada petición puede aterrizar en un isolate nuevo con
caché vacía, y `/healthz` no es representativo de nada. No es un bug, pero conviene no
usar `cache.entries` como indicador de salud; `misses: 105` frente a `hits: 0` en 42
entradas sugiere además que la clave de caché cambia entre peticiones (o que el isolate
muere antes de reutilizarla). Merece una mirada cuando se optimice el consumo de
subrequests.

---

## 10. Orden de corrección recomendado

1. **Redesplegar** `main` (`1c568f6`) para que producción coincida con el repo. Sin esto,
   todo lo demás se corrige a ciegas.
2. **Saneado de texto** (`lib/sanitize.js`, aplicado en `lib/tmdb.js` y `lib/meta.js`) — es lo
   más visible y lo más barato; toca `name` y `description`.
3. **Filtro de series** (`isRelevant`): exigir título además de episodio. Añadir los 4 tests
   del punto 3 antes y después del cambio.
4. **Ids `tvmaze:`/`tvdb:`/`tmdb:`**: reproducir tras el despliegue; si persiste, arreglar
   `parseStreamId`/`resolveTitle` y devolver error explícito en vez de `[]` silencioso.
5. **Debrid**: KV + `DEBRID_ENCRYPTION_KEY` + OAuth de RD; y arreglar el mensaje de
   `/configure` para que no diga «This server…».
6. **Proveedores 403/429**: pausa con TTL y `cacheMaxAge` distinto de 0 en respuestas
   parciales.

Los puntos 2 y 3 son independientes y no tocan la auditoría debrid
(`docs/auditoria-debrid-2026-11-17.md`), que sigue pendiente de aplicar en su propio orden
(C1+C3 → C2 → A1 → …).
